#!/usr/bin/env python3
"""Build the deterministic, rights-reviewed Thai native-reader demo pack.

The input PDFs are intentionally not committed. Each source is an official
ThaiJO publisher download covered by the LEARN Journal CC BY 4.0 statement.
This builder verifies the exact PDF checksum and page count before emitting
page-addressable text plus a machine-readable rights manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
LICENSE_EVIDENCE_URL = "https://so04.tci-thaijo.org/index.php/LEARN/about"
PACK_DATE = "2026-08-31T00:00:00Z"


@dataclass(frozen=True)
class Paper:
    source: str
    provider_record_id: str
    article_id: str
    filename: str
    title: str
    authors: tuple[str, ...]
    doi: str
    published_at: str
    first_label: int
    page_count: int
    sha256: str
    article_url: str
    pdf_url: str


PAPERS = (
    Paper(
        source="thaijo:learn:291631",
        provider_record_id="oai:so04.tci-thaijo.org:article/291631",
        article_id="291631",
        filename="learn-ai-elt-review.pdf",
        title="A Critical Analysis of Research on the Use of Artificial Intelligence in English Language Teaching in Thailand: Conflicting Results and Methodological Limitations",
        authors=("Supong Tangkiengsirisin", "Le Van Canh", "Sethawut Techasan"),
        doi="10.70730/JFOW3489",
        published_at="2026-07-31",
        first_label=1,
        page_count=17,
        sha256="ae77db12d0d695ed890a5587f25a68996bbe489950721e408093eb57855eeff5",
        article_url="https://so04.tci-thaijo.org/index.php/LEARN/article/view/291631",
        pdf_url="https://so04.tci-thaijo.org/index.php/LEARN/article/download/291631/192945/1319073",
    ),
    Paper(
        source="thaijo:learn:291543",
        provider_record_id="oai:so04.tci-thaijo.org:article/291543",
        article_id="291543",
        filename="learn-task-grammar.pdf",
        title="Enhancing Multidimensional Communicative Competence among Thai Lower Secondary EFL Students through Task-Based Grammar Instruction",
        authors=("Maythaporn Tangkanchanayuenyong", "Virasuda Sribayak"),
        doi="10.70730/KVFS2893",
        published_at="2026-07-30",
        first_label=156,
        page_count=26,
        sha256="05623331e36cc24f35e6783f1271144e0d754788ff72b9529ca00657f8e83ee5",
        article_url="https://so04.tci-thaijo.org/index.php/LEARN/article/view/291543",
        pdf_url="https://so04.tci-thaijo.org/index.php/LEARN/article/download/291543/192897/1318731",
    ),
    Paper(
        source="thaijo:learn:291567",
        provider_record_id="oai:so04.tci-thaijo.org:article/291567",
        article_id="291567",
        filename="learn-ai-literacy.pdf",
        title="AI Literacy, Integration, and Challenges in EFL Education: Perspectives of Higher Education Teachers in Thailand",
        authors=("Jenjira Jitpaiboon", "Irina Elgort", "Tatchakrit Matyakhan", "Thidawan Wichanee", "Atichat Rungswang", "Passapong Sripicharn"),
        doi="10.70730/JCOL6093",
        published_at="2026-07-30",
        first_label=581,
        page_count=25,
        sha256="ac918b24d6ce40dbd8a97ec1046501cc96f4b9d10f93c1b41678999a8da19ae1",
        article_url="https://so04.tci-thaijo.org/index.php/LEARN/article/view/291567",
        pdf_url="https://so04.tci-thaijo.org/index.php/LEARN/article/download/291567/192912/1318798",
    ),
)


RIGHTS_ACTIONS = {
    "metadata_indexing": True,
    "source_download": True,
    "asset_storage": True,
    "text_extraction": True,
    "native_fulltext_display": True,
    "publisher_embedding": False,
    "user_download": True,
    "snippet_display": True,
    "embedding": True,
    "summarization": True,
    "translation": True,
    "annotation": True,
    "redistribution": True,
    "commercial_use": True,
    "model_training": False,
}


HEADING_PATTERNS = (
    "abstract",
    "introduction",
    "literature review",
    "research methodology",
    "methodology",
    "methods",
    "results and discussion",
    "results",
    "findings and discussion",
    "findings",
    "discussion",
    "conclusion and recommendations",
    "conclusion",
    "recommendations",
    "acknowledgements",
    "references",
    "appendix",
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_page_text(value: str) -> str:
    value = value.replace("\x00", "").replace("\f", "")
    lines = [line.rstrip() for line in value.splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return re.sub(r"\n{4,}", "\n\n\n", "\n".join(lines)).strip()


def section_title(text: str, previous: str | None, page_label: int) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    for line in lines:
        normalized = re.sub(r"^[0-9IVXivx.()\s]+", "", line).strip().lower()
        if any(normalized == heading or normalized.startswith(f"{heading} ") for heading in HEADING_PATTERNS):
            return line[:120]
    return previous or f"Page {page_label}"


def pdf_page_count(path: Path) -> int:
    result = subprocess.run(
        ["pdfinfo", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    match = re.search(r"^Pages:\s+(\d+)\s*$", result.stdout, re.MULTILINE)
    if not match:
        raise RuntimeError(f"Could not read page count for {path}")
    return int(match.group(1))


def extract_page(path: Path, number: int) -> str:
    result = subprocess.run(
        ["pdftotext", "-f", str(number), "-l", str(number), "-layout", str(path), "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return normalize_page_text(result.stdout)


def build(source_dir: Path, output_dir: Path) -> None:
    for command in ("pdfinfo", "pdftotext"):
        if not shutil.which(command):
            raise RuntimeError(f"{command} is required to build the reader pack")

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_papers: list[dict[str, object]] = []

    for paper in PAPERS:
        pdf_path = source_dir / paper.filename
        if not pdf_path.is_file():
            raise FileNotFoundError(f"Missing source PDF: {pdf_path}")
        digest = sha256_bytes(pdf_path.read_bytes())
        if digest != paper.sha256:
            raise RuntimeError(f"Checksum mismatch for {paper.filename}: {digest}")
        actual_pages = pdf_page_count(pdf_path)
        if actual_pages != paper.page_count:
            raise RuntimeError(f"Page-count mismatch for {paper.filename}: {actual_pages}")

        pages: list[dict[str, object]] = []
        previous_section: str | None = None
        for page_number in range(1, paper.page_count + 1):
            text = extract_page(pdf_path, page_number)
            if not text:
                raise RuntimeError(f"Empty text on {paper.filename} page {page_number}")
            page_label = paper.first_label + page_number - 1
            current_section = section_title(text, previous_section, page_label)
            previous_section = current_section
            pages.append(
                {
                    "id": f"thaijo-learn-{paper.article_id}-page-{page_number}",
                    "pageNumber": page_number,
                    "pageLabel": str(page_label),
                    "anchor": f"page-{page_label}",
                    "sectionTitle": current_section,
                    "text": text,
                    "textSha256": sha256_bytes(text.encode("utf-8")),
                }
            )

        pages_filename = f"{paper.article_id}.pages.json"
        (output_dir / pages_filename).write_text(
            json.dumps({"version": "civilmcp-reader-pages-v1", "source": paper.source, "pages": pages}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        manifest_papers.append(
            {
                "source": paper.source,
                "aliases": [paper.provider_record_id, paper.article_url, paper.pdf_url, f"doi:{paper.doi.lower()}"],
                "provider": "tci_thaijo",
                "providerRecordId": paper.provider_record_id,
                "title": paper.title,
                "authors": list(paper.authors),
                "doi": paper.doi,
                "publishedAt": paper.published_at,
                "journalTitle": "LEARN Journal: Language Education and Acquisition Research Network",
                "publisher": "Language Institute, Thammasat University",
                "sourceUrl": paper.article_url,
                "asset": {
                    "id": f"thaijo-learn-{paper.article_id}-pdf",
                    "kind": "fulltext_pdf",
                    "version": "version_of_record",
                    "mimeType": "application/pdf",
                    "language": "en",
                    "pageCount": paper.page_count,
                    "contentSha256": paper.sha256,
                    "originUrl": paper.pdf_url,
                    "licenseExpression": "CC-BY-4.0",
                    "licenseUrl": LICENSE_URL,
                    "rightsStatus": "open_license_verified",
                    "rightsActions": RIGHTS_ACTIONS,
                    "rightsProvenance": {
                        "basis": "official_journal_license_statement",
                        "source": LICENSE_EVIDENCE_URL,
                        "articleSource": paper.article_url,
                        "attribution": f"{paper.title}, {', '.join(paper.authors)}, LEARN Journal 19(2), 2026",
                        "transformationNotice": "Publisher PDF converted to page-addressable plain text; substantive content unchanged.",
                    },
                    "rightsCheckedAt": PACK_DATE,
                    "rightsVerifiedAt": PACK_DATE,
                    "readerAccessMode": "native_verified",
                },
                "pagesFile": pages_filename,
            }
        )

    manifest = {
        "version": "civilmcp-rights-reviewed-reader-pack-v1",
        "generatedAt": PACK_DATE,
        "reviewedBy": "CivilMCP source-rights review",
        "scope": "Three ThaiJO-hosted LEARN Journal papers with publisher-declared CC BY 4.0 rights.",
        "licenseEvidenceUrl": LICENSE_EVIDENCE_URL,
        "papers": manifest_papers,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "web" / "data" / "reader-papers",
    )
    args = parser.parse_args()
    build(args.source_dir.resolve(), args.output_dir.resolve())
    print(f"Built {len(PAPERS)} verified reader papers in {args.output_dir.resolve()}")


if __name__ == "__main__":
    main()
