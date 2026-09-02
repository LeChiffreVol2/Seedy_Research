#!/usr/bin/env python3
"""Build a fail-closed, rights-reviewed native-reader cohort from ThaiJO.

The committed cohort file fixes the issue denominator and accepted article
types. Network harvesting and PDF extraction are separate from plan validation
so CI can verify the release contract without relying on a publisher website.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

PLAN_VERSION_V1 = "seedy-native-cohort-plan-v1"
PLAN_VERSION_V2 = "seedy-native-cohort-plan-v2"
ARTICLE_ID_PATTERN = re.compile(r"/article/view/(\d+)(?:/|$)")
PDF_PATH_PATTERN = re.compile(r"/article/(?:download|view)/(\d+)(?:/|$)")
USER_AGENT = "SeedyResearchBot/0.1 (+https://seedresearch.vercel.app; rights-reviewed research indexing)"
PACK_VERSION = "civilmcp-rights-reviewed-reader-pack-v1"
PAGE_VERSION = "civilmcp-reader-pages-v1"
DELIVERY_VERSION = "seedy-approved-asset-delivery-v1"
THIRD_PARTY_CREDIT_PATTERNS = (
    re.compile(r"\breproduced\s+with\s+permission\b", re.IGNORECASE),
    re.compile(r"\badapted\s+with\s+permission\b", re.IGNORECASE),
    re.compile(r"\bused\s+with\s+permission\b", re.IGNORECASE),
    re.compile(r"©\s*\d{4}.{0,120}\bpermission\b", re.IGNORECASE),
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
    "background",
    "objective",
    "objectives",
    "materials and methods",
    "methodology",
    "methods",
    "results and discussion",
    "results",
    "discussion",
    "limitations",
    "conclusion",
    "conclusions",
    "acknowledgements",
    "references",
    "appendix",
)


def publisher_path_allowed(path: str) -> bool:
    """Keep automated publisher-page reads inside the published robots boundary."""
    normalized = "/" + path.lstrip("/")
    if re.search(r"/index\.php/[^/]+/(?:article|issue)/download/", normalized, re.IGNORECASE):
        return False
    if re.search(
        r"/index\.php/[^/]+/(?:article|issue)/view/[^/]+/[^/]+",
        normalized,
        re.IGNORECASE,
    ):
        return False
    return True


def load_delivery_manifest(
    path: Path,
    *,
    plan: dict[str, Any],
    expected_article_ids: list[str],
) -> dict[str, dict[str, str]]:
    """Bind an approved delivery to the exact harvested article denominator."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("version") != DELIVERY_VERSION:
        raise ValueError(f"Unsupported asset delivery version: {payload.get('version')!r}")
    expected_evidence = str((plan.get("assetDelivery") or {}).get("evidenceId", "")).strip()
    if payload.get("evidenceId") != expected_evidence:
        raise ValueError("Delivery manifest evidenceId does not match the cohort approval.")
    if payload.get("provider") != plan.get("provider") or payload.get("journalSlug") != plan.get("journalSlug"):
        raise ValueError("Delivery manifest provider or journal does not match the cohort.")
    assets = payload.get("assets")
    if not isinstance(assets, list):
        raise ValueError("Delivery manifest assets must be a list.")
    by_id: dict[str, dict[str, str]] = {}
    for asset in assets:
        article_id = str(asset.get("articleId", "")).strip()
        if not article_id or article_id in by_id:
            raise ValueError(f"Delivery manifest has a missing or duplicate articleId: {article_id!r}")
        by_id[article_id] = asset
    if set(by_id) != set(expected_article_ids) or len(by_id) != len(expected_article_ids):
        raise ValueError("Delivery manifest article denominator does not match the harvested cohort.")
    for article_id, asset in by_id.items():
        filename = str(asset.get("filename", "")).strip()
        checksum = str(asset.get("sha256", "")).strip().lower()
        if Path(filename).name != filename or not filename.lower().endswith(".pdf"):
            raise ValueError(f"Delivery manifest article {article_id} has an unsafe PDF filename.")
        if not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise ValueError(f"Delivery manifest article {article_id} has an invalid SHA-256 checksum.")
        asset["sha256"] = checksum
    return by_id


def load_plan(path: Path) -> dict[str, Any]:
    plan = json.loads(path.read_text(encoding="utf-8"))
    version = plan.get("version")
    if version not in (PLAN_VERSION_V1, PLAN_VERSION_V2):
        raise ValueError(f"Unsupported cohort plan version: {plan.get('version')!r}")
    plan = dict(plan)
    required_text = (
        "cohortId",
        "provider",
        "journalSlug",
        "journalTitle",
        "publisher",
        "discipline",
        "tciTier",
        "tciEvidenceUrl",
        "licenseExpression",
        "licenseUrl",
        "rightsEvidenceUrl",
    )
    for field in required_text:
        if not str(plan.get(field, "")).strip():
            raise ValueError(f"Cohort plan field {field} is required.")
    if plan["provider"] != "tci_thaijo":
        raise ValueError("Native ThaiJO cohorts must use the reviewed tci_thaijo provider contract.")
    if plan["licenseExpression"] != "CC-BY-4.0":
        raise ValueError("Automated native promotion requires item-level CC-BY-4.0.")
    allowed = plan.get("allowedSections")
    if not isinstance(allowed, list) or not allowed or any(not str(item).strip() for item in allowed):
        raise ValueError("allowedSections must be a non-empty list of exact publisher section names.")
    if len(allowed) != len(set(allowed)):
        raise ValueError("allowedSections must not contain duplicates.")

    if version == PLAN_VERSION_V1:
        if plan["tciTier"] != "group_1":
            raise ValueError("The v1 BSCM cohort must remain TCI Group 1.")
        if plan.get("medicalResearchOnly") is not True:
            raise ValueError("medicalResearchOnly must be true for the v1 biomedical cohort.")
        if allowed != ["Original Article", "Review Article"]:
            raise ValueError("The v1 allowedSections must remain Original Article and Review Article.")
        plan.setdefault("sourceHost", "he01.tci-thaijo.org")
        plan.setdefault("sourcePrefix", "bscm")
        plan.setdefault("minimumNativePapers", 100)
        plan.setdefault("assetDelivery", {
            "mode": "manual_article_delivery",
            "evidenceId": plan["cohortId"],
            "takedownContact": "BSCM editorial office",
        })
    else:
        source_host = str(plan.get("sourceHost", "")).strip().lower()
        registry_path = Path(__file__).resolve().parent / "tci_official_endpoint_registry.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        official_hosts = {
            urlparse(str(item.get("endpoint", ""))).netloc.lower()
            for item in registry.get("endpoints", [])
        }
        if source_host not in official_hosts:
            raise ValueError(f"sourceHost is not in the official ThaiJO endpoint registry: {source_host!r}")
        source_prefix = str(plan.get("sourcePrefix", "")).strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,39}", source_prefix):
            raise ValueError("sourcePrefix must be a stable lowercase source key.")
        if plan.get("tciTier") not in ("group_1", "group_2"):
            raise ValueError("tciTier must be group_1 or group_2 for a v2 ThaiJO cohort.")
        if not isinstance(plan.get("medicalResearchOnly"), bool):
            raise ValueError("medicalResearchOnly must be an explicit boolean.")
        minimum = plan.get("minimumNativePapers")
        if not isinstance(minimum, int) or minimum < 1:
            raise ValueError("minimumNativePapers must be a positive integer.")
        delivery = plan.get("assetDelivery")
        if not isinstance(delivery, dict):
            raise ValueError("assetDelivery is required for a v2 cohort.")
        if delivery.get("mode") not in (
            "publisher_manifest",
            "institutional_deposit",
            "manual_article_delivery",
        ):
            raise ValueError("assetDelivery.mode must be an approved non-crawl delivery mode.")
        evidence_id = str(delivery.get("evidenceId", "")).strip()
        takedown_contact = str(delivery.get("takedownContact", "")).strip()
        if not evidence_id or not takedown_contact:
            raise ValueError("assetDelivery requires evidenceId and takedownContact.")
        if evidence_id.lower() in {"none", "pending", "todo", "tbd"}:
            raise ValueError("assetDelivery.evidenceId must identify an approved delivery, not a placeholder.")

    for field in ("tciEvidenceUrl", "licenseUrl", "rightsEvidenceUrl"):
        parsed_evidence = urlparse(str(plan[field]))
        if parsed_evidence.scheme != "https" or not parsed_evidence.netloc:
            raise ValueError(f"{field} must be an HTTPS evidence URL.")
    issues = plan.get("issues")
    if not isinstance(issues, list) or not issues:
        raise ValueError("Cohort plan must contain at least one issue.")
    seen: set[str] = set()
    denominator = 0
    for issue in issues:
        issue_id = str(issue.get("issueId", "")).strip()
        if not issue_id or issue_id in seen:
            raise ValueError(f"Missing or duplicate issueId: {issue_id!r}")
        seen.add(issue_id)
        parsed_issue = urlparse(str(issue.get("url", "")))
        expected_issue_path = f"/index.php/{plan['journalSlug']}/issue/view/"
        if (
            parsed_issue.scheme != "https"
            or parsed_issue.netloc.lower() != plan["sourceHost"]
            or expected_issue_path.lower() not in parsed_issue.path.lower()
        ):
            raise ValueError(f"Issue {issue_id} is not on the reviewed official host.")
        expected = issue.get("expectedEligible")
        if not isinstance(expected, int) or expected < 1:
            raise ValueError(f"Issue {issue_id} expectedEligible must be a positive integer.")
        denominator += expected
    expected_total = plan.get("expectedEligiblePapers")
    if expected_total != denominator:
        raise ValueError(
            f"expectedEligiblePapers={expected_total!r} does not match fixed issue denominator {denominator}."
        )
    if expected_total < plan["minimumNativePapers"]:
        raise ValueError("expectedEligiblePapers must meet minimumNativePapers for the release gate.")
    return plan


def plan_summary(plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "plan_valid",
        "cohortId": plan["cohortId"],
        "papers": plan["expectedEligiblePapers"],
        "issues": len(plan["issues"]),
        "tciTier": plan["tciTier"],
        "licenseExpression": plan["licenseExpression"],
        "medicalResearchOnly": plan["medicalResearchOnly"],
        "sourceHost": plan["sourceHost"],
        "assetDeliveryMode": (plan.get("assetDelivery") or {}).get("mode", "legacy_manual_delivery"),
    }


def parse_issue_html(
    html: str,
    *,
    issue_id: str,
    allowed_sections: list[str],
    expected_host: str = "he01.tci-thaijo.org",
) -> list[dict[str, str]]:
    """Return the fixed-denominator article identities from an OJS issue."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    records: list[dict[str, str]] = []
    seen: set[str] = set()
    for section_node in soup.select(".sections .section"):
        heading = section_node.find("h2")
        section = heading.get_text(" ", strip=True) if heading else ""
        if section not in allowed_sections:
            continue
        for summary in section_node.select(".obj_article_summary"):
            link = summary.select_one("h3.title a[href]")
            if not link:
                raise ValueError(f"Issue {issue_id} contains an eligible article without a canonical link.")
            article_url = str(link.get("href", "")).strip()
            parsed_url = urlparse(article_url)
            match = ARTICLE_ID_PATTERN.search(parsed_url.path)
            if parsed_url.scheme != "https" or parsed_url.netloc != expected_host or not match:
                raise ValueError(f"Issue {issue_id} contains a non-reviewed article URL: {article_url!r}")
            article_id = match.group(1)
            if article_id in seen:
                raise ValueError(f"Issue {issue_id} contains duplicate article {article_id}.")
            seen.add(article_id)
            records.append(
                {
                    "articleId": article_id,
                    "articleUrl": article_url,
                    "section": section,
                    "issueId": issue_id,
                    "issueTitle": "",
                    "title": link.get_text(" ", strip=True),
                }
            )
    return records


def _meta_values(soup: Any, name: str) -> list[str]:
    return [
        str(node.get("content", "")).strip()
        for node in soup.find_all("meta", attrs={"name": name})
        if str(node.get("content", "")).strip()
    ]


def _meta_one(soup: Any, *names: str) -> str | None:
    for name in names:
        values = _meta_values(soup, name)
        if values:
            return values[0]
    return None


def parse_article_html(
    html: str,
    *,
    article_url: str,
    expected_article_id: str,
    expected_section: str,
    license_url: str,
    expected_host: str = "he01.tci-thaijo.org",
) -> dict[str, Any]:
    """Extract article metadata only after item-level license verification."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    identifier = _meta_one(soup, "DC.Identifier")
    if identifier != expected_article_id:
        raise ValueError(f"Article identity mismatch: expected {expected_article_id}, got {identifier!r}.")
    item_license_values = _meta_values(soup, "DC.Rights")
    license_links = {
        str(node.get("href", "")).strip()
        for node in soup.select('a[rel~="license"][href]')
    }
    if license_url not in item_license_values or license_url not in license_links:
        raise ValueError(f"Article {expected_article_id} has no exact item-level license evidence for {license_url}.")
    article_type = _meta_one(soup, "DC.Type.articleType")
    if article_type != expected_section:
        raise ValueError(
            f"Article {expected_article_id} section changed from {expected_section!r} to {article_type!r}."
        )
    title = _meta_one(soup, "citation_title", "DC.Title")
    authors = _meta_values(soup, "citation_author") or _meta_values(soup, "DC.Creator.PersonalName")
    pdf_url = _meta_one(soup, "citation_pdf_url")
    published_at = _meta_one(soup, "DC.Date.issued")
    language = _meta_one(soup, "DC.Language", "citation_language")
    if not title or not authors or not pdf_url or not published_at or not language:
        raise ValueError(f"Article {expected_article_id} is missing required publisher metadata.")
    parsed_pdf = urlparse(pdf_url)
    pdf_match = PDF_PATH_PATTERN.search(parsed_pdf.path)
    if (
        parsed_pdf.scheme != "https"
        or parsed_pdf.netloc != expected_host
        or not pdf_match
        or pdf_match.group(1) != expected_article_id
    ):
        raise ValueError(f"Article {expected_article_id} has an invalid official PDF URL: {pdf_url!r}")
    page_range = _meta_one(soup, "DC.Identifier.pageNumber") or ""
    page_match = re.fullmatch(r"\s*(\d+)\s*[-–]\s*(\d+)\s*", page_range)
    first_page = int(page_match.group(1)) if page_match else None
    last_page = int(page_match.group(2)) if page_match else None
    if first_page is not None and last_page is not None and last_page < first_page:
        raise ValueError(f"Article {expected_article_id} has an invalid source page range: {page_range!r}")
    doi = _meta_one(soup, "citation_doi", "DC.Identifier.DOI")
    if doi:
        doi = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", doi, flags=re.IGNORECASE).strip()
        if not doi.lower().startswith("10.") or "/" not in doi:
            raise ValueError(f"Article {expected_article_id} has an invalid DOI: {doi!r}")
    return {
        "articleId": expected_article_id,
        "articleUrl": article_url,
        "section": expected_section,
        "title": title,
        "authors": authors,
        "doi": doi,
        "publishedAt": published_at,
        "language": language.lower(),
        "pdfUrl": pdf_url,
        "firstPageLabel": first_page,
        "lastPageLabel": last_page,
    }


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _normalize_page_text(value: str) -> str:
    value = value.replace("\x00", "").replace("\f", "")
    lines = [line.rstrip() for line in value.splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return re.sub(r"\n{4,}", "\n\n\n", "\n".join(lines)).strip()


def _section_title(text: str, previous: str | None, page_label: str) -> str:
    for line in text.splitlines():
        candidate = re.sub(r"\s+", " ", line).strip()
        normalized = re.sub(r"^[0-9IVXivx.()\s]+", "", candidate).strip().lower()
        if any(normalized == heading or normalized.startswith(f"{heading} ") for heading in HEADING_PATTERNS):
            return candidate[:120]
    return previous or f"Page {page_label}"


def _pdf_page_count(path: Path) -> int:
    result = subprocess.run(["pdfinfo", str(path)], check=True, capture_output=True, text=True)
    match = re.search(r"^Pages:\s+(\d+)\s*$", result.stdout, re.MULTILINE)
    if not match:
        raise ValueError(f"Could not read a page count from {path.name}.")
    return int(match.group(1))


def _extract_pdf_pages(path: Path, expected_pages: int) -> list[str]:
    result = subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        check=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )
    pages = [_normalize_page_text(page) for page in result.stdout.split("\f")]
    if pages and not pages[-1]:
        pages.pop()
    if len(pages) != expected_pages:
        raise ValueError(f"PDF extraction returned {len(pages)} pages; expected {expected_pages} for {path.name}.")
    if any(not page for page in pages):
        empty = [index + 1 for index, page in enumerate(pages) if not page]
        raise ValueError(f"PDF contains empty extracted pages {empty[:10]} for {path.name}.")
    return pages


def _third_party_credit_signals(pages: list[str]) -> list[str]:
    text = "\n".join(pages)
    signals: list[str] = []
    for pattern in THIRD_PARTY_CREDIT_PATTERNS:
        match = pattern.search(text)
        if match:
            signals.append(re.sub(r"\s+", " ", text[max(0, match.start() - 80):match.end() + 80]).strip())
    return signals


class PublisherClient:
    def __init__(self, cache_dir: Path, request_delay_seconds: float, max_retries: int, allowed_hosts: set[str]) -> None:
        import requests

        if request_delay_seconds < 5.0:
            raise ValueError("Publisher page requests require a delay of at least 5 seconds.")
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.delay = request_delay_seconds
        self.max_retries = max(1, max_retries)
        self.last_request_at = 0.0
        self.session = requests.Session()
        self.allowed_hosts = allowed_hosts
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.5"})

    def fetch(self, url: str, cache_name: str) -> bytes:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc not in self.allowed_hosts:
            raise ValueError(f"Publisher fetch left the reviewed official host: {url}")
        if not publisher_path_allowed(parsed.path):
            raise ValueError(f"Publisher fetch is excluded by the ThaiJO robots boundary: {url}")
        cache_path = self.cache_dir / cache_name
        if cache_path.is_file():
            return cache_path.read_bytes()
        failure: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            remaining = self.delay - (time.monotonic() - self.last_request_at)
            if remaining > 0:
                time.sleep(remaining)
            try:
                response = self.session.get(url, timeout=(15, 90), allow_redirects=True)
                self.last_request_at = time.monotonic()
                if response.status_code == 429:
                    retry_after = response.headers.get("Retry-After", "")
                    wait = float(retry_after) if retry_after.replace(".", "", 1).isdigit() else min(60.0, 4.0 * attempt)
                    time.sleep(max(self.delay, wait))
                    continue
                response.raise_for_status()
                final = urlparse(response.url)
                if final.scheme != "https" or final.netloc not in self.allowed_hosts:
                    raise ValueError(f"Publisher redirect left the reviewed official host: {response.url}")
                if not publisher_path_allowed(final.path):
                    raise ValueError(f"Publisher redirect entered a ThaiJO robots-excluded path: {response.url}")
                data = response.content
                temporary = cache_path.with_suffix(cache_path.suffix + ".partial")
                temporary.write_bytes(data)
                temporary.replace(cache_path)
                return data
            except Exception as exc:  # network failures are retried and then surfaced
                failure = exc
                if attempt < self.max_retries:
                    time.sleep(min(60.0, 3.0 * attempt))
        raise RuntimeError(f"Publisher fetch failed after {self.max_retries} attempts: {url}: {failure}") from failure


def harvest_catalog(plan: dict[str, Any], client: PublisherClient) -> list[dict[str, Any]]:
    candidates: list[dict[str, str]] = []
    for issue in plan["issues"]:
        issue_id = issue["issueId"]
        print(f"[catalog] issue {issue_id} ({issue['label']})", file=sys.stderr, flush=True)
        html = client.fetch(issue["url"], f"issue-{issue_id}.html").decode("utf-8", errors="replace")
        issue_candidates = parse_issue_html(
            html,
            issue_id=issue_id,
            allowed_sections=plan["allowedSections"],
            expected_host=plan["sourceHost"],
        )
        if len(issue_candidates) != issue["expectedEligible"]:
            raise ValueError(
                f"Issue {issue_id} denominator changed: expected {issue['expectedEligible']}, found {len(issue_candidates)}."
            )
        for candidate in issue_candidates:
            candidate["issueTitle"] = issue["label"]
        candidates.extend(issue_candidates)
    if len(candidates) != plan["expectedEligiblePapers"]:
        raise ValueError(
            f"Cohort denominator changed: expected {plan['expectedEligiblePapers']}, found {len(candidates)}."
        )
    ids = [candidate["articleId"] for candidate in candidates]
    if len(ids) != len(set(ids)):
        raise ValueError("Cohort contains duplicate article IDs across issues.")

    records: list[dict[str, Any]] = []
    for position, candidate in enumerate(candidates, 1):
        article_id = candidate["articleId"]
        print(f"[catalog] article {position}/{len(candidates)} id={article_id}", file=sys.stderr, flush=True)
        html = client.fetch(candidate["articleUrl"], f"article-{article_id}.html").decode("utf-8", errors="replace")
        record = parse_article_html(
            html,
            article_url=candidate["articleUrl"],
            expected_article_id=article_id,
            expected_section=candidate["section"],
            license_url=plan["licenseUrl"],
            expected_host=plan["sourceHost"],
        )
        if re.sub(r"\s+", " ", record["title"]).strip() != re.sub(r"\s+", " ", candidate["title"]).strip():
            raise ValueError(f"Article {article_id} title differs between issue and item pages.")
        records.append({**record, "issueId": candidate["issueId"], "issueTitle": candidate["issueTitle"]})
    return records


def build_pack(
    plan: dict[str, Any],
    records: list[dict[str, Any]],
    output_dir: Path,
    asset_dir: Path,
    delivery_assets: dict[str, dict[str, str]],
) -> dict[str, Any]:
    for command in ("pdfinfo", "pdftotext"):
        if not shutil.which(command):
            raise RuntimeError(f"{command} is required to build a native reader cohort.")
    if len(records) != plan["expectedEligiblePapers"]:
        raise ValueError("Catalog is not the fixed reviewed cohort denominator.")
    output_dir.mkdir(parents=True, exist_ok=True)
    reviewed_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    papers: list[dict[str, Any]] = []
    total_pages = 0
    for position, record in enumerate(records, 1):
        article_id = record["articleId"]
        print(f"[reader] paper {position}/{len(records)} id={article_id}", file=sys.stderr, flush=True)
        delivery_asset = delivery_assets[article_id]
        pdf_path = asset_dir / delivery_asset["filename"]
        if not pdf_path.is_file():
            raise ValueError(f"Approved delivery is missing article {article_id} PDF in {asset_dir}.")
        pdf_data = pdf_path.read_bytes()
        if not pdf_data.startswith(b"%PDF-"):
            raise ValueError(f"Approved delivery asset is not a PDF: {pdf_path}")
        if _sha256(pdf_data) != delivery_asset["sha256"]:
            raise ValueError(f"Approved delivery checksum mismatch for article {article_id}.")
        page_count = _pdf_page_count(pdf_path)
        extracted = _extract_pdf_pages(pdf_path, page_count)
        credit_signals = _third_party_credit_signals(extracted)
        if credit_signals:
            raise ValueError(
                f"Article {article_id} has explicit third-party permission language and must be manually reviewed: {credit_signals[0]}"
            )
        first_label = record.get("firstPageLabel")
        last_label = record.get("lastPageLabel")
        use_source_labels = (
            isinstance(first_label, int)
            and isinstance(last_label, int)
            and last_label - first_label + 1 == page_count
        )
        pages: list[dict[str, Any]] = []
        previous_section: str | None = None
        for page_number, text in enumerate(extracted, 1):
            page_label = str(first_label + page_number - 1) if use_source_labels else str(page_number)
            current_section = _section_title(text, previous_section, page_label)
            previous_section = current_section
            pages.append(
                {
                    "id": f"thaijo-{plan['sourcePrefix']}-{article_id}-page-{page_number}",
                    "pageNumber": page_number,
                    "pageLabel": page_label,
                    "anchor": f"page-{page_label}",
                    "sectionTitle": current_section,
                    "text": text,
                    "textSha256": _sha256(text.encode("utf-8")),
                }
            )
        pages_filename = f"{article_id}.pages.json"
        (output_dir / pages_filename).write_text(
            json.dumps(
                {"version": PAGE_VERSION, "source": f"thaijo:{plan['sourcePrefix']}:{article_id}", "pages": pages},
                ensure_ascii=False,
                indent=2,
            ) + "\n",
            encoding="utf-8",
        )
        total_pages += page_count
        doi = record.get("doi")
        aliases = [
            f"oai:{plan['sourceHost']}:article/{article_id}",
            record["articleUrl"],
            record["pdfUrl"],
        ]
        if doi:
            aliases.append(f"doi:{str(doi).lower()}")
        papers.append(
            {
                "source": f"thaijo:{plan['sourcePrefix']}:{article_id}",
                "aliases": aliases,
                "provider": plan["provider"],
                "providerRecordId": f"oai:{plan['sourceHost']}:article/{article_id}",
                "articleType": record["section"],
                "tciTier": plan["tciTier"],
                "title": record["title"],
                "authors": record["authors"],
                "doi": doi,
                "publishedAt": record["publishedAt"],
                "journalTitle": plan["journalTitle"],
                "publisher": plan["publisher"],
                "discipline": plan["discipline"],
                "issueId": record["issueId"],
                "issueTitle": record["issueTitle"],
                "medicalResearchOnly": plan["medicalResearchOnly"],
                "sourceUrl": record["articleUrl"],
                "asset": {
                    "id": f"thaijo-{plan['sourcePrefix']}-{article_id}-pdf",
                    "kind": "fulltext_pdf",
                    "version": "version_of_record",
                    "mimeType": "application/pdf",
                    "language": record["language"],
                    "byteSize": len(pdf_data),
                    "pageCount": page_count,
                    "contentSha256": _sha256(pdf_data),
                    "originUrl": record["pdfUrl"],
                    "licenseExpression": plan["licenseExpression"],
                    "licenseUrl": plan["licenseUrl"],
                    "rightsStatus": "open_license_verified",
                    "rightsActions": RIGHTS_ACTIONS,
                    "rightsProvenance": {
                        "basis": "item_level_license_and_approved_asset_delivery",
                        "source": record["articleUrl"],
                        "journalPolicy": plan["rightsEvidenceUrl"],
                        "tciEvidence": plan["tciEvidenceUrl"],
                        "itemLicense": plan["licenseUrl"],
                        "attribution": f"{record['title']}, {', '.join(record['authors'])}, {plan['journalTitle']}",
                        "transformationNotice": "Publisher PDF converted to page-addressable plain text; substantive content unchanged.",
                        "thirdPartyCreditScan": "passed_no_explicit_permission_language",
                        "assetDelivery": plan.get("assetDelivery") or {
                            "mode": "legacy_manual_delivery",
                            "evidenceId": plan["cohortId"],
                        },
                        "approvedAssetSha256": delivery_asset["sha256"],
                    },
                    "rightsCheckedAt": reviewed_at,
                    "rightsVerifiedAt": reviewed_at,
                    "readerAccessMode": "native_verified",
                },
                "pagesFile": pages_filename,
            }
        )
    manifest = {
        "version": PACK_VERSION,
        "generatedAt": reviewed_at,
        "reviewedBy": "Seedy Research item-level rights and integrity gate",
        "scope": (
            f"Fixed {plan['journalTitle']} cohort: {', '.join(plan['allowedSections'])} "
            "with item-level CC BY 4.0 and approved asset delivery."
        ),
        "cohortId": plan["cohortId"],
        "licenseEvidenceUrl": plan["rightsEvidenceUrl"],
        "releaseGate": {
            "minimumNativePapers": plan["minimumNativePapers"],
            "expectedNativePapers": plan["expectedEligiblePapers"],
            "allowedArticleTypes": plan["allowedSections"],
            "medicalResearchOnly": plan["medicalResearchOnly"],
            "allowedTciTiers": [plan["tciTier"]],
            "assetDeliveryMode": (plan.get("assetDelivery") or {}).get("mode", "legacy_manual_delivery"),
            "rightsMode": "item_level_fail_closed",
            "integrity": ["application_pdf", "sha256", "page_count", "nonempty_page_text", "page_text_sha256"],
        },
        "papers": papers,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {"papers": len(papers), "pages": total_pages, "generatedAt": reviewed_at}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, required=True)
    parser.add_argument("--validate-plan", action="store_true")
    parser.add_argument("--harvest", action="store_true", help="Fetch and validate issue and article pages.")
    parser.add_argument("--build", action="store_true", help="Also verify and extract approved local publisher PDFs.")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--asset-dir", type=Path, help="Approved local PDF delivery; automated PDF crawling is not supported.")
    parser.add_argument("--delivery-manifest", type=Path, help="Checksum manifest binding the approved delivery to this cohort.")
    parser.add_argument("--request-delay-seconds", type=float, default=5.2)
    parser.add_argument("--max-retries", type=int, default=6)
    args = parser.parse_args()
    try:
        plan = load_plan(args.cohort.resolve())
        if args.validate_plan:
            print(json.dumps(plan_summary(plan), ensure_ascii=False, indent=2))
            return
        if not args.harvest and not args.build:
            parser.error("Choose --validate-plan, --harvest, or --build.")
        if args.request_delay_seconds < 5.0:
            parser.error("--request-delay-seconds must be at least 5 seconds for ThaiJO page requests.")
        if args.build and args.asset_dir is None:
            parser.error("--build requires --asset-dir from an approved publisher or institutional delivery.")
        if args.build and args.delivery_manifest is None:
            parser.error("--build requires --delivery-manifest with one checksum-bound asset per article.")
        root = Path(__file__).resolve().parents[1]
        output_dir = (args.output_dir or root / "pipeline" / "data" / "reader-packs" / plan["cohortId"]).resolve()
        cache_dir = (args.cache_dir or output_dir / ".cache").resolve()
        client = PublisherClient(
            cache_dir,
            args.request_delay_seconds,
            args.max_retries,
            {plan["sourceHost"]},
        )
        records = harvest_catalog(plan, client)
        catalog_path = output_dir / "catalog.json"
        output_dir.mkdir(parents=True, exist_ok=True)
        catalog_path.write_text(
            json.dumps({"version": "seedy-native-cohort-catalog-v1", "cohortId": plan["cohortId"], "records": records}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if args.build:
            delivery_assets = load_delivery_manifest(
                args.delivery_manifest.resolve(),
                plan=plan,
                expected_article_ids=[record["articleId"] for record in records],
            )
            result = build_pack(
                plan,
                records,
                output_dir,
                args.asset_dir.resolve(),
                delivery_assets,
            )
            status = "pack_built"
        else:
            result = {"papers": len(records), "pages": None}
            status = "catalog_verified"
        print(json.dumps({"status": status, "cohortId": plan["cohortId"], **result, "outputDir": str(output_dir)}, ensure_ascii=False, indent=2))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"cohort validation failed: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
