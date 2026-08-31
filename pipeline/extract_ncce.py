"""
Extract NCCE proceedings into paper-level markdown files.

The extractor uses Poppler pdftotext and groups pages by proceedings paper
codes found in page footers, e.g. STR01-1, BTL-02-1, EEC01-1. If a PDF does
not produce enough paper-code groups, it falls back to fixed page windows while
preserving page ranges for citations.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from metadata import infer_discipline_from_code

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover - keeps extractor usable without optional env loading.
    def load_dotenv(*_args: object, **_kwargs: object) -> bool:
        return False

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_PDF_DIR = ROOT_DIR / "NCCE Project Database"
DEFAULT_OUT_DIR = ROOT_DIR / "pipeline" / "data" / "markdown"

CODE_RE = re.compile(r"\b([A-Z]{2,5}-?\d{1,3})-(\d{1,3})\b")
NCCE_RE = re.compile(r"NCCE(\d+)")
PDF_NCCE_RE = re.compile(r"NCCE(\d+)", re.IGNORECASE)


@dataclass
class PaperGroup:
    paper_code: str
    pages: list[tuple[int, str]]


def run_pdftotext(pdf_path: Path) -> list[str]:
    pdftotext = shutil.which("pdftotext")
    if not pdftotext:
        raise RuntimeError("pdftotext not found. Install poppler first.")

    with tempfile.NamedTemporaryFile(suffix=".txt") as tmp:
        result = subprocess.run(
            [pdftotext, "-layout", "-enc", "UTF-8", str(pdf_path), tmp.name],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"pdftotext failed for {pdf_path}")
        raw = Path(tmp.name).read_text(encoding="utf-8", errors="replace")

    return [page.strip() for page in raw.split("\f")]


def detect_paper_code(page_text: str) -> str | None:
    matches = CODE_RE.findall(page_text[-2500:])
    if not matches:
        return None
    return matches[-1][0]


def infer_proceeding(pdf_path: Path) -> tuple[int | None, int | None]:
    match = PDF_NCCE_RE.search(pdf_path.stem)
    proceeding_no = int(match.group(1)) if match else None
    year_by_no = {25: 2020, 26: 2021, 29: 2024, 31: 2026}
    return proceeding_no, year_by_no.get(proceeding_no or 0)


def infer_discipline(paper_code: str) -> str:
    return infer_discipline_from_code(paper_code)


def clean_page(page_text: str) -> str:
    lines = [line.rstrip() for line in page_text.replace("\r", "\n").splitlines()]
    return "\n".join(lines).strip()


def looks_like_section_page(page_text: str) -> bool:
    compact = re.sub(r"\s+", "", page_text)
    return "สาขา" in compact and "บทคัดย่อ" not in compact and "Abstract" not in page_text[:2500]


def group_pages_by_paper(pages: list[str]) -> list[PaperGroup]:
    groups: list[PaperGroup] = []
    current: PaperGroup | None = None

    for page_no, page_text in enumerate(pages, start=1):
        cleaned = clean_page(page_text)
        if not cleaned:
            continue

        paper_code = detect_paper_code(cleaned)
        if paper_code:
            if current is None or current.paper_code != paper_code:
                current = PaperGroup(paper_code=paper_code, pages=[])
                groups.append(current)
            current.pages.append((page_no, cleaned))
            continue

        if current is not None and not looks_like_section_page(cleaned):
            current.pages.append((page_no, cleaned))

    return [group for group in groups if group.pages]


def fallback_page_windows(pages: list[str], window_pages: int) -> list[PaperGroup]:
    groups: list[PaperGroup] = []
    buffer: list[tuple[int, str]] = []
    counter = 1
    for page_no, page_text in enumerate(pages, start=1):
        cleaned = clean_page(page_text)
        if not cleaned or looks_like_section_page(cleaned):
            continue
        buffer.append((page_no, cleaned))
        if len(buffer) >= window_pages:
            groups.append(PaperGroup(paper_code=f"WINDOW{counter:04d}", pages=buffer))
            counter += 1
            buffer = []
    if buffer:
        groups.append(PaperGroup(paper_code=f"WINDOW{counter:04d}", pages=buffer))
    return groups


def infer_title(group: PaperGroup) -> str:
    first_page = group.pages[0][1]
    ignored = (
        "การประชุมวิชาการวิศวกรรมโยธา",
        "The National Convention on Civil Engineering",
        "National Convention on Civil Engineering",
        "THAILAND",
        "วันที่",
        "May ",
        "June ",
        "July ",
    )
    candidates: list[str] = []
    for raw_line in first_page.splitlines()[:45]:
        line = re.sub(r"\s+", " ", raw_line).strip()
        if len(line) < 10:
            continue
        if any(token in line for token in ignored):
            continue
        if CODE_RE.search(line):
            continue
        candidates.append(line)
        if len(candidates) >= 2:
            break
    return " / ".join(candidates)[:240] if candidates else group.paper_code


def markdown_for_group(pdf_path: Path, group: PaperGroup) -> str:
    proceeding_no, proceeding_year = infer_proceeding(pdf_path)
    page_start = group.pages[0][0]
    page_end = group.pages[-1][0]
    source_pdf = pdf_path.name
    paper_title = infer_title(group)
    source_type = "proceedings_paper" if not group.paper_code.startswith("WINDOW") else "proceedings_window"
    lines = [
        "---",
        "collection: ncce",
        "collection_label: NCCE Proceedings",
        "source_provider: ncce",
        f"source_pdf: {source_pdf}",
        f"parent_source_pdf: {source_pdf}",
        f"source_type: {source_type}",
        f"paper_code: {group.paper_code}",
        f"page_start: {page_start}",
        f"page_end: {page_end}",
        f"proceeding_no: {proceeding_no or ''}",
        f"proceeding_year: {proceeding_year or ''}",
        f"discipline: {infer_discipline(group.paper_code)}",
        "rights_status: public_source_no_redistribution",
        "access_level: full_text_local",
        "evidence_status: extracted",
        f"generated_at: {dt.datetime.now(dt.timezone.utc).isoformat()}",
        "extractor: pdftotext-ncce",
        "---",
        "",
        f"# {paper_title}",
        "",
    ]

    for page_no, page_text in group.pages:
        lines.extend([f"## Page {page_no}", "", page_text, ""])

    return "\n".join(lines).strip() + "\n"


def safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")


def output_names_for_groups(prefix: str, groups: list[PaperGroup]) -> list[str]:
    """Return stable filenames without collapsing repeated proceedings codes.

    A code's first contiguous occurrence keeps the historical filename. Later
    occurrences are separate documents and include their first source page so
    a repeated footer code cannot merge unrelated parts of the proceedings.
    """

    seen_codes: set[str] = set()
    used_names: set[str] = set()
    names: list[str] = []
    for group in groups:
        safe_code = safe_filename(group.paper_code)
        base = f"{prefix}_{safe_code}"
        candidate = base
        if group.paper_code in seen_codes:
            candidate = f"{base}_P{group.pages[0][0]}"

        # Distinct groups cannot normally start on the same page, but retain a
        # deterministic occurrence suffix if malformed input does so.
        occurrence = 2
        unique_candidate = candidate
        while unique_candidate in used_names:
            unique_candidate = f"{candidate}_{occurrence}"
            occurrence += 1

        seen_codes.add(group.paper_code)
        used_names.add(unique_candidate)
        names.append(f"{unique_candidate}.md")
    return names


def extract_pdf(pdf_path: Path, out_dir: Path, overwrite: bool, min_groups: int, window_pages: int) -> tuple[int, int]:
    pages = run_pdftotext(pdf_path)
    groups = group_pages_by_paper(pages)
    if len(groups) < min_groups:
        groups = fallback_page_windows(pages, window_pages=window_pages)

    proceeding_no, _ = infer_proceeding(pdf_path)
    prefix = f"NCCE{proceeding_no}" if proceeding_no else pdf_path.stem
    written = 0
    skipped = 0
    for group, name in zip(groups, output_names_for_groups(prefix, groups), strict=True):
        target = out_dir / name
        if target.exists() and not overwrite:
            skipped += 1
            continue
        target.write_text(markdown_for_group(pdf_path, group), encoding="utf-8")
        written += 1
    return written, skipped


def parse_args() -> argparse.Namespace:
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(Path(__file__).resolve().parent / ".env")
    parser = argparse.ArgumentParser(description="Extract NCCE proceedings into paper-level markdown.")
    parser.add_argument("--pdf-dir", type=Path, default=Path(os.getenv("NCCE_PDF_SOURCE_DIR", DEFAULT_PDF_DIR)))
    parser.add_argument("--out-dir", type=Path, default=Path(os.getenv("MD_DIR", DEFAULT_OUT_DIR)))
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--source-glob",
        action="append",
        default=[],
        help="Extract only PDF filenames matching this glob. Can be provided multiple times.",
    )
    parser.add_argument("--min-groups", type=int, default=10)
    parser.add_argument("--window-pages", type=int, default=10)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.pdf_dir.exists():
        raise FileNotFoundError(f"NCCE PDF directory not found: {args.pdf_dir}")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    pdfs = sorted(args.pdf_dir.glob("*.pdf"))
    if args.source_glob:
        pdfs = [pdf for pdf in pdfs if any(pdf.match(pattern) for pattern in args.source_glob)]
    if args.limit is not None:
        pdfs = pdfs[: args.limit]

    total_written = 0
    total_skipped = 0
    for pdf_path in pdfs:
        print(f"extract ncce -> {pdf_path.name}")
        written, skipped = extract_pdf(
            pdf_path=pdf_path,
            out_dir=args.out_dir,
            overwrite=args.overwrite,
            min_groups=args.min_groups,
            window_pages=args.window_pages,
        )
        total_written += written
        total_skipped += skipped
        print(f"  written={written} skipped={skipped}")

    print("\nNCCE extraction summary")
    print(f"- pdfs:    {len(pdfs)}")
    print(f"- written: {total_written}")
    print(f"- skipped: {total_skipped}")


if __name__ == "__main__":
    main()
