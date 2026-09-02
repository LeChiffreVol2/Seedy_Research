#!/usr/bin/env python3
"""Build a rights-verified Thai-affiliated full-paper reader pack from PMC OA.

The acquisition path is intentionally limited to NLM's official E-utilities
and public PMC Article Datasets bucket. Publisher pages are never crawled.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests

try:
    from pipeline.build_native_reader_cohort import (
        RIGHTS_ACTIONS,
        _extract_pdf_pages,
        _pdf_page_count,
        _section_title,
        _third_party_credit_signals,
    )
except ModuleNotFoundError:  # direct `python pipeline/script.py` execution
    from build_native_reader_cohort import (  # type: ignore[no-redef]
        RIGHTS_ACTIONS,
        _extract_pdf_pages,
        _pdf_page_count,
        _section_title,
        _third_party_credit_signals,
    )


ARTICLE_TYPES = {
    "research-article": "Research Article",
    "review-article": "Review Article",
    "systematic-review": "Systematic Review",
    "meta-analysis": "Meta-analysis",
    "methods-article": "Methods Article",
    "rapid-communication": "Research Article",
}
XLINK_HREF = "{http://www.w3.org/1999/xlink}href"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
PMC_BUCKET = "pmc-oa-opendata"
PACK_VERSION = "civilmcp-rights-reviewed-reader-pack-v1"
PAGE_VERSION = "civilmcp-reader-pages-v1"
PROVIDER = "pmc_oa"
COLLECTION = "thai_affiliated_global_oa"
DEFAULT_QUERY = (
    "Thailand[Affiliation] AND cc_by_license[filter] AND open_access[filter] AND has_pdf[filter] "
    "AND 2000:2025[dp] NOT articletypecorrection NOT articletyperetraction NOT hasretractionin "
    "NOT preprint[filter] NOT author_manuscript[filter]"
)
USER_AGENT = "SeedyResearch/1.0 (https://seedresearch.vercel.app; research@seedresearch.app)"
HEADERS = {"User-Agent": USER_AGENT, "Accept-Encoding": "gzip, deflate"}


def _text(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return re.sub(r"\s+", " ", "".join(element.itertext())).strip()


def _find_by_attribute(root: ET.Element, tag: str, attribute: str, value: str) -> ET.Element | None:
    for element in root.iter(tag):
        if element.get(attribute) == value:
            return element
    return None


def _validated_s3_url(value: Any, *, version_id: str, suffix: str) -> tuple[str, str]:
    parsed = urlparse(str(value or ""))
    expected_path = f"/{version_id}/{version_id}.{suffix}"
    checksum = (parse_qs(parsed.query).get("md5") or [""])[0].lower()
    if parsed.scheme != "s3" or parsed.netloc != PMC_BUCKET or parsed.path != expected_path:
        raise ValueError(f"PMC {suffix} URL is outside the expected article-version prefix.")
    if not re.fullmatch(r"[0-9a-f]{32}", checksum):
        raise ValueError(f"PMC {suffix} URL is missing an exact MD5 checksum.")
    return f"https://{PMC_BUCKET}.s3.amazonaws.com{parsed.path}?md5={checksum}", checksum


def validate_cloud_metadata(metadata: dict[str, Any], *, expected_pmcid: str) -> dict[str, Any]:
    """Validate one article-version object from NLM's public PMC AWS dataset."""
    pmcid = str(metadata.get("pmcid") or "").upper()
    if pmcid != expected_pmcid.upper():
        raise ValueError(f"PMC cloud identity mismatch: expected {expected_pmcid}, found {pmcid or 'missing'}.")
    version = metadata.get("version")
    if not isinstance(version, int) or version < 1:
        raise ValueError("PMC cloud metadata is missing a positive article version.")
    if metadata.get("is_pmc_openaccess") is not True:
        raise ValueError("PMC article version is outside the Open Access Subset.")
    if metadata.get("is_manuscript") is True:
        raise ValueError("PMC author manuscripts are outside the version-of-record cohort.")
    if metadata.get("is_historical_ocr") is True:
        raise ValueError("PMC historical OCR records are outside the born-digital cohort.")
    if metadata.get("is_retracted") is not False:
        raise ValueError("PMC article version is retracted or has unknown retraction status.")
    if str(metadata.get("license_code") or "").upper() != "CC BY":
        raise ValueError("PMC article version does not carry the exact CC BY license code.")
    version_id = f"{pmcid}.{version}"
    pdf_url, pdf_md5 = _validated_s3_url(metadata.get("pdf_url"), version_id=version_id, suffix="pdf")
    xml_url, xml_md5 = _validated_s3_url(metadata.get("xml_url"), version_id=version_id, suffix="xml")
    return {
        **metadata,
        "versionId": version_id,
        "pdfUrl": pdf_url,
        "pdfMd5": pdf_md5,
        "xmlUrl": xml_url,
        "xmlMd5": xml_md5,
    }


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _request_bytes(url: str, *, expected_md5: str | None = None, maximum_bytes: int = 30_000_000) -> bytes:
    last_error: Exception | None = None
    for attempt in range(1, 5):
        try:
            response = requests.get(url, headers=HEADERS, timeout=(15, 120))
            if response.status_code == 404:
                raise FileNotFoundError(url)
            if response.status_code in (429, 500, 502, 503, 504):
                raise RuntimeError(f"temporary HTTP {response.status_code}")
            response.raise_for_status()
            data = response.content
            if not data or len(data) > maximum_bytes:
                raise ValueError(f"PMC object size is outside the reviewed limit: {len(data)} bytes")
            if expected_md5 and hashlib.md5(data).hexdigest() != expected_md5:  # noqa: S324 - source checksum contract
                raise ValueError("PMC object MD5 does not match its NLM metadata URL.")
            return data
        except FileNotFoundError:
            raise
        except Exception as exc:
            last_error = exc
            if attempt < 4:
                time.sleep(min(8.0, 1.5 * attempt))
    raise RuntimeError(f"PMC object fetch failed after retries: {url}: {last_error}") from last_error


def search_pmc_ids(query: str, *, candidate_limit: int) -> tuple[int, list[str]]:
    if not 1 <= candidate_limit <= 10_000:
        raise ValueError("candidate_limit must be between 1 and 10,000.")
    response = requests.get(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
        params={
            "db": "pmc",
            "term": query,
            "retmode": "json",
            "retmax": candidate_limit,
            "tool": "seedy_research",
            "email": "research@seedresearch.app",
        },
        headers=HEADERS,
        timeout=(15, 120),
    )
    response.raise_for_status()
    result = response.json()["esearchresult"]
    ids = [f"PMC{str(identifier).strip()}" for identifier in result.get("idlist", [])]
    if len(ids) != len(set(ids)):
        raise ValueError("PMC ESearch returned duplicate identifiers.")
    return int(result["count"]), ids


def fetch_cloud_metadata(pmcid: str, *, maximum_versions: int = 4) -> dict[str, Any]:
    failures: list[str] = []
    for version in range(1, maximum_versions + 1):
        url = f"https://{PMC_BUCKET}.s3.amazonaws.com/metadata/{pmcid}.{version}.json"
        try:
            payload = json.loads(_request_bytes(url, maximum_bytes=1_000_000))
            validated = validate_cloud_metadata(payload, expected_pmcid=pmcid)
            validated["metadataUrl"] = url
            return validated
        except FileNotFoundError:
            continue
        except (ValueError, RuntimeError, json.JSONDecodeError) as exc:
            failures.append(f"v{version}:{exc}")
    detail = "; ".join(failures[:4]) or "no article-version metadata found"
    raise ValueError(f"No eligible PMC version-of-record for {pmcid}: {detail}")


def _download_pdf(url: str, path: Path, *, expected_md5: str, maximum_bytes: int) -> tuple[int, str]:
    md5 = hashlib.md5()  # noqa: S324 - source checksum contract
    sha256 = hashlib.sha256()
    size = 0
    last_error: Exception | None = None
    for attempt in range(1, 5):
        try:
            with requests.get(url, headers=HEADERS, timeout=(15, 180), stream=True) as response:
                if response.status_code in (429, 500, 502, 503, 504):
                    raise RuntimeError(f"temporary HTTP {response.status_code}")
                response.raise_for_status()
                temporary = path.with_suffix(path.suffix + ".partial")
                with temporary.open("wb") as handle:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if not chunk:
                            continue
                        size += len(chunk)
                        if size > maximum_bytes:
                            raise ValueError(f"PMC PDF exceeds {maximum_bytes} bytes.")
                        md5.update(chunk)
                        sha256.update(chunk)
                        handle.write(chunk)
                if md5.hexdigest() != expected_md5:
                    raise ValueError("PMC PDF MD5 does not match its NLM metadata URL.")
                with temporary.open("rb") as handle:
                    signature = handle.read(5)
                if signature != b"%PDF-":
                    raise ValueError("PMC PDF payload does not start with the PDF signature.")
                temporary.replace(path)
                return size, sha256.hexdigest()
        except Exception as exc:
            last_error = exc
            size = 0
            md5 = hashlib.md5()  # noqa: S324 - source checksum contract
            sha256 = hashlib.sha256()
            path.with_suffix(path.suffix + ".partial").unlink(missing_ok=True)
            if attempt < 4:
                time.sleep(min(8.0, 1.5 * attempt))
    raise RuntimeError(f"PMC PDF fetch failed after retries: {url}: {last_error}") from last_error


def _write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def pdf_text_has_cc_by_notice(pages: list[str]) -> bool:
    """Confirm that the exact PDF repeats the attribution licence decision."""
    text = re.sub(r"\s+", " ", "\n".join(pages)).lower()
    return bool(
        re.search(r"creative commons attribution(?:\s+\d(?:\.\d)?)?", text)
        or re.search(r"creativecommons\.org/licenses/by/\d(?:\.\d)?", text)
        or re.search(r"\bcc[ -]?by(?:\s+public copyright license|\s*[-–:]?\s*\d(?:\.\d)?)", text)
    )


def _paper_from_candidate(
    pmcid: str,
    *,
    output_dir: Path,
    maximum_pdf_bytes: int,
    maximum_pages: int,
    existing_dois: set[str],
) -> dict[str, Any]:
    metadata = fetch_cloud_metadata(pmcid)
    xml_data = _request_bytes(metadata["xmlUrl"], expected_md5=metadata["xmlMd5"], maximum_bytes=30_000_000)
    article = parse_article_xml(xml_data, expected_pmcid=pmcid)
    metadata_doi = str(metadata.get("doi") or "").lower()
    if metadata_doi and article["doi"] and metadata_doi != article["doi"]:
        raise ValueError(f"PMC DOI differs between cloud metadata and JATS for {pmcid}.")
    doi = article["doi"] or metadata_doi or None
    if doi and doi in existing_dois:
        raise ValueError(f"PMC DOI already exists in the production native corpus: {doi}")

    with tempfile.TemporaryDirectory(prefix=f"seedy-{pmcid}-") as directory:
        pdf_path = Path(directory) / f"{metadata['versionId']}.pdf"
        byte_size, content_sha256 = _download_pdf(
            metadata["pdfUrl"],
            pdf_path,
            expected_md5=metadata["pdfMd5"],
            maximum_bytes=maximum_pdf_bytes,
        )
        page_count = _pdf_page_count(pdf_path)
        if not 2 <= page_count <= maximum_pages:
            raise ValueError(f"PMC PDF page count {page_count} is outside the reviewed 2-{maximum_pages} range.")
        extracted = _extract_pdf_pages(pdf_path, page_count)
    if not pdf_text_has_cc_by_notice(extracted):
        raise ValueError("PMC PDF does not repeat an identifiable CC BY notice.")
    credit_signals = _third_party_credit_signals(extracted)
    if credit_signals:
        raise ValueError(f"PMC PDF contains third-party permission language: {credit_signals[0]}")

    reviewed_at = _utc_now()
    pages: list[dict[str, Any]] = []
    previous_section: str | None = None
    for page_number, text in enumerate(extracted, 1):
        page_label = str(page_number)
        section_title = _section_title(text, previous_section, page_label)
        previous_section = section_title
        pages.append({
            "id": f"pmc-{metadata['versionId']}-page-{page_number}",
            "pageNumber": page_number,
            "pageLabel": page_label,
            "anchor": f"page-{page_label}",
            "sectionTitle": section_title,
            "text": text,
            "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        })
    source = f"pmc:{metadata['versionId']}"
    pages_file = f"{metadata['versionId']}.pages.json"
    _write_json_atomic(output_dir / pages_file, {"version": PAGE_VERSION, "source": source, "pages": pages})
    aliases = [pmcid, metadata["versionId"], f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/", metadata["pdfUrl"]]
    if doi:
        aliases.append(f"doi:{doi}")
    return {
        "source": source,
        "aliases": aliases,
        "provider": PROVIDER,
        "providerRecordId": metadata["versionId"],
        "collection": COLLECTION,
        "sourceType": "journal_article",
        "articleType": article["articleType"],
        "tciTier": None,
        "title": article["title"],
        "authors": article["authors"],
        "doi": doi,
        "publishedAt": article["publishedAt"],
        "journalTitle": article["journalTitle"],
        "publisher": article["publisher"],
        "discipline": "medical_and_life_sciences",
        "medicalResearchOnly": True,
        "affiliationCountries": article["affiliationCountries"],
        "thaiAffiliationEvidence": article["thaiAffiliationEvidence"],
        "thaiAffiliationLinkage": article["thaiAffiliationLinkage"],
        "sourceUrl": f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/",
        "asset": {
            "id": f"pmc-{metadata['versionId']}-pdf",
            "kind": "fulltext_pdf",
            "version": "version_of_record",
            "mimeType": "application/pdf",
            "language": article["language"],
            "byteSize": byte_size,
            "pageCount": page_count,
            "contentSha256": content_sha256,
            "originUrl": metadata["pdfUrl"],
            "licenseExpression": article["licenseExpression"],
            "licenseUrl": article["licenseUrl"],
            "rightsStatus": "open_license_verified",
            "rightsActions": dict(RIGHTS_ACTIONS),
            "rightsProvenance": {
                "basis": "nlm_pmc_article_version_metadata_jats_item_license_and_s3_checksums",
                "source": metadata["metadataUrl"],
                "articleSource": f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/",
                "itemLicense": article["licenseUrl"],
                "nlmDataset": "NIH NLM NCBI PubMed Central Article Datasets on AWS",
                "nlmDatasetUrl": f"https://{PMC_BUCKET}.s3.amazonaws.com/README.txt",
                "searchQuery": DEFAULT_QUERY,
                "affiliationCountry": "TH",
                "affiliationLinkage": article["thaiAffiliationLinkage"],
                "affiliationEvidence": article["thaiAffiliationEvidence"],
                "sourcePdfMd5": metadata["pdfMd5"],
                "sourceXmlMd5": metadata["xmlMd5"],
                "attribution": f"{article['title']}, {', '.join(article['authors'])}, {article['journalTitle']}",
                "transformationNotice": "NLM-hosted version-of-record PDF converted to page-addressable plain text; substantive content unchanged.",
                "currencyNotice": "Article version verified against the dated NLM object; NLM inventory reconciliation is required for updates or removals.",
                "thirdPartyCreditScan": "passed_no_explicit_permission_language",
            },
            "rightsCheckedAt": reviewed_at,
            "rightsVerifiedAt": reviewed_at,
            "readerAccessMode": "native_verified",
            "extractionMethod": "pdftotext-layout",
        },
        "pagesFile": pages_file,
    }


def _load_existing_dois(path: Path | None) -> set[str]:
    if path is None:
        return set()
    if path.suffix.lower() in (".txt", ".csv"):
        return {
            line.strip().strip('"').lower()
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip().strip('"')
        }
    payload = json.loads(path.read_text(encoding="utf-8"))
    values = payload.get("dois", []) if isinstance(payload, dict) else payload
    if not isinstance(values, list):
        raise ValueError("Existing DOI file must be a list or an object with a dois list.")
    return {str(value).strip().lower() for value in values if str(value).strip()}


def _manifest(*, papers: list[dict[str, Any]], query: str, total_matches: int) -> dict[str, Any]:
    reviewed_at = _utc_now()
    article_types = sorted({paper["articleType"] for paper in papers})
    return {
        "version": PACK_VERSION,
        "generatedAt": reviewed_at,
        "reviewedBy": "Seedy Research PMC item-version rights, Thai-affiliation, integrity, and page gate",
        "scope": (
            f"{len(papers)} version-of-record PMC OA papers with explicit Thailand affiliation and item-level CC BY; "
            "this is a Thai-affiliated global OA cohort, not a local-provider or national-completeness denominator."
        ),
        "cohortId": f"pmc-thai-affiliated-ccby-{len(papers)}",
        "licenseEvidenceUrl": "https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/",
        "sourceQuery": query,
        "sourceMatchesAtBuild": total_matches,
        "releaseGate": {
            "minimumNativePapers": len(papers),
            "expectedNativePapers": len(papers),
            "allowedProviders": [PROVIDER],
            "allowedArticleTypes": article_types,
            "requiredAffiliationCountry": "TH",
            "medicalResearchOnly": True,
            "assetDeliveryMode": "official_open_data_cloud",
            "rightsMode": "item_version_fail_closed",
            "integrity": ["application_pdf", "s3_md5", "sha256", "page_count", "nonempty_page_text", "page_text_sha256"],
        },
        "papers": sorted(papers, key=lambda paper: paper["providerRecordId"]),
    }


def build_pack(
    *,
    output_dir: Path,
    target_papers: int,
    candidate_limit: int,
    workers: int,
    query: str = DEFAULT_QUERY,
    existing_dois_file: Path | None = None,
    maximum_pdf_bytes: int = 50_000_000,
    maximum_pages: int = 100,
) -> dict[str, Any]:
    if target_papers < 1 or target_papers > candidate_limit:
        raise ValueError("target_papers must be positive and cannot exceed candidate_limit.")
    if not 1 <= workers <= 16:
        raise ValueError("workers must be between 1 and 16.")
    for command in ("pdfinfo", "pdftotext"):
        if not shutil.which(command):
            raise RuntimeError(f"{command} is required to build a native reader cohort.")
    output_dir.mkdir(parents=True, exist_ok=True)
    candidates_file = output_dir / "candidate_ids.json"
    if candidates_file.is_file():
        candidate_payload = json.loads(candidates_file.read_text(encoding="utf-8"))
        if candidate_payload.get("query") != query:
            raise ValueError("Saved PMC candidate query differs from the requested query.")
        total_matches = int(candidate_payload["totalMatches"])
        candidates = list(candidate_payload["ids"])
    else:
        total_matches, candidates = search_pmc_ids(query, candidate_limit=candidate_limit)
        _write_json_atomic(candidates_file, {"query": query, "totalMatches": total_matches, "ids": candidates})
    if len(candidates) < target_papers:
        raise ValueError(f"PMC query returned only {len(candidates)} candidates for target {target_papers}.")

    state_file = output_dir / "manifest.partial.json"
    existing_papers: list[dict[str, Any]] = []
    if state_file.is_file():
        state = json.loads(state_file.read_text(encoding="utf-8"))
        existing_papers = list(state.get("papers") or [])
    existing_dois = _load_existing_dois(existing_dois_file)
    for paper in existing_papers:
        if paper.get("doi"):
            existing_dois.add(str(paper["doi"]).lower())
    completed_pmcids = {str(paper["providerRecordId"]).split(".", 1)[0] for paper in existing_papers}
    papers = existing_papers[:target_papers]
    if len(papers) >= target_papers:
        manifest = _manifest(papers=papers, query=query, total_matches=total_matches)
        _write_json_atomic(output_dir / "manifest.json", manifest)
        return manifest

    remaining = [pmcid for pmcid in candidates if pmcid not in completed_pmcids]
    failures: list[dict[str, str]] = []
    candidate_iterator = iter(remaining)
    in_flight: dict[Future[dict[str, Any]], str] = {}

    def submit_one(executor: ThreadPoolExecutor) -> bool:
        try:
            pmcid = next(candidate_iterator)
        except StopIteration:
            return False
        future = executor.submit(
            _paper_from_candidate,
            pmcid,
            output_dir=output_dir,
            maximum_pdf_bytes=maximum_pdf_bytes,
            maximum_pages=maximum_pages,
            existing_dois=existing_dois,
        )
        in_flight[future] = pmcid
        return True

    with ThreadPoolExecutor(max_workers=workers) as executor:
        for _ in range(min(len(remaining), workers * 2)):
            submit_one(executor)
        while in_flight and len(papers) < target_papers:
            done, _pending = wait(in_flight, return_when=FIRST_COMPLETED)
            for future in done:
                pmcid = in_flight.pop(future)
                try:
                    paper = future.result()
                    doi = str(paper.get("doi") or "").lower()
                    if doi and doi in existing_dois:
                        raise ValueError(f"duplicate DOI within promotion cohort: {doi}")
                    papers.append(paper)
                    if doi:
                        existing_dois.add(doi)
                    print(
                        f"[pmc] accepted {len(papers)}/{target_papers} {paper['providerRecordId']} "
                        f"pages={paper['asset']['pageCount']}",
                        file=sys.stderr,
                        flush=True,
                    )
                    if len(papers) % 10 == 0:
                        _write_json_atomic(state_file, {"papers": papers, "failures": failures[-500:]})
                except Exception as exc:
                    failures.append({"pmcid": pmcid, "error": str(exc)[:1000]})
                    print(f"[pmc] rejected {pmcid}: {exc}", file=sys.stderr, flush=True)
                if len(papers) < target_papers:
                    submit_one(executor)
            if len(papers) >= target_papers:
                for future in in_flight:
                    future.cancel()
                break
    _write_json_atomic(state_file, {"papers": papers, "failures": failures[-500:]})
    if len(papers) < target_papers:
        raise RuntimeError(
            f"PMC candidates exhausted with {len(papers)}/{target_papers} accepted; "
            f"{len(failures)} candidates failed."
        )
    manifest = _manifest(papers=papers[:target_papers], query=query, total_matches=total_matches)
    _write_json_atomic(output_dir / "manifest.json", manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--target-papers", type=int, default=897)
    parser.add_argument("--candidate-limit", type=int, default=1_500)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--existing-dois-file", type=Path)
    parser.add_argument("--maximum-pdf-bytes", type=int, default=50_000_000)
    parser.add_argument("--maximum-pages", type=int, default=100)
    args = parser.parse_args()
    try:
        manifest = build_pack(
            output_dir=args.output_dir.resolve(),
            target_papers=args.target_papers,
            candidate_limit=args.candidate_limit,
            workers=args.workers,
            existing_dois_file=args.existing_dois_file.resolve() if args.existing_dois_file else None,
            maximum_pdf_bytes=args.maximum_pdf_bytes,
            maximum_pages=args.maximum_pages,
        )
    except Exception as exc:
        parser.error(str(exc))
    summary = {
        "status": "built",
        "papers": len(manifest["papers"]),
        "pages": sum(paper["asset"]["pageCount"] for paper in manifest["papers"]),
        "sourceMatchesAtBuild": manifest["sourceMatchesAtBuild"],
        "outputDir": str(args.output_dir.resolve()),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def _publication_date(article_meta: ET.Element) -> str:
    candidates = list(article_meta.iter("pub-date"))
    candidates.sort(key=lambda item: item.get("pub-type") not in ("epub", "electronic"))
    for item in candidates:
        year = _text(item.find("year"))
        if not re.fullmatch(r"\d{4}", year):
            continue
        month = _text(item.find("month")) or "1"
        day = _text(item.find("day")) or "1"
        try:
            return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
        except ValueError:
            continue
    raise ValueError("PMC article has no usable publication date.")


def _license(article_meta: ET.Element) -> tuple[str, str]:
    for license_element in article_meta.iter("license"):
        candidates: list[str] = []
        for element in license_element.iter():
            href = (element.get(XLINK_HREF) or element.get("href") or "").strip()
            if href:
                candidates.append(href)
            if element.text:
                candidates.extend(re.findall(r"https?://[^\s<>()]+", element.text))
        for candidate in candidates:
            url = candidate.rstrip(".,;)")
            match = re.fullmatch(r"https?://creativecommons\.org/licenses/by/(\d+(?:\.\d+)?)/?", url)
            if match:
                return f"CC-BY-{match.group(1)}", url
    raise ValueError("PMC article does not expose an exact item-level CC BY license.")


def parse_article_xml(xml_data: bytes, *, expected_pmcid: str) -> dict[str, Any]:
    """Parse the auditable metadata needed for one native-reader paper."""
    root = ET.fromstring(xml_data)
    article_type = ARTICLE_TYPES.get(root.get("article-type", ""))
    if not article_type:
        raise ValueError(f"PMC article type is outside the reviewed research allowlist: {root.get('article-type')!r}")
    article_meta = root.find("./front/article-meta")
    journal_meta = root.find("./front/journal-meta")
    if article_meta is None or journal_meta is None:
        raise ValueError("PMC JATS record is missing front matter metadata.")
    pmcid = _text(_find_by_attribute(article_meta, "article-id", "pub-id-type", "pmcid"))
    if pmcid.upper() != expected_pmcid.upper():
        raise ValueError(f"PMC identity mismatch: expected {expected_pmcid}, found {pmcid or 'missing'}.")

    thai_affiliations: list[tuple[str, str]] = []
    for affiliation in article_meta.iter("aff"):
        value = _text(affiliation)
        countries = list(affiliation.iter("country"))
        is_thai = "thailand" in value.lower() or any(
            country.get("country", "").upper() == "TH" or _text(country).lower() == "thailand"
            for country in countries
        )
        if is_thai and value:
            thai_affiliations.append((affiliation.get("id", ""), value))
    if not thai_affiliations:
        raise ValueError("PMC article has no explicit Thailand affiliation in JATS front matter.")

    thai_ids = {identifier for identifier, _value in thai_affiliations if identifier}
    linkage = "article_affiliation"
    if thai_ids:
        for contributor in article_meta.iter("contrib"):
            if contributor.get("contrib-type") not in (None, "author"):
                continue
            if any(
                xref.get("ref-type") == "aff" and xref.get("rid", "") in thai_ids
                for xref in contributor.iter("xref")
            ):
                linkage = "author_xref"
                break

    authors: list[str] = []
    for contributor in article_meta.iter("contrib"):
        if contributor.get("contrib-type") not in (None, "author"):
            continue
        name = contributor.find("name")
        if name is not None:
            given = _text(name.find("given-names"))
            surname = _text(name.find("surname"))
            rendered = " ".join(part for part in (given, surname) if part)
        else:
            rendered = _text(contributor.find("collab"))
        if rendered:
            authors.append(rendered)
    if not authors:
        raise ValueError("PMC article has no authors in JATS front matter.")

    title = _text(article_meta.find("./title-group/article-title"))
    journal_title = _text(journal_meta.find("./journal-title-group/journal-title"))
    publisher = _text(journal_meta.find("./publisher/publisher-name")) or journal_title
    if not title or not journal_title:
        raise ValueError("PMC article is missing a title or journal title.")
    doi = _text(_find_by_attribute(article_meta, "article-id", "pub-id-type", "doi")).lower() or None
    license_expression, license_url = _license(article_meta)
    return {
        "title": title,
        "authors": authors,
        "doi": doi,
        "publishedAt": _publication_date(article_meta),
        "journalTitle": journal_title,
        "publisher": publisher,
        "articleType": article_type,
        "language": (root.get(XML_LANG) or "en").lower(),
        "affiliationCountries": ["TH"],
        "thaiAffiliationEvidence": [value for _identifier, value in thai_affiliations],
        "thaiAffiliationLinkage": linkage,
        "licenseExpression": license_expression,
        "licenseUrl": license_url,
    }


if __name__ == "__main__":
    main()
