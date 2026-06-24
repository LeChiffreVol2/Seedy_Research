"""
Generate CivilMCP paper preview thumbnails from source PDFs.

The feed is document-level: CE documents map to one PDF, while NCCE documents
map to a proceedings PDF plus a paper-level page_start. This script renders the
document start page into a small static JPG under web/public/paper-previews.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

ROOT_DIR = Path(__file__).resolve().parents[1]
MARKDOWN_DIR = ROOT_DIR / "pipeline" / "data" / "markdown"
WEB_PREVIEW_DIR = ROOT_DIR / "web" / "public" / "paper-previews"
TMP_DIR = ROOT_DIR / "tmp" / "paper-previews"
DEFAULT_CE_PDF_DIR = ROOT_DIR / "CE Project Database"
DEFAULT_NCCE_PDF_DIR = ROOT_DIR / "NCCE Project Database"


@dataclass(frozen=True)
class PreviewJob:
    source: str
    collection: str
    pdf_path: Path
    page: int
    output_path: Path


def load_env() -> None:
    env_path = ROOT_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if "#" in value:
            value = value.split("#", 1)[0].strip()
        os.environ.setdefault(key, value)


def parse_frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    metadata: dict[str, str] = {}
    for line in text[3:end].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    return metadata


def slugify_source(source: str) -> str:
    stem = re.sub(r"\.(md|pdf)$", "", source, flags=re.IGNORECASE)
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("._") or "paper"


def int_or_default(value: str | None, default: int) -> int:
    try:
        parsed = int(str(value or "").strip())
    except ValueError:
        return default
    return max(1, parsed)


def build_jobs(limit: int | None = None) -> list[PreviewJob]:
    ce_pdf_dir = Path(os.getenv("PDF_SOURCE_DIR", str(DEFAULT_CE_PDF_DIR))).expanduser()
    ncce_pdf_dir = Path(os.getenv("NCCE_PDF_SOURCE_DIR", str(DEFAULT_NCCE_PDF_DIR))).expanduser()

    jobs: list[PreviewJob] = []
    for md_path in sorted(MARKDOWN_DIR.glob("*.md")):
        metadata = parse_frontmatter(md_path)
        collection = metadata.get("collection") or "ce_project"
        source = md_path.name
        source_pdf = metadata.get("parent_source_pdf") or metadata.get("source_pdf") or f"{md_path.stem}.pdf"
        pdf_dir = ncce_pdf_dir if collection == "ncce" else ce_pdf_dir
        page = int_or_default(metadata.get("page_start"), 1) if collection == "ncce" else 1
        jobs.append(
            PreviewJob(
                source=source,
                collection=collection,
                pdf_path=pdf_dir / source_pdf,
                page=page,
                output_path=WEB_PREVIEW_DIR / f"{slugify_source(source)}.jpg",
            )
        )
        if limit and len(jobs) >= limit:
            break
    return jobs


def render_pdf_page(job: PreviewJob, force: bool) -> dict[str, object]:
    if job.output_path.exists() and not force:
        return {"source": job.source, "status": "skipped", "path": str(job.output_path.relative_to(ROOT_DIR))}
    if not job.pdf_path.exists():
        return {"source": job.source, "status": "missing_pdf", "pdf": str(job.pdf_path)}

    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        raise RuntimeError("pdftoppm is required. Install Poppler first.")

    job.output_path.parent.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=TMP_DIR) as tmp:
        prefix = Path(tmp) / "page"
        command = [
            pdftoppm,
            "-q",
            "-f",
            str(job.page),
            "-l",
            str(job.page),
            "-singlefile",
            "-jpeg",
            "-jpegopt",
            "quality=72",
            "-r",
            "82",
            str(job.pdf_path),
            str(prefix),
        ]
        result = subprocess.run(command, check=False, capture_output=True, text=True)
        rendered = prefix.with_suffix(".jpg")

        if result.returncode != 0 or not rendered.exists():
            fallback = command.copy()
            fallback[3] = "1"
            fallback[5] = "1"
            result = subprocess.run(fallback, check=False, capture_output=True, text=True)
            rendered = prefix.with_suffix(".jpg")
            if result.returncode != 0 or not rendered.exists():
                return {
                    "source": job.source,
                    "status": "render_failed",
                    "page": job.page,
                    "stderr": (result.stderr or result.stdout).strip()[-500:],
                }

        image = Image.open(rendered).convert("RGB")
        image.thumbnail((420, 620), Image.Resampling.LANCZOS)
        image.save(job.output_path, "JPEG", quality=58, optimize=True, progressive=True)

    return {
        "source": job.source,
        "status": "generated",
        "collection": job.collection,
        "page": job.page,
        "path": str(job.output_path.relative_to(ROOT_DIR)),
        "bytes": job.output_path.stat().st_size,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate static PDF preview thumbnails for CivilMCP.")
    parser.add_argument("--force", action="store_true", help="Regenerate existing thumbnails.")
    parser.add_argument("--limit", type=int, default=None, help="Generate only the first N previews.")
    parser.add_argument("--workers", type=int, default=4, help="Parallel pdftoppm workers.")
    args = parser.parse_args()

    load_env()
    jobs = build_jobs(args.limit)
    if not jobs:
        print("No markdown documents found.")
        return 1

    print(f"Generating previews for {len(jobs)} documents into {WEB_PREVIEW_DIR}")
    counts: dict[str, int] = {}
    failures: list[dict[str, object]] = []
    manifest: dict[str, str] = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        future_map = {executor.submit(render_pdf_page, job, args.force): job for job in jobs}
        for index, future in enumerate(concurrent.futures.as_completed(future_map), 1):
            result = future.result()
            status = str(result.get("status"))
            counts[status] = counts.get(status, 0) + 1
            source = str(result.get("source"))
            if status in {"generated", "skipped"} and result.get("path"):
                manifest[source] = "/" + str(result["path"]).split("web/public/", 1)[-1]
            elif status not in {"generated", "skipped"}:
                failures.append(result)
            if index % 50 == 0 or index == len(jobs):
                print(f"- processed {index}/{len(jobs)} {counts}")

    manifest_path = WEB_PREVIEW_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    summary = {
        "total": len(jobs),
        "counts": counts,
        "failures": failures[:20],
        "manifest": str(manifest_path.relative_to(ROOT_DIR)),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
