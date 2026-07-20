"""
Civil Engineering MCP server (production-oriented).

Highlights:
- MCP transport via FastMCP ASGI app
- /tools/call compatibility endpoint with auth, rate limit, timeout, metrics
- Structured tool response shape: structuredContent + content + _meta
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import inspect
import json
import logging
import os
import re
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from mcp.server.fastmcp import FastMCP
from openai import APIError, APITimeoutError, OpenAI, RateLimitError
from pydantic import BaseModel, Field
from supabase import create_client

SERVER_DIR = Path(__file__).resolve().parent
ROOT_DIR = SERVER_DIR.parent

# Central env first, then module-local overrides.
load_dotenv(ROOT_DIR / ".env")
load_dotenv(SERVER_DIR / ".env")
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")
EMBEDDING_DIMENSIONS = int(os.getenv("EMBEDDING_DIMENSIONS", "768"))
RETRIEVAL_VERSION = os.getenv("RETRIEVAL_VERSION", "v2").lower()
SECTION_TOP_K = int(os.getenv("SECTION_TOP_K", "20"))
CHUNK_TOP_K = int(os.getenv("CHUNK_TOP_K", "8"))
CONTEXT_MAX_CHUNKS = int(os.getenv("CONTEXT_MAX_CHUNKS", "8"))

OPENAI_TIMEOUT_SECONDS = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "20"))
TOOL_TIMEOUT_SECONDS = float(os.getenv("TOOL_TIMEOUT_SECONDS", "20"))

RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
RATE_LIMIT_MAX_CALLS = int(os.getenv("RATE_LIMIT_MAX_CALLS", "240"))
MCP_DISTRIBUTED_RATE_LIMIT = os.getenv("MCP_DISTRIBUTED_RATE_LIMIT", "true").lower() == "true"

REQUIRE_TOOL_AUTH = os.getenv("REQUIRE_TOOL_AUTH", "true").lower() == "true"
MCP_SERVER_API_KEY = os.getenv("MCP_SERVER_API_KEY", "")
MCP_CLIENT_KEYS_JSON = os.getenv("MCP_CLIENT_KEYS_JSON", "").strip()
PLACEHOLDER_MCP_KEYS = {
    "replace-with-random-secret",
    "change-me",
    "changeme",
    "your-secret",
    "sk-...",
    "eyj...",
}

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=getattr(logging, LOG_LEVEL, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
logger = logging.getLogger("civil_mcp_server")


def is_placeholder_secret(value: str | None) -> bool:
    normalized = (value or "").strip().lower()
    return not normalized or normalized in PLACEHOLDER_MCP_KEYS or normalized.startswith("replace-")


def log_event(level: int, event: str, **fields: Any) -> None:
    payload = {"event": event, **{key: value for key, value in fields.items() if value is not None}}
    logger.log(level, json.dumps(payload, ensure_ascii=True, separators=(",", ":")))


def load_mcp_client_keys(raw: str) -> dict[str, str]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("MCP_CLIENT_KEYS_JSON must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("MCP_CLIENT_KEYS_JSON must be a JSON object")
    result: dict[str, str] = {}
    for raw_name, raw_value in parsed.items():
        if not isinstance(raw_name, str) or not isinstance(raw_value, str):
            raise RuntimeError("MCP_CLIENT_KEYS_JSON contains an invalid client entry")
        name = raw_name.strip()
        value = raw_value.strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,79}", name) or not value:
            raise RuntimeError("MCP_CLIENT_KEYS_JSON contains an invalid client entry")
        if is_placeholder_secret(value):
            raise RuntimeError(f"MCP client key for {name} is a placeholder")
        if value.startswith("sha256:") and not re.fullmatch(r"sha256:[0-9a-f]{64}", value):
            raise RuntimeError(f"MCP client key hash for {name} is invalid")
        if not value.startswith("sha256:") and len(value) < 32:
            raise RuntimeError(f"MCP client key for {name} must contain at least 32 characters")
        result[name] = value
    return result

if is_placeholder_secret(OPENAI_API_KEY):
    raise RuntimeError("OPENAI_API_KEY is missing or placeholder")
if not SUPABASE_URL or is_placeholder_secret(SUPABASE_SERVICE_KEY):
    raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_KEY is missing or placeholder")
if RETRIEVAL_VERSION not in {"v1", "v2"}:
    raise RuntimeError("RETRIEVAL_VERSION must be 'v1' or 'v2'")
if RETRIEVAL_VERSION == "v2" and EMBEDDING_DIMENSIONS != 768:
    raise RuntimeError("RETRIEVAL_VERSION=v2 requires EMBEDDING_DIMENSIONS=768")
MCP_CLIENT_KEYS = load_mcp_client_keys(MCP_CLIENT_KEYS_JSON)

if REQUIRE_TOOL_AUTH:
    key = MCP_SERVER_API_KEY.strip()
    legacy_key_valid = not is_placeholder_secret(key) and len(key) >= 32
    if not legacy_key_valid and not MCP_CLIENT_KEYS:
        raise RuntimeError(
            "MCP_CLIENT_KEYS_JSON or a non-placeholder MCP_SERVER_API_KEY is required when REQUIRE_TOOL_AUTH=true"
        )

oa = OpenAI(api_key=OPENAI_API_KEY, timeout=OPENAI_TIMEOUT_SECONDS)
sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
mcp = FastMCP("civil-engineering-mcp")

VALID_DISCIPLINES = {
    "",
    "transport",
    "structural",
    "geotechnical",
    "construction_mgmt",
    "water_resources",
    "surveying_gis",
    "environmental",
    "infrastructure",
    "civil_education",
    "ai_engineering",
}

VALID_COLLECTIONS = {
    "",
    "ce_project",
    "ncce",
}

READ_ONLY_ANNOTATIONS = {
    "readOnlyHint": True,
    "openWorldHint": False,
    "destructiveHint": False,
}

TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "search_civil_knowledge": {
        "description": "Semantic search over civil engineering papers in Supabase.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "search_civil_sections": {
        "description": "Search section-level summaries in the CivilMCP v2 index.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "search_civil_chunks": {
        "description": "Search chunk-level evidence in the CivilMCP v2 index.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "fetch_civil_paper": {
        "description": "Fetch v2 metadata, outline, and optional chunks for an indexed paper.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "fetch_chunk_neighbors": {
        "description": "Fetch neighboring chunks around a v2 chunk for citation-grounded context.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "fetch_paper_outline": {
        "description": "Fetch the v2 section outline for an indexed paper source.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "list_papers": {
        "description": "List indexed paper sources by discipline.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "list_collections": {
        "description": "List indexed CivilMCP collections and document counts.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
}


class ToolCallError(Exception):
    def __init__(self, message: str, status_code: int, error_code: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code


class InputValidationError(ToolCallError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=422, error_code="invalid_input")


class UnauthorizedToolCall(ToolCallError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=401, error_code="unauthorized")


class RateLimitedToolCall(ToolCallError):
    def __init__(self, message: str, retry_after_seconds: float | None = None) -> None:
        super().__init__(message, status_code=429, error_code="rate_limited")
        self.retry_after_seconds = retry_after_seconds


class UpstreamTimeoutToolCall(ToolCallError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=504, error_code="upstream_timeout")


class UpstreamToolCallError(ToolCallError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=502, error_code="upstream_error")


class SlidingWindowRateLimiter:
    def __init__(self, max_calls: int, window_seconds: int) -> None:
        self.max_calls = max_calls
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str) -> tuple[bool, float]:
        now = time.time()
        with self._lock:
            events = self._events[key]
            while events and (now - events[0]) > self.window_seconds:
                events.popleft()

            if len(events) >= self.max_calls:
                retry_after = self.window_seconds - (now - events[0])
                return False, max(retry_after, 0.0)

            events.append(now)
            return True, 0.0


class MetricsStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self.started_at_unix = int(time.time())
        self.requests_total = 0
        self.transport_requests_total = 0
        self.transport_auth_failures_total = 0
        self.transport_rate_limited_total = 0
        self.tool_calls_total = 0
        self.tool_errors_total = 0
        self.tool_timeouts_total = 0
        self.tools: dict[str, dict[str, float]] = defaultdict(
            lambda: {"calls": 0, "errors": 0, "latency_ms_sum": 0.0}
        )

    def record_request(self) -> None:
        with self._lock:
            self.requests_total += 1

    def record_transport(self, ok: bool, error_code: str | None = None) -> None:
        with self._lock:
            self.transport_requests_total += 1
            if not ok and error_code == "unauthorized":
                self.transport_auth_failures_total += 1
            if not ok and error_code == "rate_limited":
                self.transport_rate_limited_total += 1

    def record_tool(self, name: str, latency_ms: float, ok: bool, error_code: str | None = None) -> None:
        with self._lock:
            self.tool_calls_total += 1
            tool_stat = self.tools[name]
            tool_stat["calls"] += 1
            tool_stat["latency_ms_sum"] += latency_ms
            if not ok:
                self.tool_errors_total += 1
                tool_stat["errors"] += 1
                if error_code == "upstream_timeout":
                    self.tool_timeouts_total += 1

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            per_tool: dict[str, dict[str, float]] = {}
            for name, stat in self.tools.items():
                calls = int(stat["calls"])
                errors = int(stat["errors"])
                avg_latency = (stat["latency_ms_sum"] / calls) if calls else 0.0
                per_tool[name] = {
                    "calls": calls,
                    "errors": errors,
                    "error_rate": round((errors / calls) if calls else 0.0, 4),
                    "avg_latency_ms": round(avg_latency, 2),
                }

            total_error_rate = (
                self.tool_errors_total / self.tool_calls_total if self.tool_calls_total else 0.0
            )
            return {
                "started_at_unix": self.started_at_unix,
                "requests_total": self.requests_total,
                "transport_requests_total": self.transport_requests_total,
                "transport_auth_failures_total": self.transport_auth_failures_total,
                "transport_rate_limited_total": self.transport_rate_limited_total,
                "tool_calls_total": self.tool_calls_total,
                "tool_errors_total": self.tool_errors_total,
                "tool_timeouts_total": self.tool_timeouts_total,
                "tool_error_rate": round(total_error_rate, 4),
                "tools": per_tool,
            }


RATE_LIMITER = SlidingWindowRateLimiter(
    max_calls=RATE_LIMIT_MAX_CALLS,
    window_seconds=RATE_LIMIT_WINDOW_SECONDS,
)
METRICS = MetricsStore()


@dataclass
class ToolExecutionResult:
    tool: str
    structured_content: dict[str, Any]
    content_text: str
    meta: dict[str, Any] = field(default_factory=dict)

    def to_payload(self, request_id: str, latency_ms: float) -> dict[str, Any]:
        merged_meta = dict(self.meta)
        merged_meta.update(
            {
                "request_id": request_id,
                "tool": self.tool,
                "latency_ms": round(latency_ms, 2),
            }
        )
        return {
            "structuredContent": self.structured_content,
            "content": [{"type": "text", "text": self.content_text}],
            "_meta": merged_meta,
        }


def get_request_id(request: Request) -> str:
    req_id = getattr(request.state, "request_id", "")
    return req_id if isinstance(req_id, str) and req_id else str(uuid.uuid4())


def normalize_discipline(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if cleaned not in VALID_DISCIPLINES:
        raise InputValidationError(
            "discipline must be one of: "
            "'transport', 'structural', 'geotechnical', 'construction_mgmt', "
            "'water_resources', 'surveying_gis', 'environmental', 'infrastructure', "
            "'civil_education', 'ai_engineering', ''."
        )
    return cleaned or None


def normalize_collection(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if cleaned not in VALID_COLLECTIONS:
        raise InputValidationError("collection must be one of: 'ce_project', 'ncce', ''.")
    return cleaned or None


def normalize_string_list(value: Any) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, str):
        items = [item.strip() for item in value.split(",")]
    elif isinstance(value, list):
        items = [str(item).strip() for item in value]
    else:
        raise InputValidationError("Expected a list of strings or a comma-separated string.")
    cleaned = [item for item in items if item]
    return cleaned or None


def normalize_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def chunk_result_from_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "document_id": row.get("document_id"),
        "section_id": row.get("section_id"),
        "source": row.get("source", "unknown-source"),
        "collection": row.get("collection", "ce_project"),
        "source_type": row.get("source_type", "paper"),
        "parent_source_pdf": row.get("parent_source_pdf"),
        "paper_code": row.get("paper_code"),
        "page_start": row.get("page_start"),
        "page_end": row.get("page_end"),
        "proceeding_no": row.get("proceeding_no"),
        "proceeding_year": row.get("proceeding_year"),
        "discipline": row.get("discipline", "unknown"),
        "section_index": row.get("section_index"),
        "section_title": row.get("section_title", "Untitled section"),
        "chunk_index": row.get("chunk_index"),
        "similarity": round(float(row.get("similarity", 0.0)), 3)
        if row.get("similarity") is not None
        else None,
        "content": row.get("content", ""),
    }


def citation_for_result(result: dict[str, Any]) -> str:
    page_start = result.get("page_start")
    page_end = result.get("page_end")
    page_part = ""
    if page_start is not None and page_end is not None:
        page_part = f" · p.{page_start}" if page_start == page_end else f" · p.{page_start}-{page_end}"
    return (
        f"{result.get('source', 'unknown-source')} · "
        f"{result.get('section_title', 'Untitled section')} · "
        f"chunk {result.get('chunk_index')}{page_part}"
    )


def authenticate_mcp_request(request: Request, surface: str = "mcp") -> str:
    if not REQUIRE_TOOL_AUTH:
        return "anonymous"

    auth = request.headers.get("authorization", "")
    bearer = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    x_api_key = request.headers.get("x-mcp-api-key", "").strip()
    provided = x_api_key or bearer

    if provided:
        provided_hash = hashlib.sha256(provided.encode("utf-8")).hexdigest()
        for caller, configured in MCP_CLIENT_KEYS.items():
            if configured.startswith("sha256:"):
                matches = hmac.compare_digest(provided_hash, configured.removeprefix("sha256:"))
            else:
                matches = hmac.compare_digest(provided, configured)
            if matches:
                return caller
        legacy = MCP_SERVER_API_KEY.strip()
        if legacy and legacy.lower() not in PLACEHOLDER_MCP_KEYS and hmac.compare_digest(provided, legacy):
            return "legacy"
    raise UnauthorizedToolCall(f"Missing or invalid API key for {surface}")


def authenticate_tools_call(request: Request) -> str:
    return authenticate_mcp_request(request, "/tools/call")


def client_host_for_request(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


PUBLIC_ENDPOINTS: set[tuple[str, str]] = {
    ("GET", "/"),
    ("GET", "/health"),
    ("GET", "/health/ready"),
    ("GET", "/tools/list"),
}


def consume_distributed_mcp_quota(caller: str, surface: str) -> tuple[bool, int]:
    if not MCP_DISTRIBUTED_RATE_LIMIT:
        return True, 0
    identity_hash = hashlib.sha256(f"mcp:{caller}".encode("utf-8")).hexdigest()
    response = sb.rpc(
        "consume_civil_quota",
        {
            "p_identity_hash": identity_hash,
            "p_scope": f"mcp_{surface}",
            "p_limit": RATE_LIMIT_MAX_CALLS,
            "p_window_seconds": RATE_LIMIT_WINDOW_SECONDS,
        },
    ).execute()
    data = response.data
    row = data[0] if isinstance(data, list) and data else data
    if not isinstance(row, dict) or not isinstance(row.get("allowed"), bool):
        raise RuntimeError("Distributed MCP quota returned an invalid response")
    reset_at = row.get("reset_at")
    retry_after = RATE_LIMIT_WINDOW_SECONDS
    if isinstance(reset_at, str):
        try:
            from datetime import datetime, timezone

            reset = datetime.fromisoformat(reset_at.replace("Z", "+00:00"))
            retry_after = max(1, int((reset - datetime.now(timezone.utc)).total_seconds()) + 1)
        except ValueError:
            pass
    return bool(row["allowed"]), retry_after


async def enforce_mcp_rate_limit(caller: str, surface: str, client_host: str) -> None:
    try:
        allowed, retry_after = await asyncio.to_thread(consume_distributed_mcp_quota, caller, surface)
    except Exception as exc:  # noqa: BLE001
        log_event(logging.ERROR, "mcp_distributed_quota_failed", caller=caller, surface=surface, error=type(exc).__name__)
        raise UpstreamToolCallError("MCP quota service is temporarily unavailable") from exc
    if not allowed:
        raise RateLimitedToolCall("Too many MCP requests. Please retry later.", retry_after_seconds=retry_after)

    local_key = f"{surface}:{caller}:{client_host}"
    local_allowed, local_retry_after = RATE_LIMITER.check(local_key)
    if not local_allowed:
        raise RateLimitedToolCall("Too many MCP requests. Please retry later.", retry_after_seconds=local_retry_after)


def is_mounted_transport_request(request: Request) -> bool:
    method = request.method.upper()
    path = request.url.path.rstrip("/") or "/"
    if (method, path) in PUBLIC_ENDPOINTS:
        return False
    if path == "/tools/call":
        return False
    return True


def tool_error_response(exc: ToolCallError, request_id: str) -> JSONResponse:
    detail: dict[str, Any] = {
        "code": exc.error_code,
        "message": str(exc),
        "request_id": request_id,
    }
    headers: dict[str, str] = {}
    if isinstance(exc, RateLimitedToolCall) and exc.retry_after_seconds is not None:
        detail["retry_after_seconds"] = round(exc.retry_after_seconds, 2)
        headers["Retry-After"] = str(max(1, int(exc.retry_after_seconds)))
    return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=headers)


def embed(text: str, dimensions: int | None = None) -> list[float]:
    try:
        kwargs: dict[str, Any] = {"model": EMBED_MODEL, "input": [text]}
        if dimensions is not None:
            kwargs["dimensions"] = dimensions
        return oa.embeddings.create(**kwargs).data[0].embedding
    except RateLimitError as exc:
        raise RateLimitedToolCall("OpenAI embedding rate limit exceeded") from exc
    except APITimeoutError as exc:
        raise UpstreamTimeoutToolCall("OpenAI embedding request timed out") from exc
    except APIError as exc:
        raise UpstreamToolCallError(f"OpenAI embedding API error: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Unexpected OpenAI embedding failure: {exc}") from exc


def _search_civil_knowledge_impl(
    query: str,
    discipline: str = "",
    max_results: int = 5,
    collection: str = "",
) -> ToolExecutionResult:
    if RETRIEVAL_VERSION == "v1":
        return _search_civil_knowledge_v1_impl(query=query, discipline=discipline, max_results=max_results)
    return _search_civil_knowledge_v2_impl(
        query=query,
        discipline=discipline,
        max_results=max_results,
        collection=collection,
    )


def _search_civil_knowledge_v1_impl(
    query: str,
    discipline: str = "",
    max_results: int = 5,
) -> ToolExecutionResult:
    cleaned_query = query.strip()
    if not cleaned_query:
        raise InputValidationError("query must not be empty")

    disc = normalize_discipline(discipline)
    safe_max_results = max(1, min(int(max_results), 10))

    try:
        rpc_result = sb.rpc(
            "match_civil_chunks",
            {
                "query_embedding": embed(cleaned_query),
                "match_count": safe_max_results,
                "filter_disc": disc,
            },
        ).execute()
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase RPC failed: {exc}") from exc

    rows = rpc_result.data or []
    results = [
        {
            "id": row.get("id"),
            "source": row.get("source", "unknown-source"),
            "discipline": row.get("discipline", "unknown"),
            "similarity": round(float(row.get("similarity", 0.0)), 3),
            "content": row.get("content", ""),
        }
        for row in rows
    ]

    if not results:
        return ToolExecutionResult(
            tool="search_civil_knowledge",
            structured_content={
                "query": cleaned_query,
                "discipline": disc or "",
                "retrieval_version": "v1",
                "result_count": 0,
                "results": [],
            },
            content_text="No relevant content found in the knowledge base.",
            meta={"result_count": 0},
        )

    text_blocks = [
        f"[{result['similarity']}] {result['source']} · {result['discipline']}\n{result['content']}"
        for result in results
    ]
    return ToolExecutionResult(
        tool="search_civil_knowledge",
        structured_content={
            "query": cleaned_query,
            "discipline": disc or "",
            "retrieval_version": "v1",
            "result_count": len(results),
            "results": results,
        },
        content_text="\n\n---\n\n".join(text_blocks),
        meta={"result_count": len(results)},
    )


def _search_civil_sections_impl(
    query: str,
    discipline: str = "",
    max_results: int = 10,
    collection: str = "",
) -> ToolExecutionResult:
    cleaned_query = query.strip()
    if not cleaned_query:
        raise InputValidationError("query must not be empty")

    disc = normalize_discipline(discipline)
    coll = normalize_collection(collection)
    safe_max_results = max(1, min(int(max_results), 20))

    try:
        rpc_result = sb.rpc(
            "match_civil_sections_v2",
            {
                "query_embedding": embed(cleaned_query, dimensions=EMBEDDING_DIMENSIONS),
                "match_count": safe_max_results,
                "filter_disc": disc,
                "filter_collection": coll,
            },
        ).execute()
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase v2 section RPC failed: {exc}") from exc

    rows = rpc_result.data or []
    results = [
        {
            "id": row.get("id"),
            "document_id": row.get("document_id"),
            "source": row.get("source", "unknown-source"),
            "collection": row.get("collection", "ce_project"),
            "source_type": row.get("source_type", "paper"),
            "parent_source_pdf": row.get("parent_source_pdf"),
            "paper_code": row.get("paper_code"),
            "page_start": row.get("page_start"),
            "page_end": row.get("page_end"),
            "proceeding_no": row.get("proceeding_no"),
            "proceeding_year": row.get("proceeding_year"),
            "discipline": row.get("discipline", "unknown"),
            "section_index": row.get("section_index"),
            "section_title": row.get("section_title", "Untitled section"),
            "similarity": round(float(row.get("similarity", 0.0)), 3),
            "content": row.get("content", ""),
        }
        for row in rows
    ]

    if not results:
        return ToolExecutionResult(
            tool="search_civil_sections",
            structured_content={
                "query": cleaned_query,
                "discipline": disc or "",
                "collection": coll or "",
                "retrieval_version": "v2",
                "result_count": 0,
                "results": [],
            },
            content_text="No relevant sections found in the v2 knowledge base.",
            meta={"result_count": 0},
        )

    text_blocks = [
        f"[{result['similarity']}] {result['source']} · {result['section_title']}\n{result['content']}"
        for result in results
    ]
    return ToolExecutionResult(
        tool="search_civil_sections",
        structured_content={
            "query": cleaned_query,
            "discipline": disc or "",
            "collection": coll or "",
            "retrieval_version": "v2",
            "result_count": len(results),
            "results": results,
        },
        content_text="\n\n---\n\n".join(text_blocks),
        meta={"result_count": len(results)},
    )


def _search_civil_chunks_impl(
    query: str,
    discipline: str = "",
    max_results: int = 8,
    document_ids: Any = None,
    section_ids: Any = None,
    collection: str = "",
) -> ToolExecutionResult:
    if RETRIEVAL_VERSION != "v2":
        raise InputValidationError("search_civil_chunks requires RETRIEVAL_VERSION=v2")

    cleaned_query = query.strip()
    if not cleaned_query:
        raise InputValidationError("query must not be empty")

    disc = normalize_discipline(discipline)
    coll = normalize_collection(collection)
    safe_max_results = max(1, min(int(max_results), 20))
    doc_filter = normalize_string_list(document_ids)
    section_filter = normalize_string_list(section_ids)

    try:
        rpc_result = sb.rpc(
            "match_civil_chunks_v2",
            {
                "query_embedding": embed(cleaned_query, dimensions=EMBEDDING_DIMENSIONS),
                "match_count": safe_max_results,
                "filter_disc": disc,
                "filter_document_ids": doc_filter,
                "filter_section_ids": section_filter,
                "filter_collection": coll,
            },
        ).execute()
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase v2 chunk RPC failed: {exc}") from exc

    results = [chunk_result_from_row(row) for row in (rpc_result.data or [])]
    if not results:
        return ToolExecutionResult(
            tool="search_civil_chunks",
            structured_content={
                "query": cleaned_query,
                "discipline": disc or "",
                "collection": coll or "",
                "retrieval_version": "v2",
                "result_count": 0,
                "results": [],
            },
            content_text="No relevant chunks found in the v2 knowledge base.",
            meta={"result_count": 0},
        )

    text_blocks = [
        f"[{result['similarity']}] {citation_for_result(result)}\n{result['content']}"
        for result in results
    ]
    return ToolExecutionResult(
        tool="search_civil_chunks",
        structured_content={
            "query": cleaned_query,
            "discipline": disc or "",
            "collection": coll or "",
            "retrieval_version": "v2",
            "result_count": len(results),
            "filters": {
                "document_ids": doc_filter or [],
                "section_ids": section_filter or [],
            },
            "results": results,
        },
        content_text="\n\n---\n\n".join(text_blocks),
        meta={"result_count": len(results)},
    )


def _search_civil_knowledge_v2_impl(
    query: str,
    discipline: str = "",
    max_results: int = 5,
    collection: str = "",
) -> ToolExecutionResult:
    cleaned_query = query.strip()
    if not cleaned_query:
        raise InputValidationError("query must not be empty")

    disc = normalize_discipline(discipline)
    coll = normalize_collection(collection)
    safe_max_results = max(1, min(int(max_results), CONTEXT_MAX_CHUNKS))
    query_embedding = embed(cleaned_query, dimensions=EMBEDDING_DIMENSIONS)

    try:
        section_rpc = sb.rpc(
            "match_civil_sections_v2",
            {
                "query_embedding": query_embedding,
                "match_count": max(1, min(SECTION_TOP_K, 50)),
                "filter_disc": disc,
                "filter_collection": coll,
            },
        ).execute()
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase v2 section RPC failed: {exc}") from exc

    section_rows = section_rpc.data or []
    if not section_rows:
        return ToolExecutionResult(
            tool="search_civil_knowledge",
            structured_content={
                "query": cleaned_query,
                "discipline": disc or "",
                "collection": coll or "",
                "retrieval_version": "v2",
                "result_count": 0,
                "sections_considered": 0,
                "results": [],
            },
            content_text="No relevant content found in the v2 knowledge base.",
            meta={"result_count": 0, "sections_considered": 0},
        )

    section_ids = [str(row["id"]) for row in section_rows if row.get("id")]
    section_similarity = {
        str(row["id"]): round(float(row.get("similarity", 0.0)), 3)
        for row in section_rows
        if row.get("id")
    }

    try:
        chunk_rpc = sb.rpc(
            "match_civil_chunks_v2",
            {
                "query_embedding": query_embedding,
                "match_count": max(CHUNK_TOP_K, safe_max_results),
                "filter_disc": disc,
                "filter_document_ids": None,
                "filter_section_ids": section_ids,
                "filter_collection": coll,
            },
        ).execute()
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase v2 chunk RPC failed: {exc}") from exc

    chunk_rows = chunk_rpc.data or []
    seen: set[tuple[str, int, int]] = set()
    results: list[dict[str, Any]] = []
    for row in chunk_rows:
        key = (
            str(row.get("source", "")),
            int(row.get("section_index", 0)),
            int(row.get("chunk_index", 0)),
        )
        if key in seen:
            continue
        seen.add(key)
        section_id = str(row.get("section_id", ""))
        results.append(
            {
                "id": row.get("id"),
                "document_id": row.get("document_id"),
                "section_id": section_id,
                "source": row.get("source", "unknown-source"),
                "collection": row.get("collection", "ce_project"),
                "source_type": row.get("source_type", "paper"),
                "parent_source_pdf": row.get("parent_source_pdf"),
                "paper_code": row.get("paper_code"),
                "page_start": row.get("page_start"),
                "page_end": row.get("page_end"),
                "proceeding_no": row.get("proceeding_no"),
                "proceeding_year": row.get("proceeding_year"),
                "discipline": row.get("discipline", "unknown"),
                "section_index": row.get("section_index"),
                "section_title": row.get("section_title", "Untitled section"),
                "chunk_index": row.get("chunk_index"),
                "similarity": round(float(row.get("similarity", 0.0)), 3),
                "section_similarity": section_similarity.get(section_id, 0.0),
                "content": row.get("content", ""),
            }
        )
        if len(results) >= safe_max_results:
            break

    if not results:
        return ToolExecutionResult(
            tool="search_civil_knowledge",
            structured_content={
                "query": cleaned_query,
                "discipline": disc or "",
                "collection": coll or "",
                "retrieval_version": "v2",
                "result_count": 0,
                "sections_considered": len(section_rows),
                "results": [],
            },
            content_text="Relevant sections were found, but no matching chunks were available.",
            meta={"result_count": 0, "sections_considered": len(section_rows)},
        )

    text_blocks = [
        (
            f"[chunk {result['similarity']} | section {result['section_similarity']}] "
            f"{result['source']} · {result['section_title']} · chunk {result['chunk_index']}\n"
            f"{result['content']}"
        )
        for result in results
    ]
    return ToolExecutionResult(
        tool="search_civil_knowledge",
        structured_content={
            "query": cleaned_query,
            "discipline": disc or "",
            "collection": coll or "",
            "retrieval_version": "v2",
            "result_count": len(results),
            "sections_considered": len(section_rows),
            "results": results,
        },
        content_text="\n\n---\n\n".join(text_blocks),
        meta={
            "result_count": len(results),
            "sections_considered": len(section_rows),
            "embedding_dimensions": EMBEDDING_DIMENSIONS,
        },
    )


def _list_papers_impl(discipline: str = "", collection: str = "") -> ToolExecutionResult:
    if RETRIEVAL_VERSION == "v2":
        return _list_papers_v2_impl(discipline=discipline, collection=collection)
    return _list_papers_v1_impl(discipline=discipline)


def _list_papers_v1_impl(discipline: str = "") -> ToolExecutionResult:
    disc = normalize_discipline(discipline)

    try:
        rows: list[dict[str, Any]] = []
        page_size = 1000
        offset = 0
        while True:
            query = sb.table("civil_chunks").select("source, discipline").range(
                offset, offset + page_size - 1
            )
            if disc:
                query = query.eq("discipline", disc)

            page_rows = query.execute().data or []
            rows.extend(page_rows)
            if len(page_rows) < page_size:
                break
            offset += page_size
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase list query failed: {exc}") from exc

    unique_papers = sorted({(row["source"], row["discipline"]) for row in rows})
    papers = [{"source": source, "discipline": paper_disc} for source, paper_disc in unique_papers]

    if not papers:
        return ToolExecutionResult(
            tool="list_papers",
            structured_content={"discipline": disc or "", "paper_count": 0, "papers": []},
            content_text="No papers found in the knowledge base.",
            meta={"paper_count": 0},
        )

    paper_lines = [f"- [{paper['discipline']}] {paper['source']}" for paper in papers]
    return ToolExecutionResult(
        tool="list_papers",
        structured_content={
            "discipline": disc or "",
            "paper_count": len(papers),
            "papers": papers,
        },
        content_text=f"Found {len(papers)} papers:\n" + "\n".join(paper_lines),
        meta={"paper_count": len(papers)},
    )


def _list_papers_v2_impl(discipline: str = "", collection: str = "") -> ToolExecutionResult:
    disc = normalize_discipline(discipline)
    coll = normalize_collection(collection)

    try:
        rows: list[dict[str, Any]] = []
        page_size = 1000
        offset = 0
        while True:
            query = (
                sb.table("civil_documents_v2")
                .select(
                    "source, source_pdf, collection, source_type, parent_source_pdf, paper_code, "
                    "page_start, page_end, proceeding_no, proceeding_year, discipline, "
                    "section_count, chunk_count, indexed_at"
                )
                .range(offset, offset + page_size - 1)
            )
            if disc:
                query = query.eq("discipline", disc)
            if coll:
                query = query.eq("collection", coll)

            page_rows = query.execute().data or []
            rows.extend(page_rows)
            if len(page_rows) < page_size:
                break
            offset += page_size
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase v2 document list query failed: {exc}") from exc

    papers = [
        {
            "source": row.get("source"),
            "source_pdf": row.get("source_pdf"),
            "collection": row.get("collection", "ce_project"),
            "source_type": row.get("source_type", "paper"),
            "parent_source_pdf": row.get("parent_source_pdf"),
            "paper_code": row.get("paper_code"),
            "page_start": row.get("page_start"),
            "page_end": row.get("page_end"),
            "proceeding_no": row.get("proceeding_no"),
            "proceeding_year": row.get("proceeding_year"),
            "discipline": row.get("discipline"),
            "section_count": row.get("section_count", 0),
            "chunk_count": row.get("chunk_count", 0),
            "indexed_at": row.get("indexed_at"),
        }
        for row in rows
    ]

    if not papers:
        return ToolExecutionResult(
            tool="list_papers",
            structured_content={
                "discipline": disc or "",
                "collection": coll or "",
                "retrieval_version": "v2",
                "paper_count": 0,
                "papers": [],
            },
            content_text="No papers found in the v2 knowledge base.",
            meta={"paper_count": 0},
        )

    paper_lines = [
        f"- [{paper['collection']} · {paper['discipline']}] {paper['source']} ({paper['section_count']} sections, {paper['chunk_count']} chunks)"
        for paper in papers
    ]
    return ToolExecutionResult(
        tool="list_papers",
        structured_content={
            "discipline": disc or "",
            "collection": coll or "",
            "retrieval_version": "v2",
            "paper_count": len(papers),
            "papers": papers,
        },
        content_text=f"Found {len(papers)} v2 papers:\n" + "\n".join(paper_lines),
        meta={"paper_count": len(papers)},
    )


def _list_collections_impl() -> ToolExecutionResult:
    if RETRIEVAL_VERSION != "v2":
        return ToolExecutionResult(
            tool="list_collections",
            structured_content={"retrieval_version": RETRIEVAL_VERSION, "collections": []},
            content_text="Collections are only available with RETRIEVAL_VERSION=v2.",
        )

    try:
        rows: list[dict[str, Any]] = []
        page_size = 1000
        offset = 0
        while True:
            page_rows = (
                sb.table("civil_documents_v2")
                .select("collection, section_count, chunk_count")
                .range(offset, offset + page_size - 1)
                .execute()
                .data
                or []
            )
            rows.extend(page_rows)
            if len(page_rows) < page_size:
                break
            offset += page_size
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase collection list query failed: {exc}") from exc

    summary: dict[str, dict[str, int]] = {}
    for row in rows:
        collection = row.get("collection") or "ce_project"
        item = summary.setdefault(collection, {"documents": 0, "sections": 0, "chunks": 0})
        item["documents"] += 1
        item["sections"] += int(row.get("section_count") or 0)
        item["chunks"] += int(row.get("chunk_count") or 0)

    collections = [
        {"collection": name, **counts}
        for name, counts in sorted(summary.items())
    ]
    lines = [
        f"- {item['collection']}: {item['documents']} docs, {item['sections']} sections, {item['chunks']} chunks"
        for item in collections
    ]
    return ToolExecutionResult(
        tool="list_collections",
        structured_content={
            "retrieval_version": "v2",
            "collections": collections,
        },
        content_text="Indexed collections:\n" + "\n".join(lines),
        meta={"collection_count": len(collections)},
    )


def _fetch_civil_paper_impl(
    source: str,
    include_sections: bool = True,
    include_chunks: bool = False,
    max_sections: int = 80,
    max_chunks: int = 20,
) -> ToolExecutionResult:
    if RETRIEVAL_VERSION != "v2":
        raise InputValidationError("fetch_civil_paper requires RETRIEVAL_VERSION=v2")

    cleaned_source = source.strip()
    if not cleaned_source:
        raise InputValidationError("source must not be empty")

    try:
        document_rows = (
            sb.table("civil_documents_v2")
            .select(
                "id, source, source_pdf, collection, source_type, parent_source_pdf, paper_code, "
                "page_start, page_end, proceeding_no, proceeding_year, discipline, doc_hash, "
                "section_count, chunk_count, indexed_at"
            )
            .or_(f"id.eq.{cleaned_source},source.eq.{cleaned_source},source_pdf.eq.{cleaned_source}")
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase v2 document lookup failed: {exc}") from exc

    if not document_rows:
        return ToolExecutionResult(
            tool="fetch_civil_paper",
            structured_content={
                "source": cleaned_source,
                "retrieval_version": "v2",
                "found": False,
                "document": None,
                "sections": [],
                "chunks": [],
            },
            content_text=f"No v2 paper found for source: {cleaned_source}",
            meta={"found": False},
        )

    document = document_rows[0]
    sections: list[dict[str, Any]] = []
    chunks: list[dict[str, Any]] = []

    if include_sections:
        try:
            sections = (
                sb.table("civil_sections_v2")
                .select(
                    "id, collection, source_type, parent_source_pdf, paper_code, page_start, page_end, "
                    "proceeding_no, proceeding_year, section_index, section_title, content"
                )
                .eq("document_id", document["id"])
                .eq("is_stale", False)
                .order("section_index")
                .limit(max(1, min(int(max_sections), 200)))
                .execute()
                .data
                or []
            )
        except Exception as exc:  # noqa: BLE001
            raise UpstreamToolCallError(f"Supabase v2 section lookup failed: {exc}") from exc

    if include_chunks:
        try:
            chunks = (
                sb.table("civil_chunks_v2")
                .select(
                    "id, document_id, section_id, source, collection, source_type, parent_source_pdf, "
                    "paper_code, page_start, page_end, proceeding_no, proceeding_year, discipline, "
                    "section_index, section_title, chunk_index, content"
                )
                .eq("document_id", document["id"])
                .eq("is_stale", False)
                .order("section_index")
                .order("chunk_index")
                .limit(max(1, min(int(max_chunks), 80)))
                .execute()
                .data
                or []
            )
        except Exception as exc:  # noqa: BLE001
            raise UpstreamToolCallError(f"Supabase v2 chunk lookup failed: {exc}") from exc

    section_lines = [
        f"- {section['section_index']}: {section['section_title']}"
        for section in sections[:20]
    ]
    chunk_lines = [
        f"- {citation_for_result(chunk)}\n{chunk.get('content', '')}"
        for chunk in chunks[:8]
    ]
    content_parts = [f"Paper: {document['source']} ({document['discipline']})"]
    if section_lines:
        content_parts.append("Sections:\n" + "\n".join(section_lines))
    if chunk_lines:
        content_parts.append("Chunks:\n" + "\n\n".join(chunk_lines))

    return ToolExecutionResult(
        tool="fetch_civil_paper",
        structured_content={
            "source": cleaned_source,
            "retrieval_version": "v2",
            "found": True,
            "document": document,
            "sections": sections,
            "chunks": chunks,
        },
        content_text="\n\n".join(content_parts),
        meta={
            "found": True,
            "section_count": len(sections),
            "chunk_count": len(chunks),
        },
    )


def _fetch_chunk_neighbors_impl(
    chunk_id: str = "",
    source: str = "",
    section_index: int | None = None,
    chunk_index: int | None = None,
    window: int = 1,
) -> ToolExecutionResult:
    if RETRIEVAL_VERSION != "v2":
        raise InputValidationError("fetch_chunk_neighbors requires RETRIEVAL_VERSION=v2")

    safe_window = max(0, min(int(window), 3))

    try:
        target_rows: list[dict[str, Any]]
        cleaned_chunk_id = chunk_id.strip()
        if cleaned_chunk_id:
            target_rows = (
                sb.table("civil_chunks_v2")
                .select(
                    "id, document_id, section_id, source, collection, source_type, parent_source_pdf, "
                    "paper_code, page_start, page_end, proceeding_no, proceeding_year, discipline, "
                    "section_index, section_title, chunk_index"
                )
                .eq("id", cleaned_chunk_id)
                .eq("is_stale", False)
                .limit(1)
                .execute()
                .data
                or []
            )
        else:
            cleaned_source = source.strip()
            if not cleaned_source or section_index is None or chunk_index is None:
                raise InputValidationError(
                    "Provide chunk_id, or provide source + section_index + chunk_index."
                )
            target_rows = (
                sb.table("civil_chunks_v2")
                .select(
                    "id, document_id, section_id, source, collection, source_type, parent_source_pdf, "
                    "paper_code, page_start, page_end, proceeding_no, proceeding_year, discipline, "
                    "section_index, section_title, chunk_index"
                )
                .eq("source", cleaned_source)
                .eq("section_index", int(section_index))
                .eq("chunk_index", int(chunk_index))
                .eq("is_stale", False)
                .limit(1)
                .execute()
                .data
                or []
            )
    except ToolCallError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase v2 target chunk lookup failed: {exc}") from exc

    if not target_rows:
        return ToolExecutionResult(
            tool="fetch_chunk_neighbors",
            structured_content={
                "retrieval_version": "v2",
                "found": False,
                "target": None,
                "neighbors": [],
            },
            content_text="No target chunk found.",
            meta={"found": False, "neighbor_count": 0},
        )

    target = target_rows[0]
    start_index = max(0, int(target["chunk_index"]) - safe_window)
    end_index = int(target["chunk_index"]) + safe_window

    try:
        neighbors = (
            sb.table("civil_chunks_v2")
            .select(
                "id, document_id, section_id, source, collection, source_type, parent_source_pdf, "
                "paper_code, page_start, page_end, proceeding_no, proceeding_year, discipline, "
                "section_index, section_title, chunk_index, content"
            )
            .eq("section_id", target["section_id"])
            .eq("is_stale", False)
            .gte("chunk_index", start_index)
            .lte("chunk_index", end_index)
            .order("chunk_index")
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase v2 neighbor chunk lookup failed: {exc}") from exc

    results = [chunk_result_from_row(row) for row in neighbors]
    text_blocks = [
        f"[{citation_for_result(result)}]\n{result['content']}"
        for result in results
    ]
    return ToolExecutionResult(
        tool="fetch_chunk_neighbors",
        structured_content={
            "retrieval_version": "v2",
            "found": True,
            "target": target,
            "window": safe_window,
            "neighbor_count": len(results),
            "neighbors": results,
        },
        content_text="\n\n---\n\n".join(text_blocks),
        meta={"found": True, "neighbor_count": len(results)},
    )


def _fetch_paper_outline_impl(source: str) -> ToolExecutionResult:
    cleaned_source = source.strip()
    if not cleaned_source:
        raise InputValidationError("source must not be empty")

    try:
        document_rows = (
            sb.table("civil_documents_v2")
            .select(
                "id, source, source_pdf, collection, source_type, parent_source_pdf, paper_code, "
                "page_start, page_end, proceeding_no, proceeding_year, discipline, section_count, "
                "chunk_count, indexed_at"
            )
            .eq("source", cleaned_source)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not document_rows:
            document_rows = (
                sb.table("civil_documents_v2")
                .select(
                    "id, source, source_pdf, collection, source_type, parent_source_pdf, paper_code, "
                    "page_start, page_end, proceeding_no, proceeding_year, discipline, section_count, "
                    "chunk_count, indexed_at"
                )
                .eq("source_pdf", cleaned_source)
                .limit(1)
                .execute()
                .data
                or []
            )
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase v2 document lookup failed: {exc}") from exc

    if not document_rows:
        return ToolExecutionResult(
            tool="fetch_paper_outline",
            structured_content={"source": cleaned_source, "found": False, "sections": []},
            content_text=f"No v2 paper found for source: {cleaned_source}",
            meta={"found": False},
        )

    document = document_rows[0]
    try:
        sections = (
            sb.table("civil_sections_v2")
            .select("id, section_index, section_title, page_start, page_end")
            .eq("document_id", document["id"])
            .eq("is_stale", False)
            .order("section_index")
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase v2 outline query failed: {exc}") from exc

    lines = [
        f"- {section['section_index']}: {section['section_title']}"
        for section in sections
    ]
    return ToolExecutionResult(
        tool="fetch_paper_outline",
        structured_content={
            "source": cleaned_source,
            "retrieval_version": "v2",
            "found": True,
            "document": document,
            "sections": sections,
        },
        content_text=f"Outline for {document['source']}:\n" + "\n".join(lines),
        meta={"found": True, "section_count": len(sections)},
    )


def _dispatch_tool_call(name: str, arguments: dict[str, Any]) -> ToolExecutionResult:
    if name == "search_civil_knowledge":
        return _search_civil_knowledge_impl(
            query=str(arguments.get("query", "")),
            discipline=str(arguments.get("discipline", "")),
            max_results=int(arguments.get("max_results", 5)),
            collection=str(arguments.get("collection", "")),
        )
    if name == "search_civil_sections":
        return _search_civil_sections_impl(
            query=str(arguments.get("query", "")),
            discipline=str(arguments.get("discipline", "")),
            max_results=int(arguments.get("max_results", 10)),
            collection=str(arguments.get("collection", "")),
        )
    if name == "search_civil_chunks":
        return _search_civil_chunks_impl(
            query=str(arguments.get("query", "")),
            discipline=str(arguments.get("discipline", "")),
            max_results=int(arguments.get("max_results", 8)),
            document_ids=arguments.get("document_ids"),
            section_ids=arguments.get("section_ids"),
            collection=str(arguments.get("collection", "")),
        )
    if name == "fetch_civil_paper":
        return _fetch_civil_paper_impl(
            source=str(arguments.get("source", "")),
            include_sections=normalize_bool(arguments.get("include_sections"), default=True),
            include_chunks=normalize_bool(arguments.get("include_chunks"), default=False),
            max_sections=int(arguments.get("max_sections", 80)),
            max_chunks=int(arguments.get("max_chunks", 20)),
        )
    if name == "fetch_chunk_neighbors":
        raw_section_index = arguments.get("section_index")
        raw_chunk_index = arguments.get("chunk_index")
        return _fetch_chunk_neighbors_impl(
            chunk_id=str(arguments.get("chunk_id", "")),
            source=str(arguments.get("source", "")),
            section_index=int(raw_section_index) if raw_section_index is not None else None,
            chunk_index=int(raw_chunk_index) if raw_chunk_index is not None else None,
            window=int(arguments.get("window", 1)),
        )
    if name == "fetch_paper_outline":
        return _fetch_paper_outline_impl(source=str(arguments.get("source", "")))
    if name == "list_papers":
        return _list_papers_impl(
            discipline=str(arguments.get("discipline", "")),
            collection=str(arguments.get("collection", "")),
        )
    if name == "list_collections":
        return _list_collections_impl()
    raise InputValidationError(f"Unknown tool: {name}")


def _mcp_tool_decorator(annotations: dict[str, Any]):
    try:
        signature = inspect.signature(mcp.tool)
        if "annotations" in signature.parameters:
            return mcp.tool(annotations=annotations)
    except Exception:  # noqa: BLE001
        pass
    return mcp.tool()


def _execute_mcp_decorated_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        result = _dispatch_tool_call(name, arguments)
    except ToolCallError as exc:
        latency_ms = (time.perf_counter() - started) * 1000
        METRICS.record_tool(name, latency_ms=latency_ms, ok=False, error_code=exc.error_code)
        raise
    except Exception:
        latency_ms = (time.perf_counter() - started) * 1000
        METRICS.record_tool(name, latency_ms=latency_ms, ok=False, error_code="internal_error")
        raise

    latency_ms = (time.perf_counter() - started) * 1000
    METRICS.record_tool(name, latency_ms=latency_ms, ok=True)
    return result.to_payload(request_id="mcp-tool", latency_ms=latency_ms)


@_mcp_tool_decorator(TOOL_DEFINITIONS["search_civil_knowledge"]["annotations"])
def search_civil_knowledge(
    query: str,
    discipline: str = "",
    max_results: int = 5,
    collection: str = "",
) -> dict[str, Any]:
    return _execute_mcp_decorated_tool(
        "search_civil_knowledge",
        {"query": query, "discipline": discipline, "max_results": max_results, "collection": collection},
    )


@_mcp_tool_decorator(TOOL_DEFINITIONS["search_civil_sections"]["annotations"])
def search_civil_sections(
    query: str,
    discipline: str = "",
    max_results: int = 10,
    collection: str = "",
) -> dict[str, Any]:
    return _execute_mcp_decorated_tool(
        "search_civil_sections",
        {"query": query, "discipline": discipline, "max_results": max_results, "collection": collection},
    )


@_mcp_tool_decorator(TOOL_DEFINITIONS["search_civil_chunks"]["annotations"])
def search_civil_chunks(
    query: str,
    discipline: str = "",
    max_results: int = 8,
    document_ids: list[str] | None = None,
    section_ids: list[str] | None = None,
    collection: str = "",
) -> dict[str, Any]:
    return _execute_mcp_decorated_tool(
        "search_civil_chunks",
        {
            "query": query,
            "discipline": discipline,
            "max_results": max_results,
            "document_ids": document_ids,
            "section_ids": section_ids,
            "collection": collection,
        },
    )


@_mcp_tool_decorator(TOOL_DEFINITIONS["fetch_civil_paper"]["annotations"])
def fetch_civil_paper(
    source: str,
    include_sections: bool = True,
    include_chunks: bool = False,
    max_sections: int = 80,
    max_chunks: int = 20,
) -> dict[str, Any]:
    return _execute_mcp_decorated_tool(
        "fetch_civil_paper",
        {
            "source": source,
            "include_sections": include_sections,
            "include_chunks": include_chunks,
            "max_sections": max_sections,
            "max_chunks": max_chunks,
        },
    )


@_mcp_tool_decorator(TOOL_DEFINITIONS["fetch_chunk_neighbors"]["annotations"])
def fetch_chunk_neighbors(
    chunk_id: str = "",
    source: str = "",
    section_index: int | None = None,
    chunk_index: int | None = None,
    window: int = 1,
) -> dict[str, Any]:
    return _execute_mcp_decorated_tool(
        "fetch_chunk_neighbors",
        {
            "chunk_id": chunk_id,
            "source": source,
            "section_index": section_index,
            "chunk_index": chunk_index,
            "window": window,
        },
    )


@_mcp_tool_decorator(TOOL_DEFINITIONS["fetch_paper_outline"]["annotations"])
def fetch_paper_outline(source: str) -> dict[str, Any]:
    return _execute_mcp_decorated_tool("fetch_paper_outline", {"source": source})


@_mcp_tool_decorator(TOOL_DEFINITIONS["list_papers"]["annotations"])
def list_papers(discipline: str = "", collection: str = "") -> dict[str, Any]:
    return _execute_mcp_decorated_tool("list_papers", {"discipline": discipline, "collection": collection})


@_mcp_tool_decorator(TOOL_DEFINITIONS["list_collections"]["annotations"])
def list_collections() -> dict[str, Any]:
    return _execute_mcp_decorated_tool("list_collections", {})


class ToolCallPayload(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


app = FastAPI(title="Civil Engineering MCP Server")


@app.middleware("http")
async def request_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id", "").strip() or str(uuid.uuid4())
    request.state.request_id = request_id
    METRICS.record_request()

    started = time.perf_counter()
    is_transport = is_mounted_transport_request(request)
    caller = "public"
    if is_transport:
        try:
            caller = authenticate_mcp_request(request, "MCP transport")
            request.state.mcp_caller = caller
            await enforce_mcp_rate_limit(caller, "transport", client_host_for_request(request))
        except ToolCallError as exc:
            METRICS.record_transport(ok=False, error_code=exc.error_code)
            log_event(
                logging.WARNING,
                "mcp_transport_rejected",
                path=request.url.path,
                request_id=request_id,
                caller=caller,
                error_code=exc.error_code,
            )
            return tool_error_response(exc, request_id)

    try:
        if is_transport:
            response = await asyncio.wait_for(call_next(request), timeout=TOOL_TIMEOUT_SECONDS)
            METRICS.record_transport(ok=True)
        else:
            response = await call_next(request)
    except asyncio.TimeoutError:
        latency_ms = (time.perf_counter() - started) * 1000
        METRICS.record_transport(ok=False, error_code="upstream_timeout")
        logger.warning(
            "mcp_transport_timeout method=%s path=%s req_id=%s latency_ms=%.2f",
            request.method,
            request.url.path,
            request_id,
            latency_ms,
        )
        return JSONResponse(
            {
                "detail": {
                    "code": "upstream_timeout",
                    "message": "MCP transport request timed out.",
                    "request_id": request_id,
                }
            },
            status_code=504,
        )
    except Exception:  # noqa: BLE001
        latency_ms = (time.perf_counter() - started) * 1000
        logger.exception(
            "request_failed method=%s path=%s req_id=%s latency_ms=%.2f",
            request.method,
            request.url.path,
            request_id,
            latency_ms,
        )
        raise

    latency_ms = (time.perf_counter() - started) * 1000
    response.headers["x-request-id"] = request_id
    log_event(
        logging.INFO,
        "request_complete",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        request_id=request_id,
        caller=getattr(request.state, "mcp_caller", caller),
        latency_ms=round(latency_ms, 2),
    )
    return response


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/health/ready")
async def readiness() -> JSONResponse:
    def check_dependencies() -> dict[str, Any]:
        docs = sb.table("civil_documents_v2").select("id", count="exact").limit(1).execute()
        readiness_response = sb.rpc("civil_backbone_readiness").execute()
        readiness_data = readiness_response.data
        readiness_row = readiness_data[0] if isinstance(readiness_data, list) and readiness_data else readiness_data
        if not isinstance(readiness_row, dict) or not all(
            readiness_row.get(key) is True for key in ("quota_table", "quota_rpc", "retention_rpc")
        ):
            raise RuntimeError("CivilMCP backbone migration is incomplete")
        return {"documents": int(docs.count or 0), "backbone": readiness_row}

    try:
        dependencies = await asyncio.wait_for(asyncio.to_thread(check_dependencies), timeout=5)
        return JSONResponse(
            {
                "status": "ready",
                "dependencies": dependencies,
                "retrieval_version": RETRIEVAL_VERSION,
                "auth_clients": len(MCP_CLIENT_KEYS) + (1 if MCP_SERVER_API_KEY.strip() else 0),
            }
        )
    except Exception as exc:  # noqa: BLE001
        log_event(logging.ERROR, "readiness_failed", error=type(exc).__name__)
        return JSONResponse({"status": "not_ready", "error": "dependency_check_failed"}, status_code=503)


@app.get("/")
async def root_info() -> JSONResponse:
    return JSONResponse(
        {
            "service": "civil-engineering-mcp",
            "status": "ok",
            "message": "CivilMCP server is running. Use /tools/list, /tools/call, or MCP transport for clients.",
            "retrieval": {
                "version": RETRIEVAL_VERSION,
                "embedding_dimensions": EMBEDDING_DIMENSIONS if RETRIEVAL_VERSION == "v2" else 1536,
            },
            "endpoints": {
                "health": "/health",
                "readiness": "/health/ready",
                "tools_list": "/tools/list",
                "tools_call": "/tools/call",
            },
        }
    )


@app.get("/metrics")
async def metrics() -> dict[str, Any]:
    return METRICS.snapshot()


@app.get("/tools/list")
async def tools_list() -> dict[str, Any]:
    return {
        "tools": [
            {
                "name": name,
                "description": detail["description"],
                "annotations": detail["annotations"],
            }
            for name, detail in TOOL_DEFINITIONS.items()
        ],
        "auth_required_for_tools_call": REQUIRE_TOOL_AUTH,
        "retrieval": {
            "version": RETRIEVAL_VERSION,
            "embedding_model": EMBED_MODEL,
            "embedding_dimensions": EMBEDDING_DIMENSIONS if RETRIEVAL_VERSION == "v2" else 1536,
            "section_top_k": SECTION_TOP_K,
            "chunk_top_k": CHUNK_TOP_K,
            "context_max_chunks": CONTEXT_MAX_CHUNKS,
        },
        "rate_limit": {
            "window_seconds": RATE_LIMIT_WINDOW_SECONDS,
            "max_calls": RATE_LIMIT_MAX_CALLS,
        },
    }


@app.post("/tools/call")
async def tools_call(payload: ToolCallPayload, request: Request) -> dict[str, Any]:
    request_id = get_request_id(request)
    started = 0.0
    try:
        caller = authenticate_tools_call(request)
        client_host = client_host_for_request(request)
        request.state.mcp_caller = caller
        await enforce_mcp_rate_limit(caller, "tools_call", client_host)

        started = time.perf_counter()
        result = await asyncio.wait_for(
            asyncio.to_thread(_dispatch_tool_call, payload.name, payload.arguments),
            timeout=TOOL_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        latency_ms = (time.perf_counter() - started) * 1000
        METRICS.record_tool(payload.name, latency_ms=latency_ms, ok=False, error_code="upstream_timeout")
        logger.warning(
            "tool_call_timeout tool=%s req_id=%s latency_ms=%.2f",
            payload.name,
            request_id,
            latency_ms,
        )
        raise HTTPException(
            status_code=504,
            detail={
                "code": "upstream_timeout",
                "message": "Tool call timed out.",
                "request_id": request_id,
            },
        ) from exc
    except ToolCallError as exc:
        latency_ms = ((time.perf_counter() - started) * 1000) if started else 0.0
        METRICS.record_tool(payload.name, latency_ms=latency_ms, ok=False, error_code=exc.error_code)
        logger.warning(
            "tool_call_error tool=%s req_id=%s code=%s message=%s latency_ms=%.2f",
            payload.name,
            request_id,
            exc.error_code,
            str(exc),
            latency_ms,
        )
        detail: dict[str, Any] = {
            "code": exc.error_code,
            "message": str(exc),
            "request_id": request_id,
        }
        headers: dict[str, str] = {}
        if isinstance(exc, RateLimitedToolCall) and exc.retry_after_seconds is not None:
            detail["retry_after_seconds"] = round(exc.retry_after_seconds, 2)
            headers["Retry-After"] = str(max(1, int(exc.retry_after_seconds)))

        raise HTTPException(
            status_code=exc.status_code,
            detail=detail,
            headers=headers or None,
        ) from exc
    except Exception as exc:  # noqa: BLE001
        latency_ms = ((time.perf_counter() - started) * 1000) if started else 0.0
        METRICS.record_tool(payload.name, latency_ms=latency_ms, ok=False, error_code="internal_error")
        logger.exception(
            "tool_call_unhandled tool=%s req_id=%s latency_ms=%.2f",
            payload.name,
            request_id,
            latency_ms,
        )
        raise HTTPException(
            status_code=500,
            detail={
                "code": "internal_error",
                "message": "Unexpected server error",
                "request_id": request_id,
            },
        ) from exc

    latency_ms = (time.perf_counter() - started) * 1000
    METRICS.record_tool(payload.name, latency_ms=latency_ms, ok=True)
    logger.info(
        "tool_call_success tool=%s req_id=%s latency_ms=%.2f",
        payload.name,
        request_id,
        latency_ms,
    )
    return result.to_payload(request_id=request_id, latency_ms=latency_ms)


# Mount MCP ASGI app for streamable MCP HTTP transport.
if hasattr(mcp, "streamable_http_app"):
    app.mount("/", mcp.streamable_http_app())
elif hasattr(mcp, "get_asgi_app"):
    app.mount("/", mcp.get_asgi_app())
elif hasattr(mcp, "asgi_app"):
    app.mount("/", mcp.asgi_app)
elif hasattr(mcp, "sse_app"):
    app.mount("/", mcp.sse_app())
else:
    raise RuntimeError("No compatible MCP ASGI app mount method found on FastMCP instance.")
