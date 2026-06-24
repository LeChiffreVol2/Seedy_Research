"""
PDF -> Markdown extraction for Civil Engineering documents.

Default source directory points to ../CE Project Database, so this script can run
without copying files into pipeline/data/pdfs first.
"""

from __future__ import annotations

import argparse
import datetime as dt
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
PIPELINE_DIR = Path(__file__).resolve().parent
DEFAULT_PDF_DIR = ROOT_DIR / "CE Project Database"
DEFAULT_OUT_DIR = PIPELINE_DIR / "data" / "markdown"


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

    header = [
        "---",
        "collection: ce_project",
        "source_type: paper",
        f"source_pdf: {pdf_path.name}",
        "page_start: ",
        "page_end: ",
        f"generated_at: {dt.datetime.now(dt.timezone.utc).isoformat()}",
        "---",
        "",
    ]
    return "\n".join(header + lines).strip() + "\n"


def pdf_to_markdown_pdftotext(pdf_path: Path) -> str:
    pdftotext = shutil.which("pdftotext")
    if not pdftotext:
        raise RuntimeError("pdftotext not found. Install poppler or use unstructured extraction.")

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

    pages = [page.strip() for page in raw_text.split("\f") if page.strip()]
    lines = [
        "---",
        "collection: ce_project",
        "source_type: paper",
        f"source_pdf: {pdf_path.name}",
        f"page_start: {1 if pages else ''}",
        f"page_end: {len(pages) if pages else ''}",
        f"generated_at: {dt.datetime.now(dt.timezone.utc).isoformat()}",
        "extractor: pdftotext",
        "---",
        "",
    ]
    for page_index, page in enumerate(pages, start=1):
        cleaned_lines = [line.rstrip() for line in page.splitlines()]
        cleaned = "\n".join(cleaned_lines).strip()
        if not cleaned:
            continue
        lines.extend([f"## Page {page_index}", "", cleaned, ""])

    return "\n".join(lines).strip() + "\n"


def pdf_to_markdown(pdf_path: Path, engine: str) -> str:
    if engine == "pdftotext":
        return pdf_to_markdown_pdftotext(pdf_path)
    if engine == "unstructured":
        return pdf_to_markdown_unstructured(pdf_path)

    try:
        return pdf_to_markdown_unstructured(pdf_path)
    except Exception as exc:  # noqa: BLE001
        print(f"    fallback pdftotext: {exc}")
        return pdf_to_markdown_pdftotext(pdf_path)


def run(pdf_dir: Path, out_dir: Path, overwrite: bool, limit: int | None, engine: str) -> None:
    if not pdf_dir.exists():
        raise FileNotFoundError(f"PDF directory not found: {pdf_dir}")

    out_dir.mkdir(parents=True, exist_ok=True)
    pdfs = sorted(pdf_dir.glob("*.pdf"))
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
            markdown = pdf_to_markdown(pdf, engine)
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
        choices=["auto", "unstructured", "pdftotext"],
        default="auto",
        help="Extraction engine. auto tries unstructured first, then pdftotext.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(
        pdf_dir=args.pdf_dir,
        out_dir=args.out_dir,
        overwrite=args.overwrite,
        limit=args.limit,
        engine=args.engine,
    )
