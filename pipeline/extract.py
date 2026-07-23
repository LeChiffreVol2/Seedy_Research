"""
PDF -> Markdown extraction for Civil Engineering documents.

Default source directory points to ../CE Project Database, so this script can run
without copying files into pipeline/data/pdfs first.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
PIPELINE_DIR = Path(__file__).resolve().parent
DEFAULT_PDF_DIR = ROOT_DIR / "CE Project Database"
DEFAULT_OUT_DIR = PIPELINE_DIR / "data" / "markdown"


def source_frontmatter(pdf_path: Path, page_count: int | None, extractor: str) -> list[str]:
    return [
        "---",
        # Keep the legacy collection ID so deployed filters and saved sessions remain compatible.
        "collection: ce_project",
        "collection_label: Student Transport Projects",
        "source_provider: student_transport_projects",
        "source_type: student_project",
        f"source_pdf: {pdf_path.name}",
        f"page_start: {1 if page_count else ''}",
        f"page_end: {page_count or ''}",
        "rights_status: public_source_no_redistribution",
        "access_level: full_text_local",
        "evidence_status: extracted",
        f"generated_at: {dt.datetime.now(dt.timezone.utc).isoformat()}",
        f"extractor: {extractor}",
        "---",
        "",
    ]


def pdf_to_markdown_unstructured(pdf_path: Path) -> str:
    from unstructured.partition.pdf import partition_pdf

    elements = partition_pdf(
        filename=str(pdf_path),
        strategy="hi_res",
        infer_table_structure=True,
        extract_images_in_pdf=False,
        languages=["tha", "eng"],
    )

    lines: list[str] = []
    for el in elements:
        text = str(el).strip()
        if not text:
            continue

        element_type = type(el).__name__
        if element_type == "Title":
            lines.append(f"\n## {text}\n")
        elif element_type == "Table":
            html = getattr(getattr(el, "metadata", None), "text_as_html", None)
            lines.append(f"\n{html or text}\n")
        elif element_type == "ListItem":
            lines.append(f"- {text}")
        else:
            lines.append(text)

    header = source_frontmatter(pdf_path, None, "unstructured")
    return "\n".join(header + lines).strip() + "\n"


def pdf_page_count(pdf_path: Path) -> int:
    pdfinfo = shutil.which("pdfinfo")
    if not pdfinfo:
        raise RuntimeError("pdfinfo not found. Install poppler first.")
    result = subprocess.run(
        [pdfinfo, str(pdf_path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "pdfinfo failed")
    match = re.search(r"^Pages:\s+(\d+)\s*$", result.stdout, flags=re.MULTILINE)
    if not match:
        raise RuntimeError(f"Could not read page count for {pdf_path.name}")
    return int(match.group(1))


def extract_pdftotext_pages(pdf_path: Path) -> list[str]:
    pdftotext = shutil.which("pdftotext")
    if not pdftotext:
        raise RuntimeError("pdftotext not found. Install poppler or use unstructured extraction.")

    page_count = pdf_page_count(pdf_path)
    with tempfile.NamedTemporaryFile(suffix=".txt") as tmp:
        result = subprocess.run(
            [pdftotext, "-layout", "-enc", "UTF-8", str(pdf_path), tmp.name],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "pdftotext failed")
        raw_text = Path(tmp.name).read_text(encoding="utf-8", errors="replace")

    # pdftotext terminates documents with a form feed. Remove only that trailing
    # sentinel; never filter empty intermediate pages because doing so renumbers
    # every later citation.
    pages = raw_text.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    pages = pages[:page_count]
    pages.extend([""] * (page_count - len(pages)))
    return pages


def ocr_page(
    pdf_path: Path,
    page_number: int,
    dpi: int,
    languages: str,
) -> str:
    pdftoppm = shutil.which("pdftoppm")
    tesseract = shutil.which("tesseract")
    if not pdftoppm or not tesseract:
        raise RuntimeError("Hybrid OCR requires pdftoppm and tesseract.")

    with tempfile.TemporaryDirectory(prefix="civilmcp-ocr-") as tmp_dir:
        image_prefix = Path(tmp_dir) / "page"
        render = subprocess.run(
            [
                pdftoppm,
                "-f",
                str(page_number),
                "-l",
                str(page_number),
                "-singlefile",
                "-r",
                str(dpi),
                "-png",
                str(pdf_path),
                str(image_prefix),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if render.returncode != 0:
            raise RuntimeError(render.stderr.strip() or f"Could not render page {page_number}")
        image_path = image_prefix.with_suffix(".png")
        result = subprocess.run(
            [tesseract, str(image_path), "stdout", "-l", languages, "--psm", "6"],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"OCR failed on page {page_number}")
        return result.stdout.strip()


def markdown_from_pages(pdf_path: Path, pages: list[str], extractor: str) -> str:
    lines = source_frontmatter(pdf_path, len(pages), extractor)
    for page_index, page in enumerate(pages, start=1):
        cleaned_lines = [line.rstrip() for line in page.splitlines()]
        cleaned = "\n".join(cleaned_lines).strip()
        if not cleaned:
            continue
        lines.extend([f"## Page {page_index}", "", cleaned, ""])

    return "\n".join(lines).strip() + "\n"


def pdf_to_markdown_pdftotext(pdf_path: Path) -> str:
    return markdown_from_pages(pdf_path, extract_pdftotext_pages(pdf_path), "pdftotext-page-preserving")


def pdf_to_markdown_hybrid(
    pdf_path: Path,
    ocr_min_chars: int,
    ocr_dpi: int,
    ocr_languages: str,
) -> str:
    pages = extract_pdftotext_pages(pdf_path)
    for page_index, page in enumerate(pages, start=1):
        compact = re.sub(r"\s+", "", page)
        if len(compact) >= ocr_min_chars:
            continue
        print(f"    OCR page {page_index}/{len(pages)}", flush=True)
        ocr_text = ocr_page(pdf_path, page_index, ocr_dpi, ocr_languages)
        if len(re.sub(r"\s+", "", ocr_text)) > len(compact):
            pages[page_index - 1] = ocr_text
    return markdown_from_pages(pdf_path, pages, "pdftotext+tesseract-page-preserving")


def pdf_to_markdown(
    pdf_path: Path,
    engine: str,
    ocr_min_chars: int,
    ocr_dpi: int,
    ocr_languages: str,
) -> str:
    if engine == "pdftotext":
        return pdf_to_markdown_pdftotext(pdf_path)
    if engine == "unstructured":
        return pdf_to_markdown_unstructured(pdf_path)
    return pdf_to_markdown_hybrid(pdf_path, ocr_min_chars, ocr_dpi, ocr_languages)


def run(
    pdf_dir: Path,
    out_dir: Path,
    overwrite: bool,
    limit: int | None,
    engine: str,
    source_globs: list[str],
    ocr_min_chars: int,
    ocr_dpi: int,
    ocr_languages: str,
) -> None:
    if not pdf_dir.exists():
        raise FileNotFoundError(f"PDF directory not found: {pdf_dir}")

    out_dir.mkdir(parents=True, exist_ok=True)
    pdfs = sorted(pdf_dir.glob("*.pdf"))
    if source_globs:
        pdfs = [pdf for pdf in pdfs if any(pdf.match(pattern) for pattern in source_globs)]
    if limit is not None:
        pdfs = pdfs[:limit]

    print(f"Source PDF directory : {pdf_dir}")
    print(f"Output markdown dir  : {out_dir}")
    print(f"Found {len(pdfs)} PDF files")

    converted = 0
    skipped = 0
    failed = 0

    for pdf in pdfs:
        out_file = out_dir / f"{pdf.stem}.md"
        if out_file.exists() and not overwrite:
            skipped += 1
            print(f"  skip (exists): {pdf.name}")
            continue

        try:
            print(f"  extract -> {pdf.name}")
            markdown = pdf_to_markdown(
                pdf,
                engine,
                ocr_min_chars=ocr_min_chars,
                ocr_dpi=ocr_dpi,
                ocr_languages=ocr_languages,
            )
            out_file.write_text(markdown, encoding="utf-8")
            converted += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  fail  -> {pdf.name}: {exc}")

    print("\nExtraction summary")
    print(f"- converted: {converted}")
    print(f"- skipped:   {skipped}")
    print(f"- failed:    {failed}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract markdown from PDF files.")
    parser.add_argument(
        "--pdf-dir",
        type=Path,
        default=DEFAULT_PDF_DIR,
        help=f"Directory containing input PDFs (default: {DEFAULT_PDF_DIR})",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help=f"Directory for markdown output (default: {DEFAULT_OUT_DIR})",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing markdown files.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process only first N sorted PDFs.",
    )
    parser.add_argument(
        "--engine",
        choices=["auto", "hybrid", "unstructured", "pdftotext"],
        default="hybrid",
        help="Extraction engine. auto is a backward-compatible alias for page-preserving hybrid OCR.",
    )
    parser.add_argument(
        "--source-glob",
        action="append",
        default=[],
        help="Extract only PDF filenames matching this glob. Can be provided multiple times.",
    )
    parser.add_argument("--ocr-min-chars", type=int, default=80)
    parser.add_argument("--ocr-dpi", type=int, default=250)
    parser.add_argument("--ocr-languages", default="tha+eng")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(
        pdf_dir=args.pdf_dir,
        out_dir=args.out_dir,
        overwrite=args.overwrite,
        limit=args.limit,
        engine=args.engine,
        source_globs=args.source_glob,
        ocr_min_chars=args.ocr_min_chars,
        ocr_dpi=args.ocr_dpi,
        ocr_languages=args.ocr_languages,
    )
