"""
Markdown -> sections/chunks -> 768-dim embeddings -> Supabase pgvector v2.

The v2 indexer is incremental: unchanged section/chunk content keeps its
existing embedding, while changed rows are embedded and upserted.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from langchain_text_splitters import MarkdownTextSplitter
from openai import OpenAI
from openai import RateLimitError
from supabase import Client, create_client

from metadata import infer_discipline_from_code
from text_quality import OCR_CLEANUP_VERSION, clean_markdown_for_index

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT_DIR = PIPELINE_DIR.parent
DEFAULT_MD_DIR = PIPELINE_DIR / "data" / "markdown"
TITLE_OVERRIDES_PATH = ROOT_DIR / "web" / "lib" / "paper-title-overrides.json"

VALID_COLLECTIONS = {"ce_project", "ncce"}

TERMINAL_BATCH_STATUSES = {"completed", "failed", "expired", "cancelled"}
MAX_BATCH_REQUESTS = int(os.getenv("MAX_BATCH_REQUESTS", "10000"))
MAX_BATCH_ESTIMATED_TOKENS = int(os.getenv("MAX_BATCH_ESTIMATED_TOKENS", "2000000"))
MAX_BATCH_INPUTS_PER_REQUEST = int(os.getenv("MAX_BATCH_INPUTS_PER_REQUEST", "64"))
MAX_BATCH_REQUEST_ESTIMATED_TOKENS = int(os.getenv("MAX_BATCH_REQUEST_ESTIMATED_TOKENS", "100000"))
STATUS_RESOURCE_BY_TABLE = {
    "civil_sections_v2": "civil_sections_v2_index_status",
    "civil_chunks_v2": "civil_chunks_v2_index_status",
}


@dataclass(frozen=True)
class Section:
    index: int
    title: str
    content: str


@dataclass
class EmbedJob:
    table: str
    row_id: str
    text: str

    @property
    def custom_id(self) -> str:
        return f"{self.table}:{self.row_id}"


def load_project_env() -> None:
    # Central env first, then module-local overrides.
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(PIPELINE_DIR / ".env")
    load_dotenv()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def compact_text(value: str) -> str:
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def strip_frontmatter(markdown: str) -> tuple[dict[str, str], str]:
    if not markdown.startswith("---\n"):
        return {}, markdown

    end = markdown.find("\n---", 4)
    if end == -1:
        return {}, markdown

    raw_meta = markdown[4:end].strip()
    body = markdown[end + len("\n---") :].lstrip("\n")
    metadata: dict[str, str] = {}
    for line in raw_meta.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    return metadata, body


def get_discipline(stem: str) -> str:
    """
    Parse discipline code from filenames like Y2024_TR_Article_G01.
    """
    return infer_discipline_from_code(stem)


def metadata_text(metadata: dict[str, str], key: str, default: str = "") -> str:
    value = metadata.get(key, default)
    return str(value).strip() if value is not None else default


def metadata_int(metadata: dict[str, str], key: str) -> int | None:
    value = metadata_text(metadata, key)
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def load_title_overrides() -> dict[str, str]:
    if not TITLE_OVERRIDES_PATH.exists():
        return {}
    payload = json.loads(TITLE_OVERRIDES_PATH.read_text(encoding="utf-8"))
    return {
        str(key): compact_text(str(value))
        for key, value in payload.items()
        if compact_text(str(value))
    }


def effective_title(
    filename: str,
    markdown: str,
    paper_code: str | None,
    document_id: str,
    overrides: dict[str, str],
) -> str:
    override = overrides.get(filename)
    if override:
        return override
    for match in re.finditer(r"^#\s+(.+?)\s*$", markdown, flags=re.MULTILINE):
        title = compact_text(match.group(1))
        if title and not re.fullmatch(r"Page\s+\d+", title, flags=re.IGNORECASE):
            return title[:500]
    return paper_code or document_id


def page_range_for_section(section: Section, doc_page_start: int | None, doc_page_end: int | None) -> tuple[int | None, int | None]:
    match = re.fullmatch(r"Page\s+(\d+)", section.title.strip(), flags=re.IGNORECASE)
    if match:
        page = int(match.group(1))
        return page, page
    return doc_page_start, doc_page_end


def infer_page_range_from_markdown(markdown: str) -> tuple[int | None, int | None]:
    pages = [int(match.group(1)) for match in re.finditer(r"^#{1,6}\s+Page\s+(\d+)\s*$", markdown, flags=re.MULTILINE | re.IGNORECASE)]
    if not pages:
        return None, None
    return min(pages), max(pages)


def split_sections(markdown: str) -> list[Section]:
    sections: list[Section] = []
    current_title = "Document"
    current_lines: list[str] = []
    seen_heading = False

    def flush() -> None:
        nonlocal current_lines
        content = compact_text("\n".join(current_lines))
        if content:
            sections.append(
                Section(
                    index=len(sections),
                    title=compact_text(current_title)[:240] or "Untitled section",
                    content=content,
                )
            )
        current_lines = []

    for line in markdown.splitlines():
        heading = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if heading:
            if seen_heading or compact_text("\n".join(current_lines)):
                flush()
            current_title = heading.group(2)
            current_lines = [line]
            seen_heading = True
            continue
        current_lines.append(line)

    flush()

    if sections:
        return [Section(index=i, title=section.title, content=section.content) for i, section in enumerate(sections)]

    fallback = compact_text(markdown)
    if not fallback:
        return []
    return [Section(index=0, title="Document", content=fallback)]


def embed_batch_sync(
    client: OpenAI,
    model: str,
    dimensions: int,
    texts: list[str],
) -> list[list[float]]:
    response = client.embeddings.create(model=model, input=texts, dimensions=dimensions)
    return [item.embedding for item in response.data]


def estimate_batch_tokens(text: str) -> int:
    # Conservative for mixed Thai/English text; keeps Batch API below org enqueue limits.
    return max(1, len(text))


def split_batch_jobs(jobs: list[EmbedJob]) -> list[list[EmbedJob]]:
    parts: list[list[EmbedJob]] = []
    current: list[EmbedJob] = []
    current_tokens = 0

    for job in jobs:
        job_tokens = estimate_batch_tokens(job.text)
        should_flush = current and (
            len(current) >= MAX_BATCH_REQUESTS
            or current_tokens + job_tokens > MAX_BATCH_ESTIMATED_TOKENS
        )
        if should_flush:
            parts.append(current)
            current = []
            current_tokens = 0

        current.append(job)
        current_tokens += job_tokens

    if current:
        parts.append(current)
    return parts


def group_batch_request_jobs(jobs: list[EmbedJob]) -> list[list[EmbedJob]]:
    groups: list[list[EmbedJob]] = []
    current: list[EmbedJob] = []
    current_tokens = 0

    for job in jobs:
        job_tokens = estimate_batch_tokens(job.text)
        should_flush = current and (
            len(current) >= MAX_BATCH_INPUTS_PER_REQUEST
            or current_tokens + job_tokens > MAX_BATCH_REQUEST_ESTIMATED_TOKENS
        )
        if should_flush:
            groups.append(current)
            current = []
            current_tokens = 0

        current.append(job)
        current_tokens += job_tokens

    if current:
        groups.append(current)
    return groups


def fetch_existing_rows(
    supabase: Client,
    table: str,
    document_id: str,
    page_size: int = 1000,
) -> dict[str, dict[str, Any]]:
    resource = STATUS_RESOURCE_BY_TABLE.get(table, table)
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = (
            supabase.table(resource)
            .select("id, content_hash, has_embedding, is_stale")
            .eq("document_id", document_id)
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return {str(row["id"]): row for row in rows}


def fetch_existing_rows_by_document(
    supabase: Client,
    table: str,
    page_size: int = 1000,
) -> dict[str, dict[str, dict[str, Any]]]:
    resource = STATUS_RESOURCE_BY_TABLE.get(table, table)
    rows_by_document: dict[str, dict[str, dict[str, Any]]] = {}
    offset = 0
    while True:
        page = (
            supabase.table(resource)
            .select("id, document_id, content_hash, has_embedding, is_stale")
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
        for row in page:
            document_id = str(row.get("document_id", ""))
            if not document_id:
                continue
            rows_by_document.setdefault(document_id, {})[str(row["id"])] = row
        if len(page) < page_size:
            break
        offset += page_size
    return rows_by_document


def upsert_rows(supabase: Client, table: str, rows: list[dict[str, Any]], batch_size: int = 200) -> None:
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            supabase.table(table).upsert(batch).execute()
        except Exception as exc:
            if "statement timeout" not in str(exc).lower() or len(batch) <= 25:
                raise
            smaller_batch_size = max(25, len(batch) // 2)
            print(
                f"  {table} upsert timed out for {len(batch)} rows; "
                f"retrying in batches of {smaller_batch_size}",
                flush=True,
            )
            upsert_rows(supabase, table, batch, batch_size=smaller_batch_size)


def update_ids(
    supabase: Client,
    table: str,
    row_ids: list[str],
    payload: dict[str, Any],
    batch_size: int = 200,
) -> None:
    for i in range(0, len(row_ids), batch_size):
        supabase.table(table).update(payload).in_("id", row_ids[i : i + batch_size]).execute()


def build_embedding_body(model: str, dimensions: int, text: str | list[str]) -> dict[str, Any]:
    return {
        "model": model,
        "input": text,
        "dimensions": dimensions,
    }


def embed_jobs_sync(
    client: OpenAI,
    jobs: list[EmbedJob],
    model: str,
    dimensions: int,
    batch_size: int,
    sleep_seconds: float,
) -> dict[str, list[float]]:
    embeddings: dict[str, list[float]] = {}
    for i in range(0, len(jobs), batch_size):
        batch = jobs[i : i + batch_size]
        print(f"Sync embedding batch {i // batch_size + 1}/{(len(jobs) + batch_size - 1) // batch_size}: {len(batch)} jobs", flush=True)
        for attempt in range(1, 8):
            try:
                vectors = embed_batch_sync(client, model, dimensions, [job.text for job in batch])
                break
            except RateLimitError as exc:
                wait_seconds = max(sleep_seconds, min(30.0, attempt * 2.0))
                print(f"  rate limited; retrying in {wait_seconds:.1f}s (attempt {attempt}/7): {exc}", flush=True)
                time.sleep(wait_seconds)
        else:
            vectors = embed_batch_sync(client, model, dimensions, [job.text for job in batch])
        for job, vector in zip(batch, vectors):
            embeddings[job.custom_id] = vector
        time.sleep(sleep_seconds)
    return embeddings


def embed_jobs_batch(
    client: OpenAI,
    jobs: list[EmbedJob],
    model: str,
    dimensions: int,
    poll_seconds: float,
) -> dict[str, list[float]]:
    if not jobs:
        return {}

    estimated_tokens = sum(estimate_batch_tokens(job.text) for job in jobs)
    if len(jobs) > MAX_BATCH_REQUESTS or estimated_tokens > MAX_BATCH_ESTIMATED_TOKENS:
        embeddings: dict[str, list[float]] = {}
        parts = split_batch_jobs(jobs)
        total_parts = len(parts)
        for part_index, part in enumerate(parts, start=1):
            part_tokens = sum(estimate_batch_tokens(job.text) for job in part)
            print(
                f"Batch part {part_index}/{total_parts}: {len(part)} embedding jobs "
                f"(estimated_tokens={part_tokens}, request_limit={MAX_BATCH_REQUESTS})"
            )
            embeddings.update(embed_jobs_batch(client, part, model, dimensions, poll_seconds))
        return embeddings

    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", encoding="utf-8", delete=False) as tmp:
        jsonl_path = Path(tmp.name)
        request_groups = group_batch_request_jobs(jobs)
        request_job_ids: dict[str, list[str]] = {}
        for group_index, group in enumerate(request_groups):
            custom_id = f"group:{group_index:06d}"
            request_job_ids[custom_id] = [job.custom_id for job in group]
            tmp.write(
                json.dumps(
                    {
                        "custom_id": custom_id,
                        "method": "POST",
                        "url": "/v1/embeddings",
                        "body": build_embedding_body(model, dimensions, [job.text for job in group]),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    try:
        with jsonl_path.open("rb") as handle:
            input_file = client.files.create(file=handle, purpose="batch")

        batch = client.batches.create(
            input_file_id=input_file.id,
            endpoint="/v1/embeddings",
            completion_window="24h",
        )
        print(
            f"Batch submitted: {batch.id} "
            f"({len(jobs)} embedding jobs, {len(request_groups)} grouped requests)"
        )

        while batch.status not in TERMINAL_BATCH_STATUSES:
            time.sleep(poll_seconds)
            batch = client.batches.retrieve(batch.id)
            print(f"  batch status: {batch.status}")

        if batch.status != "completed":
            raise RuntimeError(f"Embedding batch did not complete: {batch.status}; errors={batch.errors}")
        if not batch.output_file_id:
            raise RuntimeError("Embedding batch completed without output_file_id")

        output = client.files.content(batch.output_file_id)
        raw = output.read() if hasattr(output, "read") else output.content
        text = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)

        embeddings: dict[str, list[float]] = {}
        for line in text.splitlines():
            if not line.strip():
                continue
            item = json.loads(line)
            custom_id = item["custom_id"]
            response = item.get("response") or {}
            if response.get("status_code") != 200:
                raise RuntimeError(f"Batch embedding failed for {custom_id}: {response}")
            body = response.get("body") or {}
            group_job_ids = request_job_ids.get(custom_id)
            if group_job_ids is None:
                vector = body["data"][0]["embedding"]
                embeddings[custom_id] = vector
                continue

            for vector_item in body.get("data", []):
                index = int(vector_item.get("index", 0))
                try:
                    job_id = group_job_ids[index]
                except IndexError as exc:
                    raise RuntimeError(f"Batch embedding returned invalid index {index} for {custom_id}") from exc
                embeddings[job_id] = vector_item["embedding"]

        return embeddings
    finally:
        jsonl_path.unlink(missing_ok=True)


def retrieve_batch_embeddings(
    client: OpenAI,
    batch_id: str,
    jobs: list[EmbedJob],
    poll_seconds: float,
) -> dict[str, list[float]]:
    request_groups = group_batch_request_jobs(jobs)
    request_job_ids: dict[str, list[str]] = {
        f"group:{group_index:06d}": [job.custom_id for job in group]
        for group_index, group in enumerate(request_groups)
    }
    batch = client.batches.retrieve(batch_id)
    print(f"Resuming batch: {batch.id} ({len(jobs)} embedding jobs, status={batch.status})", flush=True)
    while batch.status not in TERMINAL_BATCH_STATUSES:
        time.sleep(poll_seconds)
        batch = client.batches.retrieve(batch.id)
        print(f"  batch status: {batch.status}", flush=True)

    if batch.status != "completed":
        raise RuntimeError(f"Embedding batch did not complete: {batch.status}; errors={batch.errors}")
    if not batch.output_file_id:
        raise RuntimeError("Embedding batch completed without output_file_id")

    output = client.files.content(batch.output_file_id)
    raw = output.read() if hasattr(output, "read") else output.content
    text = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)

    embeddings: dict[str, list[float]] = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        custom_id = item["custom_id"]
        response = item.get("response") or {}
        if response.get("status_code") != 200:
            raise RuntimeError(f"Batch embedding failed for {custom_id}: {response}")
        body = response.get("body") or {}
        group_job_ids = request_job_ids.get(custom_id)
        if group_job_ids is None:
            vector = body["data"][0]["embedding"]
            embeddings[custom_id] = vector
            continue

        for vector_item in body.get("data", []):
            index = int(vector_item.get("index", 0))
            try:
                job_id = group_job_ids[index]
            except IndexError as exc:
                raise RuntimeError(f"Batch embedding returned invalid index {index} for {custom_id}") from exc
            embeddings[job_id] = vector_item["embedding"]

    missing = sorted({job.custom_id for job in jobs} - set(embeddings))
    if missing:
        raise RuntimeError(f"Batch output missing {len(missing)} embeddings; first={missing[:5]}")
    return embeddings


def parse_args() -> argparse.Namespace:
    load_project_env()
    parser = argparse.ArgumentParser(description="Index markdown files to Supabase v2.")
    parser.add_argument(
        "--md-dir",
        type=Path,
        default=DEFAULT_MD_DIR,
        help=f"Directory containing markdown files (default: {DEFAULT_MD_DIR})",
    )
    parser.add_argument(
        "--mode",
        choices=["batch", "sync"],
        default=os.getenv("INDEXING_MODE", "batch"),
        help="Embedding mode. Use sync for quick local debugging.",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=int(os.getenv("CHUNK_SIZE", "700")),
        help="Markdown chunk size.",
    )
    parser.add_argument(
        "--chunk-overlap",
        type=int,
        default=int(os.getenv("CHUNK_OVERLAP", "80")),
        help="Chunk overlap size.",
    )
    parser.add_argument(
        "--section-content-max-chars",
        type=int,
        default=int(os.getenv("SECTION_CONTENT_MAX_CHARS", "6000")),
        help="Maximum compact section text stored and embedded.",
    )
    parser.add_argument(
        "--min-chunk-chars",
        type=int,
        default=int(os.getenv("MIN_CHUNK_CHARS", "80")),
        help="Skip chunks shorter than this after whitespace compaction.",
    )
    parser.add_argument(
        "--embed-batch-size",
        type=int,
        default=int(os.getenv("EMBED_BATCH_SIZE", "50")),
        help="Embedding API batch size for sync mode.",
    )
    parser.add_argument(
        "--embedding-dimensions",
        type=int,
        default=int(os.getenv("EMBEDDING_DIMENSIONS", "768")),
        help="Embedding dimensions for v2 vectors.",
    )
    parser.add_argument(
        "--sleep-seconds",
        type=float,
        default=0.30,
        help="Sleep between sync embedding batches to reduce rate-limit risk.",
    )
    parser.add_argument(
        "--poll-seconds",
        type=float,
        default=float(os.getenv("BATCH_POLL_SECONDS", "10")),
        help="Polling interval for OpenAI Batch API.",
    )
    parser.add_argument(
        "--max-batch-requests",
        type=int,
        default=int(os.getenv("MAX_BATCH_REQUESTS", str(MAX_BATCH_REQUESTS))),
        help="Maximum JSONL requests per OpenAI Batch job.",
    )
    parser.add_argument(
        "--max-batch-estimated-tokens",
        type=int,
        default=int(os.getenv("MAX_BATCH_ESTIMATED_TOKENS", str(MAX_BATCH_ESTIMATED_TOKENS))),
        help="Conservative estimated token budget per OpenAI Batch job.",
    )
    parser.add_argument(
        "--max-batch-inputs-per-request",
        type=int,
        default=int(os.getenv("MAX_BATCH_INPUTS_PER_REQUEST", str(MAX_BATCH_INPUTS_PER_REQUEST))),
        help="Maximum embedding inputs grouped into one Batch API request.",
    )
    parser.add_argument(
        "--max-batch-request-estimated-tokens",
        type=int,
        default=int(os.getenv("MAX_BATCH_REQUEST_ESTIMATED_TOKENS", str(MAX_BATCH_REQUEST_ESTIMATED_TOKENS))),
        help="Conservative estimated token budget for each grouped Batch API request.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print per-document planning details.",
    )
    parser.add_argument(
        "--collection",
        choices=["", "ce_project", "ncce"],
        default=os.getenv("INDEX_COLLECTION", ""),
        help="Index only one collection. Empty means all collections.",
    )
    parser.add_argument(
        "--source-glob",
        action="append",
        default=[],
        help="Index only markdown filenames matching this glob. Can be provided multiple times.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Plan indexing and embedding jobs without writing Supabase or calling OpenAI.",
    )
    parser.add_argument(
        "--max-embedding-jobs",
        type=int,
        default=int(os.getenv("MAX_EMBEDDING_JOBS", "0")),
        help="Abort before embedding if planned jobs exceed this value. 0 disables the guard.",
    )
    parser.add_argument(
        "--resume-batch-id",
        default="",
        help="Resume an already submitted OpenAI Batch job for one planned split part.",
    )
    parser.add_argument(
        "--resume-batch-part",
        type=int,
        default=1,
        help="1-based split part number for --resume-batch-id.",
    )
    parser.add_argument(
        "--resume-batch-map",
        action="append",
        default=[],
        metavar="PART=BATCH_ID",
        help=(
            "Resume multiple submitted OpenAI Batch parts. Repeat this option for "
            "each completed part; for example --resume-batch-map 1=batch_... "
            "--resume-batch-map 2=batch_...."
        ),
    )
    return parser.parse_args()


def run(args: argparse.Namespace) -> None:
    load_project_env()
    global MAX_BATCH_REQUESTS
    global MAX_BATCH_ESTIMATED_TOKENS
    global MAX_BATCH_INPUTS_PER_REQUEST
    global MAX_BATCH_REQUEST_ESTIMATED_TOKENS

    MAX_BATCH_REQUESTS = args.max_batch_requests
    MAX_BATCH_ESTIMATED_TOKENS = args.max_batch_estimated_tokens
    MAX_BATCH_INPUTS_PER_REQUEST = args.max_batch_inputs_per_request
    MAX_BATCH_REQUEST_ESTIMATED_TOKENS = args.max_batch_request_estimated_tokens

    openai_api_key = os.getenv("OPENAI_API_KEY")
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_service_key = os.getenv("SUPABASE_SERVICE_KEY")
    embed_model = os.getenv("EMBED_MODEL", "text-embedding-3-small")

    if not openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    if not supabase_url or not supabase_service_key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_KEY is not set.")
    if args.embedding_dimensions != 768:
        raise RuntimeError("v2 schema expects EMBEDDING_DIMENSIONS=768.")
    if not args.md_dir.exists():
        raise FileNotFoundError(f"Markdown directory not found: {args.md_dir}")

    supabase = create_client(supabase_url, supabase_service_key)
    openai_client = None if args.dry_run else OpenAI(api_key=openai_api_key)
    splitter = MarkdownTextSplitter(
        chunk_size=args.chunk_size,
        chunk_overlap=args.chunk_overlap,
    )
    title_overrides = load_title_overrides()

    files = sorted(args.md_dir.glob("*.md"))
    if args.source_glob:
        files = [
            path
            for path in files
            if any(fnmatch.fnmatch(path.name, pattern) for pattern in args.source_glob)
        ]
    if not files:
        raise RuntimeError(f"No markdown files found in {args.md_dir}")

    print(f"Markdown directory    : {args.md_dir}")
    print(f"Embedding model       : {embed_model}")
    print(f"Embedding dimensions  : {args.embedding_dimensions}")
    print(f"Indexing mode         : {args.mode}")
    print(f"Collection filter     : {args.collection or 'all'}")
    print(f"Source glob filter    : {', '.join(args.source_glob) if args.source_glob else 'none'}")
    print(f"Dry run               : {args.dry_run}")
    print(f"Files to index        : {len(files)}")
    print("Prefetching existing v2 index status ...", flush=True)
    existing_sections_by_doc = fetch_existing_rows_by_document(supabase, "civil_sections_v2")
    existing_chunks_by_doc = fetch_existing_rows_by_document(supabase, "civil_chunks_v2")
    print(
        f"Existing status rows  : sections={sum(len(rows) for rows in existing_sections_by_doc.values())}, "
        f"chunks={sum(len(rows) for rows in existing_chunks_by_doc.values())}",
        flush=True,
    )

    doc_rows: list[dict[str, Any]] = []
    catalog_rows: list[dict[str, Any]] = []
    section_rows_by_id: dict[str, dict[str, Any]] = {}
    chunk_rows_by_id: dict[str, dict[str, Any]] = {}
    jobs: list[EmbedJob] = []
    reused_sections: list[str] = []
    reused_chunks: list[str] = []
    stale_sections: list[str] = []
    stale_chunks: list[str] = []

    for md_file in files:
        raw_markdown = md_file.read_text(encoding="utf-8")
        metadata, markdown = strip_frontmatter(raw_markdown)
        markdown = compact_text(clean_markdown_for_index(markdown))
        if not markdown:
            print(f"  skip (empty): {md_file.name}")
            continue

        document_id = md_file.stem
        source = md_file.name
        source_pdf = metadata.get("source_pdf") or f"{md_file.stem}.pdf"
        collection = metadata_text(metadata, "collection", "ce_project")
        if collection not in VALID_COLLECTIONS:
            collection = "ce_project"
        if args.collection and collection != args.collection:
            continue
        source_type = metadata_text(metadata, "source_type", "paper") or "paper"
        parent_source_pdf = metadata_text(metadata, "parent_source_pdf") or source_pdf
        paper_code = metadata_text(metadata, "paper_code") or None
        page_start = metadata_int(metadata, "page_start")
        page_end = metadata_int(metadata, "page_end")
        if page_start is None or page_end is None:
            inferred_page_start, inferred_page_end = infer_page_range_from_markdown(markdown)
            page_start = page_start or inferred_page_start
            page_end = page_end or inferred_page_end
        proceeding_no = metadata_int(metadata, "proceeding_no")
        proceeding_year = metadata_int(metadata, "proceeding_year")
        discipline = metadata_text(metadata, "discipline") or get_discipline(md_file.stem)
        if discipline == "unknown":
            discipline = get_discipline(md_file.stem)
        doc_hash = sha256_text(f"{OCR_CLEANUP_VERSION}\n{markdown}")
        document_title = effective_title(
            md_file.name,
            markdown,
            paper_code,
            document_id,
            title_overrides,
        )
        sections = split_sections(markdown)

        existing_sections = existing_sections_by_doc.get(document_id, {})
        existing_chunks = existing_chunks_by_doc.get(document_id, {})
        new_section_ids: set[str] = set()
        new_chunk_ids: set[str] = set()

        chunk_count = 0
        for section in sections:
            section_id = f"{document_id}_s{section.index:04d}"
            section_content = compact_text(f"## {section.title}\n\n{section.content}")[
                : args.section_content_max_chars
            ]
            section_hash = sha256_text(f"{OCR_CLEANUP_VERSION}\n{section_content}")
            section_page_start, section_page_end = page_range_for_section(section, page_start, page_end)
            section_row = {
                "id": section_id,
                "document_id": document_id,
                "source": source,
                "collection": collection,
                "source_type": source_type,
                "parent_source_pdf": parent_source_pdf,
                "paper_code": paper_code,
                "page_start": section_page_start,
                "page_end": section_page_end,
                "proceeding_no": proceeding_no,
                "proceeding_year": proceeding_year,
                "discipline": discipline,
                "section_index": section.index,
                "section_title": section.title,
                "content": section_content,
                "content_hash": section_hash,
                "embedding_model": embed_model,
                "embedding_dimensions": args.embedding_dimensions,
                "is_stale": False,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            new_section_ids.add(section_id)

            existing_section = existing_sections.get(section_id)
            section_rows_by_id[section_id] = section_row
            if (
                existing_section
                and existing_section.get("content_hash") == section_hash
                and existing_section.get("has_embedding") is True
            ):
                reused_sections.append(section_id)
            else:
                jobs.append(EmbedJob(table="sections", row_id=section_id, text=section_content))

            docs = splitter.create_documents([section.content])
            chunks = [compact_text(doc.page_content) for doc in docs]
            chunks = [chunk for chunk in chunks if len(chunk) >= args.min_chunk_chars]
            if not chunks and section.content:
                chunks = [section.content[: args.chunk_size]]

            for chunk_index, chunk in enumerate(chunks):
                chunk_id = f"{section_id}_c{chunk_index:04d}"
                chunk_hash = sha256_text(f"{OCR_CLEANUP_VERSION}\n{chunk}")
                chunk_row = {
                    "id": chunk_id,
                    "document_id": document_id,
                    "section_id": section_id,
                    "source": source,
                    "collection": collection,
                    "source_type": source_type,
                    "parent_source_pdf": parent_source_pdf,
                    "paper_code": paper_code,
                    "page_start": section_page_start,
                    "page_end": section_page_end,
                    "proceeding_no": proceeding_no,
                    "proceeding_year": proceeding_year,
                    "discipline": discipline,
                    "section_index": section.index,
                    "section_title": section.title,
                    "chunk_index": chunk_index,
                    "content": chunk,
                    "content_hash": chunk_hash,
                    "embedding_model": embed_model,
                    "embedding_dimensions": args.embedding_dimensions,
                    "is_stale": False,
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
                new_chunk_ids.add(chunk_id)

                existing_chunk = existing_chunks.get(chunk_id)
                chunk_rows_by_id[chunk_id] = chunk_row
                if (
                    existing_chunk
                    and existing_chunk.get("content_hash") == chunk_hash
                    and existing_chunk.get("has_embedding") is True
                ):
                    reused_chunks.append(chunk_id)
                else:
                    jobs.append(EmbedJob(table="chunks", row_id=chunk_id, text=chunk))
                chunk_count += 1

        stale_sections.extend(sorted(set(existing_sections) - new_section_ids))
        stale_chunks.extend(sorted(set(existing_chunks) - new_chunk_ids))

        doc_rows.append(
            {
                "id": document_id,
                "source": source,
                "source_pdf": source_pdf,
                "collection": collection,
                "source_type": source_type,
                "parent_source_pdf": parent_source_pdf,
                "paper_code": paper_code,
                "page_start": page_start,
                "page_end": page_end,
                "proceeding_no": proceeding_no,
                "proceeding_year": proceeding_year,
                "discipline": discipline,
                "doc_hash": doc_hash,
                "embedding_model": embed_model,
                "embedding_dimensions": args.embedding_dimensions,
                "section_count": len(sections),
                "chunk_count": chunk_count,
                "indexed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )
        source_provider = metadata_text(metadata, "source_provider")
        if not source_provider:
            source_provider = "student_transport_projects" if collection == "ce_project" else "ncce"
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        catalog_rows.append(
            {
                "id": f"{source_provider}:{document_id}",
                "provider": source_provider,
                "provider_record_id": document_id,
                "collection": collection,
                "source_type": source_type,
                "title_local": document_title,
                "discipline": discipline,
                "rights_status": metadata_text(
                    metadata,
                    "rights_status",
                    "public_source_no_redistribution",
                ),
                "access_level": metadata_text(metadata, "access_level", "full_text_local"),
                "evidence_status": "indexed",
                "document_id": document_id,
                "record_hash": doc_hash,
                "raw_metadata": {
                    "source": source,
                    "source_pdf": source_pdf,
                    "parent_source_pdf": parent_source_pdf,
                    "paper_code": paper_code,
                    "page_start": page_start,
                    "page_end": page_end,
                    "proceeding_no": proceeding_no,
                    "proceeding_year": proceeding_year,
                    "section_count": len(sections),
                    "chunk_count": chunk_count,
                },
                "source_updated_at": now_iso,
                "last_seen_at": now_iso,
                "updated_at": now_iso,
            }
        )
        if args.verbose:
            print(
                f"  planned: {source} -> {len(sections)} sections, "
                f"{chunk_count} chunks [{discipline}]"
            )

    print(f"\nDocuments planned: {len(doc_rows)}")
    print(f"Catalog rows planned: {len(catalog_rows)}")
    print(f"Sections planned : {len(section_rows_by_id)}")
    print(f"Chunks planned   : {len(chunk_rows_by_id)}")
    print(f"Embedding jobs needed: {len(jobs)}")
    print(f"- section jobs: {sum(1 for job in jobs if job.table == 'sections')}")
    print(f"- chunk jobs:   {sum(1 for job in jobs if job.table == 'chunks')}")

    if args.max_embedding_jobs and len(jobs) > args.max_embedding_jobs:
        raise RuntimeError(
            f"Planned embedding jobs ({len(jobs)}) exceed --max-embedding-jobs={args.max_embedding_jobs}. "
            "Narrow --collection/--source-glob or raise the guard intentionally."
        )

    if args.dry_run:
        print("\nDry run complete; no Supabase writes and no embedding calls were executed.")
        print(f"- documents planned: {len(doc_rows)}")
        print(f"- sections planned:  {len(section_rows_by_id)}")
        print(f"- chunks planned:    {len(chunk_rows_by_id)}")
        print(f"- sections reused:   {len(reused_sections)}")
        print(f"- chunks reused:     {len(reused_chunks)}")
        print(f"- stale sections:    {len(stale_sections)}")
        print(f"- stale chunks:      {len(stale_chunks)}")
        return

    if openai_client is None:
        raise RuntimeError("OpenAI client is not initialized outside dry-run mode.")

    resume_batches: dict[int, str] = {}
    for resume_spec in args.resume_batch_map:
        part_value, separator, batch_id = resume_spec.partition("=")
        if not separator or not part_value.isdigit() or not batch_id.strip():
            raise RuntimeError(
                f"Invalid --resume-batch-map value {resume_spec!r}; expected PART=BATCH_ID."
            )
        part_number = int(part_value)
        if part_number in resume_batches:
            raise RuntimeError(f"Duplicate resumed Batch part: {part_number}.")
        resume_batches[part_number] = batch_id.strip()
    if args.resume_batch_id:
        if args.resume_batch_part in resume_batches:
            raise RuntimeError(f"Duplicate resumed Batch part: {args.resume_batch_part}.")
        resume_batches[args.resume_batch_part] = args.resume_batch_id

    if resume_batches:
        split_parts = split_batch_jobs(jobs)
        embeddings: dict[str, list[float]] = {}
        resumed_ids: set[str] = set()
        for part_number, batch_id in sorted(resume_batches.items()):
            part_index = part_number - 1
            if part_index < 0 or part_index >= len(split_parts):
                raise RuntimeError(
                    f"Resumed Batch part must be between 1 and {len(split_parts)} for this plan."
                )
            resumed_jobs = split_parts[part_index]
            resumed_ids.update(job.custom_id for job in resumed_jobs)
            embeddings.update(
                retrieve_batch_embeddings(
                    openai_client,
                    batch_id,
                    resumed_jobs,
                    args.poll_seconds,
                )
            )
        remaining_jobs = [job for job in jobs if job.custom_id not in resumed_ids]
        print(
            f"Resumed embeddings: {len(embeddings)} from {len(resume_batches)} parts; "
            f"remaining jobs: {len(remaining_jobs)}",
            flush=True,
        )
        if remaining_jobs:
            if args.mode == "batch":
                embeddings.update(
                    embed_jobs_batch(
                        openai_client,
                        remaining_jobs,
                        embed_model,
                        args.embedding_dimensions,
                        args.poll_seconds,
                    )
                )
            else:
                embeddings.update(
                    embed_jobs_sync(
                        openai_client,
                        remaining_jobs,
                        embed_model,
                        args.embedding_dimensions,
                        args.embed_batch_size,
                        args.sleep_seconds,
                    )
                )
    else:
        embeddings = (
            embed_jobs_batch(openai_client, jobs, embed_model, args.embedding_dimensions, args.poll_seconds)
            if args.mode == "batch"
            else embed_jobs_sync(
                openai_client,
                jobs,
                embed_model,
                args.embedding_dimensions,
                args.embed_batch_size,
                args.sleep_seconds,
            )
        )

    for job in jobs:
        vector = embeddings.get(job.custom_id)
        if vector is None:
            raise RuntimeError(f"Missing embedding result for {job.custom_id}")
        if job.table == "sections":
            section_rows_by_id[job.row_id]["embedding"] = vector
        elif job.table == "chunks":
            chunk_rows_by_id[job.row_id]["embedding"] = vector
        else:
            raise RuntimeError(f"Unknown embedding job table: {job.table}")

    # Reused rows already have the canonical content hash and embedding. Do not
    # upsert a payload without `embedding`: PostgREST would replace the stored
    # vector with null. Changed/new rows carry a fresh embedding below.
    reused_section_ids = set(reused_sections)
    reused_chunk_ids = set(reused_chunks)
    section_rows = [
        row for row_id, row in section_rows_by_id.items() if row_id not in reused_section_ids
    ]
    chunk_rows = [
        row for row_id, row in chunk_rows_by_id.items() if row_id not in reused_chunk_ids
    ]

    upsert_rows(supabase, "civil_documents_v2", doc_rows)
    upsert_rows(supabase, "civil_sections_v2", section_rows)
    upsert_rows(supabase, "civil_chunks_v2", chunk_rows)
    upsert_rows(supabase, "civil_source_catalog", catalog_rows)

    update_ids(supabase, "civil_sections_v2", reused_sections, {"is_stale": False})
    update_ids(supabase, "civil_chunks_v2", reused_chunks, {"is_stale": False})
    update_ids(supabase, "civil_sections_v2", stale_sections, {"is_stale": True})
    update_ids(supabase, "civil_chunks_v2", stale_chunks, {"is_stale": True})

    doc_count = supabase.table("civil_documents_v2").select("id", count="exact").execute()
    section_count = supabase.table("civil_sections_v2").select("id", count="exact").eq("is_stale", False).execute()
    chunk_count = supabase.table("civil_chunks_v2").select("id", count="exact").eq("is_stale", False).execute()

    print("\nIndexing complete")
    print(f"- documents planned: {len(doc_rows)}")
    print(f"- sections upserted: {len(section_rows)}")
    print(f"- chunks upserted:   {len(chunk_rows)}")
    print(f"- sections reused:   {len(reused_sections)}")
    print(f"- chunks reused:     {len(reused_chunks)}")
    print(f"- stale sections:    {len(stale_sections)}")
    print(f"- stale chunks:      {len(stale_chunks)}")
    print(f"- total documents:   {doc_count.count}")
    print(f"- active sections:   {section_count.count}")
    print(f"- active chunks:     {chunk_count.count}")


if __name__ == "__main__":
    run(parse_args())
