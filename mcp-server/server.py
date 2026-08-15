"""
Civil Engineering MCP server (production-oriented).

Highlights:
- MCP transport via FastMCP ASGI app
- /tools/call compatibility endpoint with auth, rate limit, timeout, metrics
- Structured tool response shape: structuredContent + content + _meta
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import inspect
import json
import logging
import os
import re
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import AsyncExitStack, asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, TextContent
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
OPENAI_MAX_RETRIES = max(0, min(int(os.getenv("OPENAI_MAX_RETRIES", "1")), 3))
EMBEDDING_CIRCUIT_SECONDS = max(5, min(int(os.getenv("EMBEDDING_CIRCUIT_SECONDS", "300")), 3600))
TOOL_TIMEOUT_SECONDS = float(os.getenv("TOOL_TIMEOUT_SECONDS", "20"))
OPENALEX_API_KEY = os.getenv("OPENALEX_API_KEY", "").strip()
FEDERATED_DISCOVERY_ENABLED = os.getenv("FEDERATED_DISCOVERY_ENABLED", "true").lower() != "false"
OPENALEX_TIMEOUT_SECONDS = max(2.0, min(float(os.getenv("OPENALEX_TIMEOUT_SECONDS", "8")), 12.0))

RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
RATE_LIMIT_MAX_CALLS = int(os.getenv("RATE_LIMIT_MAX_CALLS", "240"))
MCP_DISTRIBUTED_RATE_LIMIT = os.getenv("MCP_DISTRIBUTED_RATE_LIMIT", "true").lower() == "true"

REQUIRE_TOOL_AUTH = os.getenv("REQUIRE_TOOL_AUTH", "true").lower() == "true"
MCP_SERVER_API_KEY = os.getenv("MCP_SERVER_API_KEY", "")
MCP_CLIENT_KEYS_JSON = os.getenv("MCP_CLIENT_KEYS_JSON", "").strip()
MCP_WEB_API_KEY_SHA256 = os.getenv("MCP_WEB_API_KEY_SHA256", "").strip().lower()
MCP_PUBLIC_URL = os.getenv(
    "MCP_PUBLIC_URL",
    "https://civil-mcp-server.vercel.app/v2/mcp",
).strip().rstrip("/")
MCP_OAUTH_AUDIENCE = os.getenv("MCP_OAUTH_AUDIENCE", MCP_PUBLIC_URL).strip().rstrip("/")
MCP_OAUTH_ENABLED = os.getenv("MCP_OAUTH_ENABLED", "false").lower() == "true"
MCP_DOCUMENTATION_URL = os.getenv(
    "MCP_DOCUMENTATION_URL",
    "https://civil-mcp-web.vercel.app/developers",
).strip()
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


def validate_public_mcp_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlparse(value)
    except ValueError as exc:
        raise RuntimeError("MCP_PUBLIC_URL must be an absolute HTTPS URL") from exc
    local = parsed.hostname in {"127.0.0.1", "localhost"}
    if not parsed.hostname or (parsed.scheme != "https" and not (local and parsed.scheme == "http")):
        raise RuntimeError("MCP_PUBLIC_URL must be an absolute HTTPS URL")
    return value


validate_public_mcp_url(MCP_PUBLIC_URL)
if MCP_OAUTH_AUDIENCE != MCP_PUBLIC_URL:
    raise RuntimeError("MCP_OAUTH_AUDIENCE must match MCP_PUBLIC_URL")
MCP_TRANSPORT_HOST = urllib.parse.urlparse(MCP_PUBLIC_URL).hostname or "127.0.0.1"


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
if MCP_WEB_API_KEY_SHA256:
    if not re.fullmatch(r"[0-9a-f]{64}", MCP_WEB_API_KEY_SHA256):
        raise RuntimeError("MCP_WEB_API_KEY_SHA256 must be a SHA-256 hex digest")
    web_client_key = f"sha256:{MCP_WEB_API_KEY_SHA256}"
    configured_web_client_key = MCP_CLIENT_KEYS.get("civilmcp-web")
    if configured_web_client_key and configured_web_client_key != web_client_key:
        raise RuntimeError("MCP web client key conflicts with MCP_CLIENT_KEYS_JSON")
    MCP_CLIENT_KEYS.setdefault("civilmcp-web", web_client_key)

if REQUIRE_TOOL_AUTH:
    key = MCP_SERVER_API_KEY.strip()
    legacy_key_valid = not is_placeholder_secret(key) and len(key) >= 32
    if not legacy_key_valid and not MCP_CLIENT_KEYS:
        raise RuntimeError(
            "MCP_CLIENT_KEYS_JSON or a non-placeholder MCP_SERVER_API_KEY is required when REQUIRE_TOOL_AUTH=true"
        )

oa = OpenAI(api_key=OPENAI_API_KEY, timeout=OPENAI_TIMEOUT_SECONDS, max_retries=OPENAI_MAX_RETRIES)
sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
mcp = FastMCP("civil-engineering-mcp", host=MCP_TRANSPORT_HOST)
mcp_v2 = FastMCP(
    "civilmcp-research",
    instructions=(
        "Discover Thai civil-engineering research, retrieve exact-page evidence, compare papers, "
        "and manage the authenticated user's private research library. Metadata-only records are "
        "never citable CivilMCP evidence."
    ),
    host=MCP_TRANSPORT_HOST,
    json_response=True,
    stateless_http=True,
)
MCP_CALLER_CONTEXT: ContextVar[str] = ContextVar("civilmcp_caller", default="")
MCP_PERMISSION_CONTEXT: ContextVar[frozenset[str]] = ContextVar(
    "civilmcp_permissions",
    default=frozenset(),
)

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

VALID_SOURCE_PROVIDERS = {
    "",
    "student_transport_projects",
    "ncce",
    "tci_thaijo",
}

READ_ONLY_ANNOTATIONS = {
    "readOnlyHint": True,
    "openWorldHint": False,
    "destructiveHint": False,
}

WRITE_ANNOTATIONS = {
    "readOnlyHint": False,
    "openWorldHint": False,
    "destructiveHint": False,
}

DELETE_ANNOTATIONS = {
    "readOnlyHint": False,
    "openWorldHint": False,
    "destructiveHint": True,
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
    "search_source_catalog": {
        "description": "Search CivilMCP discovery metadata, including non-citable ThaiJO records and evidence status.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "find_related_papers": {
        "description": "Find page-linked CivilMCP papers in the same engineering discipline as a source paper.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "list_source_providers": {
        "description": "List CivilMCP source providers with indexed, extracted, and metadata-only record counts.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "search_global_research": {
        "description": "Search bounded OpenAlex discovery metadata. Results are not CivilMCP evidence and are never citable.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "map_citation_network": {
        "description": "Map a bounded OpenAlex citation neighborhood around a paper title or DOI. Results are metadata-only.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "get_evidence_snapshot": {
        "description": "Build a deterministic methods, findings, limitations, and Thai-applicability snapshot from exact-page CivilMCP evidence.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "list_library_items": {
        "description": "List papers saved to the authenticated CivilMCP user's private research library.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "save_library_item": {
        "description": "Save or update an indexed CivilMCP paper in the authenticated user's private library.",
        "annotations": WRITE_ANNOTATIONS,
    },
    "remove_library_item": {
        "description": "Remove an indexed paper from the authenticated user's private library.",
        "annotations": DELETE_ANNOTATIONS,
    },
    "list_private_sources": {
        "description": "List PDF and citation records in the authenticated user's private project library.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "fetch_private_source_pages": {
        "description": "Fetch bounded page text from a private PDF owned by the authenticated user.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
}

PUBLIC_V2_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "discover_research": {
        "description": (
            "Discover and rank Thai page-cited evidence, Thai journal metadata, and optional "
            "OpenAlex metadata for a research question. Every result declares whether it is citable."
        ),
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "get_paper": {
        "description": (
            "Read an indexed CivilMCP paper or an authenticated private PDF with bounded page text, "
            "outline metadata, and explicit provenance."
        ),
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "query_papers": {
        "description": (
            "Answer multiple evidence-retrieval queries across selected indexed or private papers and "
            "return citation-ready page packets without synthesizing unsupported claims."
        ),
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "compare_papers": {
        "description": (
            "Build a deterministic cross-paper evidence matrix for methods, findings, limitations, "
            "and Thai applicability from exact-page CivilMCP evidence."
        ),
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "map_citation_network": TOOL_DEFINITIONS["map_citation_network"],
    "get_evidence_snapshot": TOOL_DEFINITIONS["get_evidence_snapshot"],
    "list_library": {
        "description": "List the authenticated user's folders and saved CivilMCP papers.",
        "annotations": READ_ONLY_ANNOTATIONS,
    },
    "create_library_folder": {
        "description": "Create an owner-scoped library folder, optionally nested under another folder.",
        "annotations": WRITE_ANNOTATIONS,
    },
    "rename_library_folder": {
        "description": "Rename an owner-scoped custom library folder.",
        "annotations": WRITE_ANNOTATIONS,
    },
    "delete_library_folder": {
        "description": "Delete a library folder while keeping its papers in the user's library.",
        "annotations": DELETE_ANNOTATIONS,
    },
    "save_papers": {
        "description": "Save up to 50 indexed CivilMCP papers, optionally into a library folder.",
        "annotations": WRITE_ANNOTATIONS,
    },
    "move_papers": {
        "description": "Move up to 50 saved papers between owner-scoped library folders.",
        "annotations": WRITE_ANNOTATIONS,
    },
    "remove_papers": {
        "description": (
            "Remove up to 50 papers from one folder, or remove them from the library when folder_id is omitted."
        ),
        "annotations": DELETE_ANNOTATIONS,
    },
    "list_private_sources": TOOL_DEFINITIONS["list_private_sources"],
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


class InsufficientPermissionToolCall(ToolCallError):
    def __init__(self, message: str, required: str) -> None:
        super().__init__(message, status_code=403, error_code="insufficient_scope")
        self.required = required


class RateLimitedToolCall(ToolCallError):
    def __init__(self, message: str, retry_after_seconds: float | None = None) -> None:
        super().__init__(message, status_code=429, error_code="rate_limited")
        self.retry_after_seconds = retry_after_seconds


class EmbeddingUnavailableToolCall(ToolCallError):
    def __init__(self, message: str, error_code: str = "embedding_unavailable") -> None:
        super().__init__(message, status_code=503, error_code=error_code)


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
        self.retrieval_fallbacks_total = 0
        self.embedding_unavailable_total = 0
        self.tool_errors_by_code: dict[str, int] = defaultdict(int)
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
                if error_code:
                    self.tool_errors_by_code[error_code] += 1
                if error_code == "upstream_timeout":
                    self.tool_timeouts_total += 1

    def record_retrieval_fallback(self, reason: str) -> None:
        with self._lock:
            self.retrieval_fallbacks_total += 1
            if reason in {"embedding_unavailable", "embedding_quota_exhausted", "rate_limited", "upstream_timeout"}:
                self.embedding_unavailable_total += 1

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
                "retrieval_fallbacks_total": self.retrieval_fallbacks_total,
                "embedding_unavailable_total": self.embedding_unavailable_total,
                "tool_errors_by_code": dict(self.tool_errors_by_code),
                "tool_error_rate": round(total_error_rate, 4),
                "tools": per_tool,
            }


RATE_LIMITER = SlidingWindowRateLimiter(
    max_calls=RATE_LIMIT_MAX_CALLS,
    window_seconds=RATE_LIMIT_WINDOW_SECONDS,
)
METRICS = MetricsStore()
EMBEDDING_CIRCUIT_LOCK = Lock()
EMBEDDING_CIRCUIT_UNTIL = 0.0
EMBEDDING_CIRCUIT_REASON = ""


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


def normalize_source_provider(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if cleaned not in VALID_SOURCE_PROVIDERS:
        raise InputValidationError(
            "provider must be one of: 'student_transport_projects', 'ncce', 'tci_thaijo', ''."
        )
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


def _set_mcp_principal(caller: str, permissions: set[str] | frozenset[str]) -> str:
    MCP_CALLER_CONTEXT.set(caller)
    MCP_PERMISSION_CONTEXT.set(frozenset(permissions))
    return caller


def _jwt_payload(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3:
        raise UnauthorizedToolCall("Invalid OAuth access token")
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UnauthorizedToolCall("Invalid OAuth access token") from exc
    if not isinstance(payload, dict):
        raise UnauthorizedToolCall("Invalid OAuth access token")
    return payload


def _validate_supabase_oauth_token(token: str) -> tuple[str, set[str]]:
    if not MCP_OAUTH_ENABLED:
        raise UnauthorizedToolCall("OAuth access is not enabled; use a CivilMCP personal API key")
    payload = _jwt_payload(token)
    expected_issuer = f"{SUPABASE_URL.rstrip('/')}/auth/v1"
    audience = payload.get("aud")
    audiences = {str(value) for value in audience} if isinstance(audience, list) else {str(audience or "")}
    if (
        payload.get("iss") != expected_issuer
        or MCP_OAUTH_AUDIENCE not in audiences
        or payload.get("civilmcp_mcp") is not True
        or not str(payload.get("client_id") or "").strip()
    ):
        raise UnauthorizedToolCall("OAuth token is not issued for CivilMCP MCP v2")
    try:
        expiry = int(payload.get("exp") or 0)
    except (TypeError, ValueError) as exc:
        raise UnauthorizedToolCall("Invalid OAuth access token") from exc
    if expiry <= int(time.time()):
        raise UnauthorizedToolCall("OAuth access token has expired")

    request = urllib.request.Request(
        f"{expected_issuer}/user",
        headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_SERVICE_KEY},
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:  # noqa: S310
            verified = json.loads(response.read(200_000).decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403}:
            raise UnauthorizedToolCall("Invalid or revoked OAuth access token") from exc
        raise UpstreamToolCallError("OAuth verification is temporarily unavailable") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise UpstreamToolCallError("OAuth verification is temporarily unavailable") from exc
    owner_id = str(verified.get("id") or verified.get("sub") or "").strip() if isinstance(verified, dict) else ""
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", owner_id) or owner_id != str(payload.get("sub") or ""):
        raise UnauthorizedToolCall("OAuth token subject could not be verified")
    raw_permissions = payload.get("civilmcp_permissions")
    permissions = {str(value) for value in raw_permissions if isinstance(value, str)} if isinstance(raw_permissions, list) else set()
    return owner_id, permissions


def authenticate_mcp_request(request: Request, surface: str = "mcp") -> str:
    if not REQUIRE_TOOL_AUTH:
        return _set_mcp_principal("anonymous", {"evidence:read"})

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
                return _set_mcp_principal(caller, {"evidence:read"})
        legacy = MCP_SERVER_API_KEY.strip()
        if legacy and legacy.lower() not in PLACEHOLDER_MCP_KEYS and hmac.compare_digest(provided, legacy):
            return _set_mcp_principal("legacy", {"evidence:read"})
        if provided.startswith("cvmcp_"):
            try:
                rows = (
                    sb.table("civil_mcp_access_keys")
                    .select("key_id,owner_id")
                    .eq("token_hash", provided_hash)
                    .is_("revoked_at", "null")
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
                if rows and rows[0].get("owner_id"):
                    sb.table("civil_mcp_access_keys").update(
                        {"last_used_at": datetime.now(timezone.utc).isoformat()}
                    ).eq("key_id", rows[0]["key_id"]).execute()
                    return _set_mcp_principal(
                        f"user:{rows[0]['owner_id']}",
                        {"evidence:read", "private:read", "library:read", "library:write"},
                    )
            except Exception as exc:  # noqa: BLE001
                log_event(logging.WARNING, "personal_mcp_key_lookup_failed", error=type(exc).__name__)
        if bearer and bearer.count(".") == 2:
            owner_id, permissions = _validate_supabase_oauth_token(bearer)
            return _set_mcp_principal(f"user:{owner_id}", permissions)
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
    ("GET", "/.well-known/oauth-protected-resource"),
    ("GET", "/.well-known/oauth-protected-resource/v2/mcp"),
}


def require_mcp_permission(permission: str) -> None:
    if permission not in MCP_PERMISSION_CONTEXT.get():
        raise InsufficientPermissionToolCall(
            f"This tool requires {permission} permission",
            required=permission,
        )


def oauth_resource_metadata_url() -> str:
    parsed = urllib.parse.urlparse(MCP_PUBLIC_URL)
    return f"{parsed.scheme}://{parsed.netloc}/.well-known/oauth-protected-resource/v2/mcp"


def oauth_challenge(required: str = "openid email profile") -> str:
    if not MCP_OAUTH_ENABLED:
        return 'Bearer realm="CivilMCP", error="invalid_token"'
    return f'Bearer resource_metadata="{oauth_resource_metadata_url()}", scope="{required}"'


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
    if isinstance(exc, UnauthorizedToolCall):
        headers["WWW-Authenticate"] = oauth_challenge()
    if isinstance(exc, InsufficientPermissionToolCall):
        headers["WWW-Authenticate"] = (
            'Bearer error="insufficient_scope", scope="openid email profile", '
            f'resource_metadata="{oauth_resource_metadata_url()}", '
            f'error_description="CivilMCP permission {exc.required} is required"'
        )
    return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=headers)


def embed(text: str, dimensions: int | None = None) -> list[float]:
    global EMBEDDING_CIRCUIT_REASON, EMBEDDING_CIRCUIT_UNTIL
    with EMBEDDING_CIRCUIT_LOCK:
        if EMBEDDING_CIRCUIT_UNTIL > time.time():
            raise EmbeddingUnavailableToolCall(
                "Embedding service is temporarily unavailable",
                error_code=EMBEDDING_CIRCUIT_REASON or "embedding_unavailable",
            )
    try:
        kwargs: dict[str, Any] = {"model": EMBED_MODEL, "input": [text]}
        if dimensions is not None:
            kwargs["dimensions"] = dimensions
        embedding = oa.embeddings.create(**kwargs).data[0].embedding
        with EMBEDDING_CIRCUIT_LOCK:
            EMBEDDING_CIRCUIT_UNTIL = 0.0
            EMBEDDING_CIRCUIT_REASON = ""
        return embedding
    except RateLimitError as exc:
        body = getattr(exc, "body", None)
        error_code = body.get("code") if isinstance(body, dict) else None
        if not error_code and isinstance(body, dict) and isinstance(body.get("error"), dict):
            error_code = body["error"].get("code")
        error_type = body.get("type") if isinstance(body, dict) else None
        if error_code in {"insufficient_quota", "credit_balance_exhausted"} or error_type == "insufficient_quota":
            with EMBEDDING_CIRCUIT_LOCK:
                EMBEDDING_CIRCUIT_UNTIL = time.time() + EMBEDDING_CIRCUIT_SECONDS
                EMBEDDING_CIRCUIT_REASON = "embedding_quota_exhausted"
            raise EmbeddingUnavailableToolCall(
                "Embedding service quota is exhausted",
                error_code="embedding_quota_exhausted",
            ) from exc
        retry_after = None
        response = getattr(exc, "response", None)
        retry_header = response.headers.get("retry-after") if response is not None else None
        if retry_header:
            try:
                retry_after = float(retry_header)
            except (TypeError, ValueError):
                pass
        with EMBEDDING_CIRCUIT_LOCK:
            EMBEDDING_CIRCUIT_UNTIL = time.time() + max(5.0, min(retry_after or 15.0, 60.0))
            EMBEDDING_CIRCUIT_REASON = "rate_limited"
        raise RateLimitedToolCall("Embedding service rate limit exceeded", retry_after_seconds=retry_after) from exc
    except APITimeoutError as exc:
        with EMBEDDING_CIRCUIT_LOCK:
            EMBEDDING_CIRCUIT_UNTIL = time.time() + 15
            EMBEDDING_CIRCUIT_REASON = "upstream_timeout"
        raise UpstreamTimeoutToolCall("OpenAI embedding request timed out") from exc
    except APIError as exc:
        with EMBEDDING_CIRCUIT_LOCK:
            EMBEDDING_CIRCUIT_UNTIL = time.time() + 30
            EMBEDDING_CIRCUIT_REASON = "embedding_unavailable"
        raise UpstreamToolCallError(f"OpenAI embedding API error: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Unexpected OpenAI embedding failure: {exc}") from exc


LEXICAL_CONCEPTS: tuple[tuple[re.Pattern[str], tuple[str, ...]], ...] = (
    (re.compile(r"road|traffic|transport|crash|accident|collision|ถนน|จราจร|ขนส่ง|อุบัติเหตุ|ทางแยก", re.I),
     ("road", "traffic", "accident", "ถนน", "อุบัติเหตุ", "ทางแยก")),
    (re.compile(r"concrete|cement|reinforced|rebar|structur|คอนกรีต|ซีเมนต์|เสริมเหล็ก|โครงสร้าง", re.I),
     ("concrete", "structural", "reinforced", "คอนกรีต", "เสริมเหล็ก", "โครงสร้าง")),
    (re.compile(r"construction|project|delay|schedule|cost|ก่อสร้าง|โครงการ|ล่าช้า|ระยะเวลา|ต้นทุน", re.I),
     ("construction", "delay", "cost", "ก่อสร้าง", "ล่าช้า", "ต้นทุน")),
    (re.compile(r"flood|drainage|water|hydraulic|น้ำท่วม|ระบายน้ำ|อุทก|ชลศาสตร์", re.I),
     ("flood", "drainage", "water", "น้ำท่วม", "ระบายน้ำ", "ชลศาสตร์")),
    (re.compile(r"soil|foundation|geotechnical|ดิน|ฐานราก|ปฐพี", re.I),
     ("soil", "foundation", "geotechnical", "ดิน", "ฐานราก", "ปฐพี")),
)

LEXICAL_STOPWORDS = {
    "about", "across", "and", "answer", "evidence", "find", "from", "paper", "papers", "research", "study", "the", "with",
    "การ", "ค้น", "งาน", "จาก", "ด้วย", "ที่", "และ", "หรือ", "หลักฐาน", "เกี่ยวกับ", "พร้อม", "สรุป",
}


def lexical_search_query(query: str) -> str:
    terms: list[str] = []
    for pattern, expansions in LEXICAL_CONCEPTS:
        if pattern.search(query):
            terms.extend(expansions)
    terms.extend(re.findall(r"[A-Za-z0-9][A-Za-z0-9_-]{1,39}|[ก-๙]{2,40}", query.lower()))
    seen: set[str] = set()
    bounded: list[str] = []
    for term in terms:
        cleaned = term.strip().lower()
        if len(cleaned) < 2 or cleaned in seen or cleaned in LEXICAL_STOPWORDS:
            continue
        seen.add(cleaned)
        bounded.append(cleaned)
        if len(bounded) >= 8:
            break
    return " ".join(bounded) or query.strip()[:500]


def retrieval_meta(mode: str = "semantic", reason: str | None = None) -> dict[str, Any]:
    return {
        "retrieval_mode": mode,
        "degraded": mode != "semantic",
        "degraded_reason": reason,
    }


def run_lexical_rpc(
    rpc_name: str,
    params: dict[str, Any],
    semantic_error: ToolCallError,
) -> Any:
    reason = semantic_error.error_code
    try:
        result = sb.rpc(rpc_name, params).execute()
    except Exception as fallback_error:  # noqa: BLE001
        log_event(
            logging.ERROR,
            "lexical_retrieval_failed",
            rpc=rpc_name,
            semantic_error=reason,
            fallback_error=type(fallback_error).__name__,
        )
        raise semantic_error from fallback_error
    METRICS.record_retrieval_fallback(reason)
    log_event(logging.WARNING, "lexical_retrieval_fallback", rpc=rpc_name, reason=reason)
    return result


def embedding_circuit_status() -> dict[str, Any]:
    with EMBEDDING_CIRCUIT_LOCK:
        remaining = max(0.0, EMBEDDING_CIRCUIT_UNTIL - time.time())
        return {
            "open": remaining > 0,
            "reason": EMBEDDING_CIRCUIT_REASON if remaining > 0 else None,
            "retry_after_seconds": round(remaining, 2),
        }


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
    except ToolCallError:
        raise
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

    meta = retrieval_meta()
    try:
        query_embedding = embed(cleaned_query, dimensions=EMBEDDING_DIMENSIONS)
    except ToolCallError as semantic_error:
        rpc_result = run_lexical_rpc(
            "search_civil_sections_lexical_v2",
            {
                "search_query": lexical_search_query(cleaned_query),
                "match_count": safe_max_results,
                "filter_disc": disc,
                "filter_collection": coll,
            },
            semantic_error,
        )
        meta = retrieval_meta("lexical_fallback", semantic_error.error_code)
    else:
        try:
            rpc_result = sb.rpc(
                "match_civil_sections_v2",
                {
                    "query_embedding": query_embedding,
                    "match_count": safe_max_results,
                    "filter_disc": disc,
                    "filter_collection": coll,
                },
            ).execute()
        except ToolCallError:
            raise
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
                **meta,
                "result_count": 0,
                "results": [],
            },
            content_text="No relevant sections found in the v2 knowledge base.",
            meta={"result_count": 0, **meta},
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
            **meta,
            "result_count": len(results),
            "results": results,
        },
        content_text="\n\n---\n\n".join(text_blocks),
        meta={"result_count": len(results), **meta},
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

    meta = retrieval_meta()
    try:
        query_embedding = embed(cleaned_query, dimensions=EMBEDDING_DIMENSIONS)
    except ToolCallError as semantic_error:
        rpc_result = run_lexical_rpc(
            "search_civil_chunks_lexical_v2",
            {
                "search_query": lexical_search_query(cleaned_query),
                "match_count": safe_max_results,
                "filter_disc": disc,
                "filter_document_ids": doc_filter,
                "filter_section_ids": section_filter,
                "filter_collection": coll,
            },
            semantic_error,
        )
        meta = retrieval_meta("lexical_fallback", semantic_error.error_code)
    else:
        try:
            rpc_result = sb.rpc(
                "match_civil_chunks_v2",
                {
                    "query_embedding": query_embedding,
                    "match_count": safe_max_results,
                    "filter_disc": disc,
                    "filter_document_ids": doc_filter,
                    "filter_section_ids": section_filter,
                    "filter_collection": coll,
                },
            ).execute()
        except ToolCallError:
            raise
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
                **meta,
                "result_count": 0,
                "results": [],
            },
            content_text="No relevant chunks found in the v2 knowledge base.",
            meta={"result_count": 0, **meta},
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
            **meta,
            "result_count": len(results),
            "filters": {
                "document_ids": doc_filter or [],
                "section_ids": section_filter or [],
            },
            "results": results,
        },
        content_text="\n\n---\n\n".join(text_blocks),
        meta={"result_count": len(results), **meta},
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
    meta = retrieval_meta()
    fallback_semantic_error: ToolCallError | None = None
    try:
        query_embedding = embed(cleaned_query, dimensions=EMBEDDING_DIMENSIONS)
    except ToolCallError as semantic_error:
        fallback_semantic_error = semantic_error
        section_rpc = run_lexical_rpc(
            "search_civil_sections_lexical_v2",
            {
                "search_query": lexical_search_query(cleaned_query),
                "match_count": max(1, min(SECTION_TOP_K, 50)),
                "filter_disc": disc,
                "filter_collection": coll,
            },
            semantic_error,
        )
        meta = retrieval_meta("lexical_fallback", semantic_error.error_code)
        query_embedding = None
    else:
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
        except ToolCallError:
            raise
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
                **meta,
                "result_count": 0,
                "sections_considered": 0,
                "results": [],
            },
            content_text="No relevant content found in the v2 knowledge base.",
            meta={"result_count": 0, "sections_considered": 0, **meta},
        )

    section_ids = [str(row["id"]) for row in section_rows if row.get("id")]
    section_similarity = {
        str(row["id"]): round(float(row.get("similarity", 0.0)), 3)
        for row in section_rows
        if row.get("id")
    }

    if meta["degraded"]:
        chunk_rpc = run_lexical_rpc(
            "search_civil_chunks_lexical_v2",
            {
                "search_query": lexical_search_query(cleaned_query),
                "match_count": max(CHUNK_TOP_K, safe_max_results),
                "filter_disc": disc,
                "filter_document_ids": None,
                "filter_section_ids": section_ids,
                "filter_collection": coll,
            },
            fallback_semantic_error or EmbeddingUnavailableToolCall("Semantic retrieval is unavailable"),
        )
    else:
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
        except ToolCallError:
            raise
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
                **meta,
                "result_count": 0,
                "sections_considered": len(section_rows),
                "results": [],
            },
            content_text="Relevant sections were found, but no matching chunks were available.",
            meta={"result_count": 0, "sections_considered": len(section_rows), **meta},
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
            **meta,
            "result_count": len(results),
            "sections_considered": len(section_rows),
            "results": results,
        },
        content_text="\n\n---\n\n".join(text_blocks),
        meta={
            "result_count": len(results),
            "sections_considered": len(section_rows),
            "embedding_dimensions": EMBEDDING_DIMENSIONS,
            **meta,
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


def _search_source_catalog_impl(
    query: str,
    provider: str = "",
    discipline: str = "",
    max_results: int = 10,
) -> ToolExecutionResult:
    cleaned_query = re.sub(r"[^\w\s-]", " ", query, flags=re.UNICODE)
    cleaned_query = re.sub(r"\s+", " ", cleaned_query).strip()[:120]
    if len(cleaned_query) < 2:
        raise InputValidationError("query must contain at least 2 searchable characters")
    normalized_provider = normalize_source_provider(provider)
    normalized_discipline = normalize_discipline(discipline)
    safe_limit = max(1, min(int(max_results), 20))
    fields = (
        "id, provider, provider_record_id, collection, source_type, title_local, title_en, "
        "authors, keywords, canonical_url, journal_title, publisher, "
        "published_at, language, discipline, license, rights_status, access_level, evidence_status, document_id"
    )
    try:
        rpc_result = sb.rpc(
            "search_civil_source_catalog_public_v1",
            {
                "search_query": cleaned_query,
                "filter_provider": normalized_provider,
                "filter_discipline": normalized_discipline,
                "match_count": safe_limit,
                "match_offset": 0,
            },
        ).execute()
    except Exception as exc:  # noqa: BLE001
        error_code = str(getattr(exc, "code", "")).upper()
        error_message = str(exc).lower()
        rpc_missing = error_code in {"PGRST202", "42883"} or (
            "search_civil_source_catalog_public_v1" in error_message
            and any(marker in error_message for marker in ("could not find", "does not exist", "schema cache"))
        )
        if not rpc_missing:
            raise UpstreamToolCallError(f"Supabase source catalog search failed: {exc}") from exc

        # Temporary compatibility path for deployments that have not received
        # the additive search RPC. The database still performs the search and
        # returns at most 20 rows; no catalog-wide scan is loaded into MCP.
        search_filter = ",".join(
            f"{column}.ilike.%{cleaned_query}%"
            for column in (
                "title_local",
                "title_en",
                "journal_title",
                "publisher",
            )
        )
        try:
            catalog_query = (
                sb.table("civil_source_catalog")
                .select(fields)
                .neq("evidence_status", "removed")
                .or_(search_filter)
                .order("published_at", desc=True)
                .limit(safe_limit)
            )
            if normalized_provider:
                catalog_query = catalog_query.eq("provider", normalized_provider)
            if normalized_discipline:
                catalog_query = catalog_query.eq("discipline", normalized_discipline)
            rows = catalog_query.execute().data or []
        except Exception as fallback_exc:  # noqa: BLE001
            raise UpstreamToolCallError(
                f"Supabase source catalog compatibility search failed: {fallback_exc}"
            ) from fallback_exc
        log_event(logging.WARNING, "source_catalog_rpc_fallback", reason=error_code or "rpc_missing")
    else:
        rows = rpc_result.data or []

    public_fields = {field.strip() for field in fields.split(",")}

    results = [
        {
            **{key: value for key, value in row.items() if key in public_fields},
            "citable": row.get("evidence_status") == "indexed" and bool(row.get("document_id")),
        }
        for row in rows
        if isinstance(row, dict)
    ]
    lines = [
        (
            f"- [{row.get('provider')} · {row.get('evidence_status')}] "
            f"{row.get('title_en') or row.get('title_local') or row.get('provider_record_id')}"
            f"{' · ' + row['canonical_url'] if row.get('canonical_url') else ''}"
        )
        for row in results
    ]
    return ToolExecutionResult(
        tool="search_source_catalog",
        structured_content={
            "query": cleaned_query,
            "provider": normalized_provider or "",
            "discipline": normalized_discipline or "",
            "result_count": len(results),
            "results": results,
        },
        content_text=(
            "\n".join(lines)
            if lines
            else "No source catalog records matched. Metadata-only records are never used as citable evidence."
        ),
        meta={"result_count": len(results)},
    )


def _find_related_papers_impl(source: str, max_results: int = 6) -> ToolExecutionResult:
    cleaned_source = source.strip()[:320]
    if not cleaned_source:
        raise InputValidationError("source must not be empty")
    safe_limit = max(1, min(int(max_results), 12))
    fields = (
        "id, source, source_pdf, collection, source_type, parent_source_pdf, paper_code, "
        "page_start, page_end, proceeding_no, proceeding_year, discipline, section_count, chunk_count, indexed_at"
    )
    try:
        matches = (
            sb.table("civil_documents_v2")
            .select(fields)
            .eq("source", cleaned_source)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not matches:
            matches = (
                sb.table("civil_documents_v2")
                .select(fields)
                .eq("source_pdf", cleaned_source)
                .limit(1)
                .execute()
                .data
                or []
            )
        if not matches:
            return ToolExecutionResult(
                tool="find_related_papers",
                structured_content={"source": cleaned_source, "found": False, "related": []},
                content_text=f"No indexed paper found for source: {cleaned_source}",
                meta={"found": False, "related_count": 0},
            )
        document = matches[0]
        related = (
            sb.table("civil_documents_v2")
            .select(fields)
            .eq("discipline", document.get("discipline"))
            .neq("id", document.get("id"))
            .order("chunk_count", desc=True)
            .limit(safe_limit)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError(f"Supabase related-paper lookup failed: {exc}") from exc

    lines = [
        (
            f"- [{row.get('collection')} · {row.get('discipline')}] {row.get('source')} "
            f"({row.get('section_count', 0)} sections, {row.get('chunk_count', 0)} chunks)"
        )
        for row in related
    ]
    return ToolExecutionResult(
        tool="find_related_papers",
        structured_content={
            "source": cleaned_source,
            "found": True,
            "discipline": document.get("discipline"),
            "related_count": len(related),
            "related": related,
        },
        content_text="\n".join(lines) if lines else "No related indexed papers found.",
        meta={"found": True, "related_count": len(related)},
    )


def _list_source_providers_impl() -> ToolExecutionResult:
    try:
        rows: list[dict[str, Any]] = []
        page_size = 1000
        offset = 0
        while True:
            page_rows = (
                sb.table("civil_source_catalog")
                .select("provider, evidence_status, document_id")
                .neq("evidence_status", "removed")
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
        raise UpstreamToolCallError(f"Supabase source provider list failed: {exc}") from exc

    summary: dict[str, dict[str, int]] = {}
    for row in rows:
        provider = str(row.get("provider") or "unknown")
        item = summary.setdefault(
            provider,
            {"records": 0, "indexed": 0, "extracted": 0, "metadata_only": 0, "citable": 0},
        )
        item["records"] += 1
        status = str(row.get("evidence_status") or "")
        if status in item:
            item[status] += 1
        if status == "indexed" and row.get("document_id"):
            item["citable"] += 1
    providers = [{"provider": provider, **counts} for provider, counts in sorted(summary.items())]
    lines = [
        (
            f"- {item['provider']}: {item['records']} records, {item['citable']} citable, "
            f"{item['metadata_only']} metadata-only"
        )
        for item in providers
    ]
    return ToolExecutionResult(
        tool="list_source_providers",
        structured_content={"provider_count": len(providers), "records": len(rows), "providers": providers},
        content_text="Source providers:\n" + "\n".join(lines),
        meta={"provider_count": len(providers), "record_count": len(rows)},
    )


def _clean_discovery_query(value: str) -> str:
    cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()[:280]
    if len(cleaned) < 3:
        raise InputValidationError("query must contain at least 3 searchable characters")
    return cleaned


def _openalex_search_url(query: str) -> str:
    return "https://openalex.org/works?search=" + urllib.parse.quote(query)


def _openalex_json(path: str, params: dict[str, str]) -> dict[str, Any]:
    if not OPENALEX_API_KEY:
        raise UnauthorizedToolCall("OpenAlex API access is not configured; use the returned search URL")
    query = urllib.parse.urlencode({**params, "api_key": OPENALEX_API_KEY})
    request = urllib.request.Request(
        f"https://api.openalex.org{path}?{query}",
        headers={"User-Agent": "CivilMCP/1.0 (research discovery)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=OPENALEX_TIMEOUT_SECONDS) as response:  # noqa: S310
            payload = json.loads(response.read(1_000_000).decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise RateLimitedToolCall("OpenAlex is rate limited. Please retry later.", 60) from exc
        raise UpstreamToolCallError("OpenAlex discovery is temporarily unavailable") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise UpstreamToolCallError("OpenAlex discovery is temporarily unavailable") from exc
    return payload if isinstance(payload, dict) else {}


def _openalex_work(row: dict[str, Any], relation: str = "result") -> dict[str, Any] | None:
    work_id = str(row.get("id") or "").strip()
    title = re.sub(r"\s+", " ", str(row.get("display_name") or "")).strip()[:320]
    if not work_id or not title:
        return None
    doi = str(row.get("doi") or "").strip() or None
    topic = row.get("primary_topic")
    return {
        "id": work_id,
        "doi": doi,
        "title": title,
        "year": row.get("publication_year") if isinstance(row.get("publication_year"), int) else None,
        "cited_by_count": max(0, int(row.get("cited_by_count") or 0)),
        "topic": str(topic.get("display_name") or "")[:160] if isinstance(topic, dict) else None,
        "url": doi or work_id,
        "relation": relation,
        "citable": False,
        "evidence_status": "metadata_only",
    }


def _search_global_research_impl(query: str, max_results: int = 6) -> ToolExecutionResult:
    cleaned = _clean_discovery_query(query)
    safe_limit = max(1, min(int(max_results), 6))
    search_url = _openalex_search_url(cleaned)
    if not FEDERATED_DISCOVERY_ENABLED or not OPENALEX_API_KEY:
        status = "disabled" if not FEDERATED_DISCOVERY_ENABLED else "link_only"
        return ToolExecutionResult(
            tool="search_global_research",
            structured_content={"status": status, "query": cleaned, "search_url": search_url, "result_count": 0, "results": [], "citable": False},
            content_text=f"OpenAlex discovery is {status.replace('_', ' ')}. Continue at {search_url}. These records are not CivilMCP evidence.",
            meta={"result_count": 0, "citable": False},
        )
    payload = _openalex_json(
        "/works",
        {
            "search": cleaned,
            "per-page": str(safe_limit),
            "select": "id,doi,display_name,publication_year,cited_by_count,primary_topic",
        },
    )
    results = [work for row in payload.get("results", []) if isinstance(row, dict) if (work := _openalex_work(row))]
    lines = [f"- {work['title']} ({work['year'] or 'n.d.'}) · {work['url']}" for work in results]
    return ToolExecutionResult(
        tool="search_global_research",
        structured_content={"status": "connected", "query": cleaned, "search_url": search_url, "result_count": len(results), "results": results, "citable": False},
        content_text=("OpenAlex metadata only; do not cite as CivilMCP evidence.\n" + "\n".join(lines)).strip(),
        meta={"result_count": len(results), "citable": False},
    )


def _map_citation_network_impl(query: str) -> ToolExecutionResult:
    cleaned = _clean_discovery_query(query)
    search_url = _openalex_search_url(cleaned)
    if not FEDERATED_DISCOVERY_ENABLED or not OPENALEX_API_KEY:
        status = "disabled" if not FEDERATED_DISCOVERY_ENABLED else "link_only"
        return ToolExecutionResult(
            tool="map_citation_network",
            structured_content={"status": status, "query": cleaned, "search_url": search_url, "seed": None, "nodes": [], "citable": False},
            content_text=f"Citation metadata is {status.replace('_', ' ')}. Continue at {search_url}.",
            meta={"node_count": 0, "citable": False},
        )
    seed_payload = _openalex_json(
        "/works",
        {
            "search": cleaned,
            "per-page": "1",
            "select": "id,doi,display_name,publication_year,cited_by_count,primary_topic,referenced_works,related_works",
        },
    )
    seed_rows = seed_payload.get("results", [])
    seed_row = seed_rows[0] if isinstance(seed_rows, list) and seed_rows and isinstance(seed_rows[0], dict) else None
    seed = _openalex_work(seed_row, "seed") if seed_row else None
    if not seed or not seed_row:
        return ToolExecutionResult(
            tool="map_citation_network",
            structured_content={"status": "connected", "query": cleaned, "search_url": search_url, "seed": None, "nodes": [], "citable": False},
            content_text="No OpenAlex seed work matched. Metadata-only result; no CivilMCP evidence was used.",
            meta={"node_count": 0, "citable": False},
        )
    seed_id = seed["id"].removeprefix("https://openalex.org/")
    references = [str(value).removeprefix("https://openalex.org/") for value in seed_row.get("referenced_works", [])[:4]]
    related = [str(value).removeprefix("https://openalex.org/") for value in seed_row.get("related_works", [])[:4]]
    relation_ids = list(dict.fromkeys(references + related))
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="openalex-map") as executor:
        incoming_future = executor.submit(
            _openalex_json,
            "/works",
            {"filter": f"cites:{seed_id}", "sort": "-cited_by_count", "per-page": "4", "select": "id,doi,display_name,publication_year,cited_by_count,primary_topic"},
        )
        outward_future = executor.submit(
            _openalex_json,
            "/works",
            {"filter": "openalex:" + "|".join(relation_ids or [seed_id]), "per-page": str(max(1, len(relation_ids))), "select": "id,doi,display_name,publication_year,cited_by_count,primary_topic"},
        )
        incoming_payload = incoming_future.result()
        outward_payload = outward_future.result()
    nodes: list[dict[str, Any]] = []
    for row in incoming_payload.get("results", []):
        if isinstance(row, dict) and (node := _openalex_work(row, "cited_by")):
            nodes.append(node)
    reference_set = set(references)
    for row in outward_payload.get("results", []):
        if not isinstance(row, dict):
            continue
        relation = "cites" if str(row.get("id") or "").removeprefix("https://openalex.org/") in reference_set else "related"
        if node := _openalex_work(row, relation):
            nodes.append(node)
    nodes = nodes[:12]
    return ToolExecutionResult(
        tool="map_citation_network",
        structured_content={"status": "connected", "query": cleaned, "search_url": search_url, "seed": seed, "nodes": nodes, "citable": False},
        content_text=f"Mapped {len(nodes)} OpenAlex metadata relationships around {seed['title']}. These records are not CivilMCP evidence.",
        meta={"node_count": len(nodes), "citable": False},
    )


def _get_evidence_snapshot_impl(source: str) -> ToolExecutionResult:
    paper = _fetch_civil_paper_impl(source=source, include_sections=True, include_chunks=True, max_sections=40, max_chunks=24)
    if not paper.structured_content.get("found"):
        return ToolExecutionResult(
            tool="get_evidence_snapshot",
            structured_content={"source": source.strip(), "found": False, "fields": {}, "human_reviewed": False},
            content_text=paper.content_text,
            meta={"found": False},
        )
    categories = {
        "study_design": ("study design", "research design", "experimental", "case study", "แบบการวิจัย", "การทดลอง"),
        "sample_context": ("sample", "participants", "site", "พื้นที่ศึกษา", "กลุ่มตัวอย่าง", "กรณีศึกษา"),
        "method": ("method", "methodology", "model", "วิธีการ", "ระเบียบวิธี", "แบบจำลอง"),
        "reported_result": ("result", "finding", "พบว่า", "ผลการ", "สรุปผล"),
        "limitation": ("limitation", "constraint", "ข้อจำกัด", "ข้อเสนอแนะ"),
        "thai_applicability": ("thailand", "thai", "ประเทศไทย", "กรุงเทพ", "จังหวัด", "ประเทศไทย"),
    }
    fields: dict[str, list[dict[str, Any]]] = {name: [] for name in categories}
    chunks = paper.structured_content.get("chunks", [])
    for chunk in chunks if isinstance(chunks, list) else []:
        content = re.sub(r"\s+", " ", str(chunk.get("content") or "")).strip()
        lowered = content.lower()
        if not content:
            continue
        for field_name, keywords in categories.items():
            if len(fields[field_name]) >= 3 or not any(keyword in lowered for keyword in keywords):
                continue
            fields[field_name].append({
                "evidence_id": chunk.get("id"),
                "source": chunk.get("source"),
                "page_start": chunk.get("page_start"),
                "page_end": chunk.get("page_end"),
                "section_title": chunk.get("section_title"),
                "excerpt": content[:1200],
            })
    populated = sum(1 for value in fields.values() if value)
    return ToolExecutionResult(
        tool="get_evidence_snapshot",
        structured_content={
            "source": source.strip(),
            "found": True,
            "document": paper.structured_content.get("document"),
            "fields": fields,
            "field_coverage": populated,
            "field_total": len(fields),
            "human_reviewed": False,
            "review_state": "machine_organized_needs_human_review",
        },
        content_text=f"Evidence snapshot organized {populated}/{len(fields)} fields from exact-page chunks. Review every excerpt before using a claim.",
        meta={"found": True, "field_coverage": populated, "human_reviewed": False},
    )


def _personal_owner_id() -> str:
    caller = MCP_CALLER_CONTEXT.get()
    if not caller.startswith("user:") or len(caller) <= 5:
        raise UnauthorizedToolCall("This library tool requires a personal CivilMCP MCP key")
    return caller.removeprefix("user:")


def _list_library_items_impl(max_results: int = 50) -> ToolExecutionResult:
    owner_id = _personal_owner_id()
    safe_limit = max(1, min(int(max_results), 100))
    try:
        rows = (
            sb.table("civil_paper_workspace_items")
            .select("id,document_id,source,collection,paper_code,note,labels,created_at,updated_at")
            .eq("owner_id", owner_id)
            .order("updated_at", desc=True)
            .limit(safe_limit)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Private library is temporarily unavailable") from exc
    lines = [f"- {row.get('paper_code') or row.get('source')} · {row.get('note') or 'No note'}" for row in rows]
    return ToolExecutionResult(
        tool="list_library_items",
        structured_content={"item_count": len(rows), "items": rows},
        content_text="\n".join(lines) if lines else "The authenticated user's library is empty.",
        meta={"item_count": len(rows)},
    )


def _save_library_item_impl(source: str, note: str = "", labels: list[str] | None = None) -> ToolExecutionResult:
    owner_id = _personal_owner_id()
    cleaned_source = source.strip()[:320]
    if not cleaned_source:
        raise InputValidationError("source must not be empty")
    clean_note = re.sub(r"[\x00-\x1f]+", " ", note).strip()[:2000]
    clean_labels = list(dict.fromkeys(
        re.sub(r"[\x00-\x1f]+", " ", str(label)).strip()[:60]
        for label in (labels or [])
        if str(label).strip()
    ))[:20]
    try:
        documents = (
            sb.table("civil_documents_v2")
            .select("id,source,collection,paper_code")
            .eq("source", cleaned_source)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not documents:
            raise InputValidationError("source must identify an indexed CivilMCP paper")
        document = documents[0]
        item_id = hashlib.sha256(f"{owner_id}\n{cleaned_source}".encode("utf-8")).hexdigest()[:32]
        row = {
            "id": item_id,
            "owner_id": owner_id,
            "document_id": document.get("id"),
            "source": cleaned_source,
            "collection": document.get("collection") or "",
            "paper_code": document.get("paper_code"),
            "note": clean_note,
            "labels": clean_labels,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        saved = (
            sb.table("civil_paper_workspace_items")
            .upsert(row, on_conflict="owner_id,source")
            .execute()
            .data
            or [row]
        )[0]
    except InputValidationError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Library item could not be saved") from exc
    return ToolExecutionResult(
        tool="save_library_item",
        structured_content={"saved": True, "item": saved},
        content_text=f"Saved {document.get('paper_code') or cleaned_source} to the authenticated user's library.",
        meta={"saved": True},
    )


def _remove_library_item_impl(source: str) -> ToolExecutionResult:
    owner_id = _personal_owner_id()
    cleaned_source = source.strip()[:320]
    if not cleaned_source:
        raise InputValidationError("source must not be empty")
    try:
        sb.table("civil_paper_workspace_items").delete().eq("owner_id", owner_id).eq("source", cleaned_source).execute()
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Library item could not be removed") from exc
    return ToolExecutionResult(
        tool="remove_library_item",
        structured_content={"removed": True, "source": cleaned_source},
        content_text=f"Removed {cleaned_source} from the authenticated user's library.",
        meta={"removed": True},
    )


def _list_private_sources_impl(max_results: int = 50) -> ToolExecutionResult:
    owner_id = _personal_owner_id()
    safe_limit = max(1, min(int(max_results), 100))
    try:
        rows = (
            sb.table("civil_private_library_items")
            .select("item_id,source,title,authors,publication_year,doi,canonical_url,import_type,page_count,created_at,updated_at")
            .eq("owner_id", owner_id)
            .order("updated_at", desc=True)
            .limit(safe_limit)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Private project sources are temporarily unavailable") from exc
    return ToolExecutionResult(
        tool="list_private_sources",
        structured_content={"item_count": len(rows), "items": rows, "private": True},
        content_text="\n".join(f"- {row.get('title')} · {row.get('import_type')} · {row.get('page_count', 0)} pages" for row in rows) or "The authenticated user's private project library is empty.",
        meta={"item_count": len(rows), "private": True},
    )


def _fetch_private_source_pages_impl(source: str, start_page: int = 1, max_pages: int = 6) -> ToolExecutionResult:
    owner_id = _personal_owner_id()
    cleaned_source = source.strip()[:320]
    safe_start = max(1, int(start_page))
    safe_max = max(1, min(int(max_pages), 10))
    if not cleaned_source.startswith("private:"):
        raise InputValidationError("source must identify an authenticated private source")
    try:
        rows = (
            sb.table("civil_private_library_items")
            .select("item_id,source,title,authors,publication_year,doi,canonical_url,import_type,page_count,pages")
            .eq("owner_id", owner_id)
            .eq("source", cleaned_source)
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Private source is temporarily unavailable") from exc
    if not rows:
        return ToolExecutionResult(
            tool="fetch_private_source_pages",
            structured_content={"source": cleaned_source, "found": False, "pages": [], "private": True},
            content_text="No private source owned by this user matched.",
            meta={"found": False, "private": True},
        )
    row = rows[0]
    pages = [
        {"page": int(item.get("page")), "text": re.sub(r"\s+", " ", str(item.get("text") or "")).strip()[:20_000]}
        for item in (row.get("pages") or [])
        if isinstance(item, dict) and str(item.get("page", "")).isdigit() and safe_start <= int(item["page"]) < safe_start + safe_max
    ]
    total = 0
    bounded_pages: list[dict[str, Any]] = []
    for page in pages:
        remaining = 30_000 - total
        if remaining <= 0:
            break
        page["text"] = page["text"][:remaining]
        total += len(page["text"])
        bounded_pages.append(page)
    metadata = {key: value for key, value in row.items() if key != "pages"}
    return ToolExecutionResult(
        tool="fetch_private_source_pages",
        structured_content={"source": cleaned_source, "found": True, "document": metadata, "pages": bounded_pages, "private": True},
        content_text="\n\n".join(f"[private · p.{page['page']}]\n{page['text']}" for page in bounded_pages) or "This private citation record has no extracted PDF pages.",
        meta={"found": True, "page_count": len(bounded_pages), "private": True},
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


def _bounded_string_list(value: Any, name: str, minimum: int, maximum: int, max_length: int = 320) -> list[str]:
    if not isinstance(value, list):
        raise InputValidationError(f"{name} must be a list")
    cleaned = list(dict.fromkeys(
        re.sub(r"[\x00-\x1f]+", " ", str(item)).strip()[:max_length]
        for item in value
        if str(item).strip()
    ))
    if not minimum <= len(cleaned) <= maximum:
        raise InputValidationError(f"{name} must contain between {minimum} and {maximum} values")
    return cleaned


def _discover_research_v2_impl(
    question: str,
    keywords: Any = None,
    difficulty: int = 5,
    discipline: str = "",
    collection: str = "",
    include_global: bool = True,
) -> ToolExecutionResult:
    require_mcp_permission("evidence:read")
    cleaned_question = re.sub(r"[\x00-\x1f]+", " ", question).strip()[:500]
    if len(cleaned_question) < 3:
        raise InputValidationError("question must contain at least 3 characters")
    clean_keywords = _bounded_string_list(keywords or [], "keywords", 0, 6, 80)
    safe_difficulty = max(1, min(int(difficulty), 10))
    query = " ".join([cleaned_question, *clean_keywords]).strip()
    result_limit = max(5, min(15, safe_difficulty + 4))

    evidence = _search_civil_knowledge_impl(
        query=query,
        discipline=discipline,
        collection=collection,
        max_results=min(result_limit, CONTEXT_MAX_CHUNKS),
    )
    grouped: dict[str, dict[str, Any]] = {}
    for packet in evidence.structured_content.get("results", []):
        if not isinstance(packet, dict):
            continue
        source = str(packet.get("source") or "").strip()
        if not source:
            continue
        paper = grouped.setdefault(source, {
            "kind": "page_cited_evidence",
            "source": source,
            "paper_code": packet.get("paper_code"),
            "collection": packet.get("collection"),
            "discipline": packet.get("discipline"),
            "citable": True,
            "evidence_status": "indexed",
            "evidence": [],
            "score": packet.get("similarity"),
        })
        if len(paper["evidence"]) < 3:
            paper["evidence"].append({
                "evidence_id": packet.get("id"),
                "section_title": packet.get("section_title"),
                "page_start": packet.get("page_start"),
                "page_end": packet.get("page_end"),
                "excerpt": re.sub(r"\s+", " ", str(packet.get("content") or "")).strip()[:1200],
            })

    catalog = _search_source_catalog_impl(
        query=query,
        discipline=discipline,
        max_results=result_limit,
    )
    catalog_results = [
        {"kind": "thai_metadata", **row}
        for row in catalog.structured_content.get("results", [])
        if isinstance(row, dict) and not row.get("citable")
    ][:result_limit]

    global_result: dict[str, Any] = {
        "status": "disabled",
        "search_url": _openalex_search_url(query),
        "results": [],
        "citable": False,
    }
    if include_global:
        try:
            global_tool = _search_global_research_impl(query=query, max_results=min(6, result_limit))
            global_result = dict(global_tool.structured_content)
            global_result["results"] = [
                {"kind": "global_metadata", **row}
                for row in global_result.get("results", [])
                if isinstance(row, dict)
            ]
        except RateLimitedToolCall:
            global_result.update({"status": "rate_limited"})
        except UpstreamToolCallError:
            global_result.update({"status": "unavailable"})

    evidence_papers = list(grouped.values())[:result_limit]
    content_lines = [
        f"- [citable · {paper.get('collection')}] {paper['source']} · {len(paper['evidence'])} exact-page packets"
        for paper in evidence_papers
    ]
    content_lines.extend(
        f"- [metadata only · {row.get('provider')}] {row.get('title_en') or row.get('title_local') or row.get('provider_record_id')}"
        for row in catalog_results[:6]
    )
    return ToolExecutionResult(
        tool="discover_research",
        structured_content={
            "question": cleaned_question,
            "keywords": clean_keywords,
            "difficulty": safe_difficulty,
            "trust_boundary": {
                "page_cited_evidence": "May support claims with the returned exact pages.",
                "thai_metadata": "Discovery only; do not cite as CivilMCP evidence.",
                "global_metadata": "OpenAlex discovery only; do not cite as CivilMCP evidence.",
            },
            "evidence": evidence_papers,
            "thai_metadata": catalog_results,
            "global": global_result,
            "counts": {
                "evidence_papers": len(evidence_papers),
                "thai_metadata": len(catalog_results),
                "global_metadata": len(global_result.get("results", [])),
            },
            "retrieval_mode": evidence.structured_content.get("retrieval_mode", "semantic"),
            "degraded": bool(evidence.structured_content.get("degraded")),
        },
        content_text="\n".join(content_lines) or "No matching research was found.",
        meta={
            "evidence_papers": len(evidence_papers),
            "thai_metadata": len(catalog_results),
            "global_status": global_result.get("status"),
        },
    )


def _get_paper_v2_impl(source: str, max_pages: int = 8) -> ToolExecutionResult:
    require_mcp_permission("evidence:read")
    cleaned = source.strip()[:320]
    if not cleaned:
        raise InputValidationError("source must not be empty")
    safe_pages = max(1, min(int(max_pages), 20))
    if cleaned.startswith("private:"):
        require_mcp_permission("private:read")
        private = _fetch_private_source_pages_impl(source=cleaned, start_page=1, max_pages=min(safe_pages, 10))
        private.tool = "get_paper"
        private.structured_content.update({"citable": True, "shareable": False, "provenance": "account_private_pdf"})
        return private

    paper = _fetch_civil_paper_impl(
        source=cleaned,
        include_sections=True,
        include_chunks=True,
        max_sections=80,
        max_chunks=min(80, safe_pages * 4),
    )
    paper.tool = "get_paper"
    paper.structured_content.update({
        "citable": bool(paper.structured_content.get("found")),
        "shareable": bool(paper.structured_content.get("found")),
        "provenance": "civilmcp_page_linked_evidence",
    })
    return paper


def _private_query_packets(source: str, queries: list[str], max_pages: int = 6) -> list[dict[str, Any]]:
    require_mcp_permission("private:read")
    owner_id = _personal_owner_id()
    try:
        rows = (
            sb.table("civil_private_library_items")
            .select("source,title,page_count,pages")
            .eq("owner_id", owner_id)
            .eq("source", source)
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Private source is temporarily unavailable") from exc
    if not rows:
        return []
    terms = {
        term.lower()
        for query in queries
        for term in re.findall(r"[\w\u0E00-\u0E7F-]{2,}", query, flags=re.UNICODE)
    }
    ranked: list[tuple[int, int, str]] = []
    for page in rows[0].get("pages") or []:
        if not isinstance(page, dict) or not str(page.get("page", "")).isdigit():
            continue
        text = re.sub(r"\s+", " ", str(page.get("text") or "")).strip()
        lowered = text.lower()
        score = sum(lowered.count(term) for term in terms)
        if text and score:
            ranked.append((score, int(page["page"]), text))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [
        {
            "evidence_id": f"{source}:page:{page}",
            "source": source,
            "page_start": page,
            "page_end": page,
            "excerpt": text[:5000],
            "citable": True,
            "private": True,
            "shareable": False,
            "lexical_score": score,
        }
        for score, page, text in ranked[:max_pages]
    ]


def _query_papers_v2_impl(sources: Any, queries: Any, max_evidence: int = 20) -> ToolExecutionResult:
    require_mcp_permission("evidence:read")
    clean_sources = _bounded_string_list(sources, "sources", 1, 10)
    clean_queries = _bounded_string_list(queries, "queries", 1, 6, 240)
    safe_max = max(1, min(int(max_evidence), 30))
    public_sources = [source for source in clean_sources if not source.startswith("private:")]
    private_sources = [source for source in clean_sources if source.startswith("private:")]
    packets: list[dict[str, Any]] = []
    unmatched = set(public_sources)

    if public_sources:
        try:
            rows = (
                sb.table("civil_documents_v2")
                .select("id,source,source_pdf,collection,paper_code,discipline")
                .in_("source", public_sources)
                .execute()
                .data
                or []
            )
            missing_aliases = [source for source in public_sources if source not in {row.get("source") for row in rows}]
            if missing_aliases:
                rows.extend(
                    sb.table("civil_documents_v2")
                    .select("id,source,source_pdf,collection,paper_code,discipline")
                    .in_("source_pdf", missing_aliases)
                    .execute()
                    .data
                    or []
                )
        except Exception as exc:  # noqa: BLE001
            raise UpstreamToolCallError("Selected papers could not be resolved") from exc
        document_ids = list(dict.fromkeys(str(row["id"]) for row in rows if row.get("id")))
        for row in rows:
            unmatched.discard(str(row.get("source") or ""))
            unmatched.discard(str(row.get("source_pdf") or ""))
        if document_ids:
            result = _search_civil_chunks_impl(
                query="; ".join(clean_queries),
                document_ids=document_ids,
                max_results=safe_max,
            )
            for packet in result.structured_content.get("results", []):
                if isinstance(packet, dict):
                    packets.append({
                        "evidence_id": packet.get("id"),
                        "source": packet.get("source"),
                        "paper_code": packet.get("paper_code"),
                        "collection": packet.get("collection"),
                        "discipline": packet.get("discipline"),
                        "section_title": packet.get("section_title"),
                        "page_start": packet.get("page_start"),
                        "page_end": packet.get("page_end"),
                        "excerpt": re.sub(r"\s+", " ", str(packet.get("content") or "")).strip()[:5000],
                        "score": packet.get("similarity"),
                        "citable": True,
                        "private": False,
                        "shareable": True,
                    })

    for source in private_sources:
        private_packets = _private_query_packets(source, clean_queries, max_pages=min(6, safe_max))
        if not private_packets:
            unmatched.add(source)
        packets.extend(private_packets)

    packets = packets[:safe_max]
    lines = [
        f"[E{index}] {packet['source']} · p.{packet['page_start']}{'' if packet['page_start'] == packet['page_end'] else '-' + str(packet['page_end'])}\n{packet['excerpt']}"
        for index, packet in enumerate(packets, start=1)
    ]
    return ToolExecutionResult(
        tool="query_papers",
        structured_content={
            "sources": clean_sources,
            "queries": clean_queries,
            "evidence_count": len(packets),
            "evidence": packets,
            "unmatched_sources": sorted(unmatched),
            "citation_policy": "Use only returned page packets for claims. Private packets must not be shared publicly.",
        },
        content_text="\n\n".join(lines) if lines else "No page-linked evidence matched the selected papers and queries.",
        meta={"evidence_count": len(packets), "unmatched_count": len(unmatched)},
    )


def _compare_papers_v2_impl(sources: Any) -> ToolExecutionResult:
    require_mcp_permission("evidence:read")
    clean_sources = _bounded_string_list(sources, "sources", 2, 4)
    comparisons: list[dict[str, Any]] = []
    for source in clean_sources:
        if source.startswith("private:"):
            comparisons.append({"source": source, "found": False, "reason": "Private PDFs require query_papers."})
            continue
        snapshot = _get_evidence_snapshot_impl(source)
        comparisons.append({
            "source": source,
            "found": bool(snapshot.structured_content.get("found")),
            "document": snapshot.structured_content.get("document"),
            "fields": snapshot.structured_content.get("fields", {}),
            "field_coverage": snapshot.structured_content.get("field_coverage", 0),
            "human_reviewed": False,
        })
    return ToolExecutionResult(
        tool="compare_papers",
        structured_content={
            "sources": clean_sources,
            "papers": comparisons,
            "review_state": "machine_organized_needs_human_review",
            "citable": True,
        },
        content_text=(
            f"Built an exact-page evidence matrix for {sum(1 for row in comparisons if row['found'])}/{len(comparisons)} papers. "
            "Review each excerpt before using a comparative claim."
        ),
        meta={"paper_count": len(comparisons), "human_reviewed": False},
    )


def _folder_id(value: str, field_name: str = "folder_id", allow_empty: bool = False) -> str | None:
    cleaned = value.strip()
    if not cleaned and allow_empty:
        return None
    try:
        return str(uuid.UUID(cleaned))
    except ValueError as exc:
        raise InputValidationError(f"{field_name} must be a valid folder id") from exc


def _owned_folder(owner_id: str, folder_id: str) -> dict[str, Any]:
    try:
        rows = (
            sb.table("civil_mcp_library_folders")
            .select("folder_id,owner_id,name,parent_folder_id,created_at,updated_at")
            .eq("owner_id", owner_id)
            .eq("folder_id", folder_id)
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Library folders are temporarily unavailable") from exc
    if not rows:
        raise InputValidationError("folder was not found in this user's library")
    return rows[0]


def _list_library_v2_impl(max_results: int = 100) -> ToolExecutionResult:
    require_mcp_permission("library:read")
    owner_id = _personal_owner_id()
    safe_limit = max(1, min(int(max_results), 100))
    try:
        folders = (
            sb.table("civil_mcp_library_folders")
            .select("folder_id,name,parent_folder_id,created_at,updated_at")
            .eq("owner_id", owner_id)
            .order("updated_at", desc=True)
            .limit(100)
            .execute()
            .data
            or []
        )
        items = (
            sb.table("civil_paper_workspace_items")
            .select("id,document_id,source,collection,paper_code,note,labels,folder_ids,created_at,updated_at")
            .eq("owner_id", owner_id)
            .order("updated_at", desc=True)
            .limit(safe_limit)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Private library is temporarily unavailable") from exc
    counts = {
        str(folder["folder_id"]): sum(str(folder["folder_id"]) in {str(value) for value in item.get("folder_ids") or []} for item in items)
        for folder in folders
    }
    folder_rows = [{**folder, "paper_count": counts.get(str(folder["folder_id"]), 0)} for folder in folders]
    return ToolExecutionResult(
        tool="list_library",
        structured_content={"folders": folder_rows, "items": items, "folder_count": len(folders), "item_count": len(items)},
        content_text=f"Library contains {len(items)} papers in {len(folders)} folders.",
        meta={"folder_count": len(folders), "item_count": len(items)},
    )


def _clean_folder_name(name: str) -> str:
    cleaned = re.sub(r"[\x00-\x1f]+", " ", name).strip()[:100]
    if not cleaned:
        raise InputValidationError("folder name must not be empty")
    return cleaned


def _create_library_folder_v2_impl(name: str, parent_folder_id: str = "") -> ToolExecutionResult:
    require_mcp_permission("library:write")
    owner_id = _personal_owner_id()
    parent_id = _folder_id(parent_folder_id, "parent_folder_id", allow_empty=True)
    if parent_id:
        _owned_folder(owner_id, parent_id)
    row = {
        "folder_id": str(uuid.uuid4()),
        "owner_id": owner_id,
        "name": _clean_folder_name(name),
        "parent_folder_id": parent_id,
    }
    try:
        created = sb.table("civil_mcp_library_folders").insert(row).execute().data or [row]
    except Exception as exc:  # noqa: BLE001
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise InputValidationError("a folder with this name already exists here") from exc
        raise UpstreamToolCallError("Library folder could not be created") from exc
    return ToolExecutionResult(
        tool="create_library_folder",
        structured_content={"created": True, "folder": created[0]},
        content_text=f"Created library folder {row['name']}.",
        meta={"created": True},
    )


def _rename_library_folder_v2_impl(folder_id: str, name: str) -> ToolExecutionResult:
    require_mcp_permission("library:write")
    owner_id = _personal_owner_id()
    clean_id = _folder_id(folder_id) or ""
    _owned_folder(owner_id, clean_id)
    try:
        rows = (
            sb.table("civil_mcp_library_folders")
            .update({"name": _clean_folder_name(name), "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("owner_id", owner_id)
            .eq("folder_id", clean_id)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise InputValidationError("a folder with this name already exists here") from exc
        raise UpstreamToolCallError("Library folder could not be renamed") from exc
    return ToolExecutionResult(
        tool="rename_library_folder",
        structured_content={"renamed": True, "folder": rows[0] if rows else {"folder_id": clean_id, "name": name}},
        content_text=f"Renamed library folder to {_clean_folder_name(name)}.",
        meta={"renamed": True},
    )


def _delete_library_folder_v2_impl(folder_id: str) -> ToolExecutionResult:
    require_mcp_permission("library:write")
    owner_id = _personal_owner_id()
    clean_id = _folder_id(folder_id) or ""
    folder = _owned_folder(owner_id, clean_id)
    try:
        response = sb.rpc("civil_mcp_delete_library_folder", {"p_owner_id": owner_id, "p_folder_id": clean_id}).execute()
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Library folder could not be deleted") from exc
    deleted = bool(response.data)
    return ToolExecutionResult(
        tool="delete_library_folder",
        structured_content={"deleted": deleted, "folder_id": clean_id, "papers_preserved": True},
        content_text=f"Deleted {folder.get('name')}; saved papers remain in the library.",
        meta={"deleted": deleted},
    )


def _save_papers_v2_impl(sources: Any, folder_id: str = "", note: str = "") -> ToolExecutionResult:
    require_mcp_permission("library:write")
    owner_id = _personal_owner_id()
    clean_sources = _bounded_string_list(sources, "sources", 1, 50)
    clean_folder_id = _folder_id(folder_id, allow_empty=True)
    if clean_folder_id:
        _owned_folder(owner_id, clean_folder_id)
    try:
        documents = (
            sb.table("civil_documents_v2")
            .select("id,source,source_pdf,collection,paper_code")
            .in_("source", clean_sources)
            .execute()
            .data
            or []
        )
        aliases = [source for source in clean_sources if source not in {str(row.get("source")) for row in documents}]
        if aliases:
            documents.extend(
                sb.table("civil_documents_v2")
                .select("id,source,source_pdf,collection,paper_code")
                .in_("source_pdf", aliases)
                .execute()
                .data
                or []
            )
        documents = list({str(row.get("source")): row for row in documents if row.get("source")}.values())
        canonical_sources = [str(row.get("source")) for row in documents if row.get("source")]
        existing = (
            sb.table("civil_paper_workspace_items")
            .select("source,note,labels,folder_ids")
            .eq("owner_id", owner_id)
            .in_("source", canonical_sources)
            .execute()
            .data
            or []
        ) if canonical_sources else []
        existing_by_source = {str(row.get("source")): row for row in existing}
        clean_note = re.sub(r"[\x00-\x1f]+", " ", note).strip()[:2000]
        rows = []
        for document in documents:
            source = str(document.get("source"))
            previous = existing_by_source.get(source, {})
            folders = [str(value) for value in previous.get("folder_ids") or []]
            if clean_folder_id and clean_folder_id not in folders:
                folders.append(clean_folder_id)
            rows.append({
                "id": hashlib.sha256(f"{owner_id}\n{source}".encode("utf-8")).hexdigest()[:32],
                "owner_id": owner_id,
                "document_id": document.get("id"),
                "source": source,
                "collection": document.get("collection") or "",
                "paper_code": document.get("paper_code"),
                "note": clean_note or previous.get("note") or "",
                "labels": previous.get("labels") or [],
                "folder_ids": folders,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        if rows:
            sb.table("civil_paper_workspace_items").upsert(rows, on_conflict="owner_id,source").execute()
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Papers could not be saved") from exc
    resolved = {str(row.get("source")) for row in documents} | {str(row.get("source_pdf")) for row in documents}
    missing = [source for source in clean_sources if source not in resolved]
    return ToolExecutionResult(
        tool="save_papers",
        structured_content={"saved_count": len(rows), "missing": missing, "folder_id": clean_folder_id, "papers": rows},
        content_text=f"Saved {len(rows)} paper(s)." + (f" {len(missing)} source(s) were not indexed." if missing else ""),
        meta={"saved_count": len(rows), "missing_count": len(missing)},
    )


def _move_papers_v2_impl(sources: Any, to_folder_id: str, from_folder_id: str = "") -> ToolExecutionResult:
    require_mcp_permission("library:write")
    owner_id = _personal_owner_id()
    clean_sources = _bounded_string_list(sources, "sources", 1, 50)
    to_id = _folder_id(to_folder_id, "to_folder_id") or ""
    from_id = _folder_id(from_folder_id, "from_folder_id", allow_empty=True)
    _owned_folder(owner_id, to_id)
    if from_id:
        _owned_folder(owner_id, from_id)
    try:
        response = sb.rpc("civil_mcp_move_library_papers", {
            "p_owner_id": owner_id,
            "p_sources": clean_sources,
            "p_to_folder_id": to_id,
            "p_from_folder_id": from_id,
        }).execute()
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Papers could not be moved") from exc
    moved = int(response.data or 0)
    return ToolExecutionResult(
        tool="move_papers",
        structured_content={"moved_count": moved, "to_folder_id": to_id, "from_folder_id": from_id},
        content_text=f"Moved {moved} paper(s) to the destination folder.",
        meta={"moved_count": moved},
    )


def _remove_papers_v2_impl(sources: Any, folder_id: str = "") -> ToolExecutionResult:
    require_mcp_permission("library:write")
    owner_id = _personal_owner_id()
    clean_sources = _bounded_string_list(sources, "sources", 1, 50)
    clean_folder_id = _folder_id(folder_id, allow_empty=True)
    try:
        if clean_folder_id:
            _owned_folder(owner_id, clean_folder_id)
            response = sb.rpc("civil_mcp_move_library_papers", {
                "p_owner_id": owner_id,
                "p_sources": clean_sources,
                "p_to_folder_id": None,
                "p_from_folder_id": clean_folder_id,
            }).execute()
            removed = int(response.data or 0)
            removed_from = "folder"
        else:
            existing = (
                sb.table("civil_paper_workspace_items")
                .select("source")
                .eq("owner_id", owner_id)
                .in_("source", clean_sources)
                .execute()
                .data
                or []
            )
            sb.table("civil_paper_workspace_items").delete().eq("owner_id", owner_id).in_("source", clean_sources).execute()
            removed = len(existing)
            removed_from = "library"
    except ToolCallError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise UpstreamToolCallError("Papers could not be removed") from exc
    return ToolExecutionResult(
        tool="remove_papers",
        structured_content={"removed_count": removed, "removed_from": removed_from, "folder_id": clean_folder_id},
        content_text=f"Removed {removed} paper(s) from the {removed_from}.",
        meta={"removed_count": removed, "removed_from": removed_from},
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
    if name == "search_source_catalog":
        return _search_source_catalog_impl(
            query=str(arguments.get("query", "")),
            provider=str(arguments.get("provider", "")),
            discipline=str(arguments.get("discipline", "")),
            max_results=int(arguments.get("max_results", 10)),
        )
    if name == "find_related_papers":
        return _find_related_papers_impl(
            source=str(arguments.get("source", "")),
            max_results=int(arguments.get("max_results", 6)),
        )
    if name == "list_source_providers":
        return _list_source_providers_impl()
    if name == "search_global_research":
        return _search_global_research_impl(
            query=str(arguments.get("query", "")),
            max_results=int(arguments.get("max_results", 6)),
        )
    if name == "map_citation_network":
        return _map_citation_network_impl(query=str(arguments.get("query", "")))
    if name == "get_evidence_snapshot":
        return _get_evidence_snapshot_impl(source=str(arguments.get("source", "")))
    if name == "list_library_items":
        return _list_library_items_impl(max_results=int(arguments.get("max_results", 50)))
    if name == "save_library_item":
        raw_labels = arguments.get("labels")
        return _save_library_item_impl(
            source=str(arguments.get("source", "")),
            note=str(arguments.get("note", "")),
            labels=raw_labels if isinstance(raw_labels, list) else [],
        )
    if name == "remove_library_item":
        return _remove_library_item_impl(source=str(arguments.get("source", "")))
    if name == "list_private_sources":
        return _list_private_sources_impl(max_results=int(arguments.get("max_results", 50)))
    if name == "fetch_private_source_pages":
        return _fetch_private_source_pages_impl(
            source=str(arguments.get("source", "")),
            start_page=int(arguments.get("start_page", 1)),
            max_pages=int(arguments.get("max_pages", 6)),
        )
    raise InputValidationError(f"Unknown tool: {name}")


def _dispatch_public_v2_tool(name: str, arguments: dict[str, Any]) -> ToolExecutionResult:
    if name == "discover_research":
        return _discover_research_v2_impl(
            question=str(arguments.get("question", "")),
            keywords=arguments.get("keywords"),
            difficulty=int(arguments.get("difficulty", 5)),
            discipline=str(arguments.get("discipline", "")),
            collection=str(arguments.get("collection", "")),
            include_global=normalize_bool(arguments.get("include_global"), default=True),
        )
    if name == "get_paper":
        return _get_paper_v2_impl(
            source=str(arguments.get("source", "")),
            max_pages=int(arguments.get("max_pages", 8)),
        )
    if name == "query_papers":
        return _query_papers_v2_impl(
            sources=arguments.get("sources"),
            queries=arguments.get("queries"),
            max_evidence=int(arguments.get("max_evidence", 20)),
        )
    if name == "compare_papers":
        return _compare_papers_v2_impl(arguments.get("sources"))
    if name == "map_citation_network":
        require_mcp_permission("evidence:read")
        result = _map_citation_network_impl(query=str(arguments.get("query", "")))
        result.tool = name
        return result
    if name == "get_evidence_snapshot":
        require_mcp_permission("evidence:read")
        result = _get_evidence_snapshot_impl(source=str(arguments.get("source", "")))
        result.tool = name
        return result
    if name == "list_library":
        return _list_library_v2_impl(max_results=int(arguments.get("max_results", 100)))
    if name == "create_library_folder":
        return _create_library_folder_v2_impl(
            name=str(arguments.get("name", "")),
            parent_folder_id=str(arguments.get("parent_folder_id", "")),
        )
    if name == "rename_library_folder":
        return _rename_library_folder_v2_impl(
            folder_id=str(arguments.get("folder_id", "")),
            name=str(arguments.get("name", "")),
        )
    if name == "delete_library_folder":
        return _delete_library_folder_v2_impl(folder_id=str(arguments.get("folder_id", "")))
    if name == "save_papers":
        return _save_papers_v2_impl(
            sources=arguments.get("sources"),
            folder_id=str(arguments.get("folder_id", "")),
            note=str(arguments.get("note", "")),
        )
    if name == "move_papers":
        return _move_papers_v2_impl(
            sources=arguments.get("sources"),
            to_folder_id=str(arguments.get("to_folder_id", "")),
            from_folder_id=str(arguments.get("from_folder_id", "")),
        )
    if name == "remove_papers":
        return _remove_papers_v2_impl(
            sources=arguments.get("sources"),
            folder_id=str(arguments.get("folder_id", "")),
        )
    if name == "list_private_sources":
        require_mcp_permission("private:read")
        result = _list_private_sources_impl(max_results=int(arguments.get("max_results", 50)))
        result.tool = name
        return result
    raise InputValidationError(f"Unknown public v2 tool: {name}")


def _mcp_tool_decorator(annotations: dict[str, Any]):
    try:
        signature = inspect.signature(mcp.tool)
        if "annotations" in signature.parameters:
            return mcp.tool(annotations=annotations)
    except Exception:  # noqa: BLE001
        pass
    return mcp.tool()


def _mcp_v2_tool_decorator(name: str):
    detail = PUBLIC_V2_TOOL_DEFINITIONS[name]
    try:
        signature = inspect.signature(mcp_v2.tool)
        if "annotations" in signature.parameters:
            return mcp_v2.tool(
                name=name,
                description=detail["description"],
                annotations=detail["annotations"],
            )
    except Exception:  # noqa: BLE001
        pass
    return mcp_v2.tool(name=name, description=detail["description"])


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


def _execute_public_v2_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
    started = time.perf_counter()
    try:
        result = _dispatch_public_v2_tool(name, arguments)
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
    meta = dict(result.meta)
    meta.update({"tool": result.tool, "latency_ms": round(latency_ms, 2)})
    return CallToolResult(
        content=[TextContent(type="text", text=result.content_text)],
        structuredContent=result.structured_content,
        meta=meta,
    )


@_mcp_tool_decorator(TOOL_DEFINITIONS["search_civil_knowledge"]["annotations"])
def search_civil_knowledge(
    query: str,
    discipline: str = "",
    max_results: int = 5,
    collection: str = "",
) -> CallToolResult:
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


@_mcp_tool_decorator(TOOL_DEFINITIONS["search_source_catalog"]["annotations"])
def search_source_catalog(
    query: str,
    provider: str = "",
    discipline: str = "",
    max_results: int = 10,
) -> dict[str, Any]:
    return _execute_mcp_decorated_tool(
        "search_source_catalog",
        {
            "query": query,
            "provider": provider,
            "discipline": discipline,
            "max_results": max_results,
        },
    )


@_mcp_tool_decorator(TOOL_DEFINITIONS["find_related_papers"]["annotations"])
def find_related_papers(source: str, max_results: int = 6) -> dict[str, Any]:
    return _execute_mcp_decorated_tool(
        "find_related_papers",
        {"source": source, "max_results": max_results},
    )


@_mcp_tool_decorator(TOOL_DEFINITIONS["list_source_providers"]["annotations"])
def list_source_providers() -> dict[str, Any]:
    return _execute_mcp_decorated_tool("list_source_providers", {})


@_mcp_tool_decorator(TOOL_DEFINITIONS["search_global_research"]["annotations"])
def search_global_research(query: str, max_results: int = 6) -> dict[str, Any]:
    return _execute_mcp_decorated_tool("search_global_research", {"query": query, "max_results": max_results})


@_mcp_tool_decorator(TOOL_DEFINITIONS["map_citation_network"]["annotations"])
def map_citation_network(query: str) -> dict[str, Any]:
    return _execute_mcp_decorated_tool("map_citation_network", {"query": query})


@_mcp_tool_decorator(TOOL_DEFINITIONS["get_evidence_snapshot"]["annotations"])
def get_evidence_snapshot(source: str) -> dict[str, Any]:
    return _execute_mcp_decorated_tool("get_evidence_snapshot", {"source": source})


@_mcp_tool_decorator(TOOL_DEFINITIONS["list_library_items"]["annotations"])
def list_library_items(max_results: int = 50) -> dict[str, Any]:
    return _execute_mcp_decorated_tool("list_library_items", {"max_results": max_results})


@_mcp_tool_decorator(TOOL_DEFINITIONS["save_library_item"]["annotations"])
def save_library_item(source: str, note: str = "", labels: list[str] | None = None) -> dict[str, Any]:
    return _execute_mcp_decorated_tool(
        "save_library_item",
        {"source": source, "note": note, "labels": labels or []},
    )


@_mcp_tool_decorator(TOOL_DEFINITIONS["remove_library_item"]["annotations"])
def remove_library_item(source: str) -> dict[str, Any]:
    return _execute_mcp_decorated_tool("remove_library_item", {"source": source})


@_mcp_tool_decorator(TOOL_DEFINITIONS["list_private_sources"]["annotations"])
def list_private_sources(max_results: int = 50) -> dict[str, Any]:
    return _execute_mcp_decorated_tool("list_private_sources", {"max_results": max_results})


@_mcp_tool_decorator(TOOL_DEFINITIONS["fetch_private_source_pages"]["annotations"])
def fetch_private_source_pages(source: str, start_page: int = 1, max_pages: int = 6) -> dict[str, Any]:
    return _execute_mcp_decorated_tool(
        "fetch_private_source_pages",
        {"source": source, "start_page": start_page, "max_pages": max_pages},
    )


@_mcp_v2_tool_decorator("discover_research")
def discover_research(
    question: str,
    keywords: list[str] | None = None,
    difficulty: int = 5,
    discipline: str = "",
    collection: str = "",
    include_global: bool = True,
) -> CallToolResult:
    return _execute_public_v2_tool("discover_research", {
        "question": question,
        "keywords": keywords or [],
        "difficulty": difficulty,
        "discipline": discipline,
        "collection": collection,
        "include_global": include_global,
    })


@_mcp_v2_tool_decorator("get_paper")
def get_paper(source: str, max_pages: int = 8) -> CallToolResult:
    return _execute_public_v2_tool("get_paper", {"source": source, "max_pages": max_pages})


@_mcp_v2_tool_decorator("query_papers")
def query_papers(sources: list[str], queries: list[str], max_evidence: int = 20) -> CallToolResult:
    return _execute_public_v2_tool(
        "query_papers",
        {"sources": sources, "queries": queries, "max_evidence": max_evidence},
    )


@_mcp_v2_tool_decorator("compare_papers")
def compare_papers(sources: list[str]) -> CallToolResult:
    return _execute_public_v2_tool("compare_papers", {"sources": sources})


@_mcp_v2_tool_decorator("map_citation_network")
def public_map_citation_network(query: str) -> CallToolResult:
    return _execute_public_v2_tool("map_citation_network", {"query": query})


@_mcp_v2_tool_decorator("get_evidence_snapshot")
def public_get_evidence_snapshot(source: str) -> CallToolResult:
    return _execute_public_v2_tool("get_evidence_snapshot", {"source": source})


@_mcp_v2_tool_decorator("list_library")
def list_library(max_results: int = 100) -> CallToolResult:
    return _execute_public_v2_tool("list_library", {"max_results": max_results})


@_mcp_v2_tool_decorator("create_library_folder")
def create_library_folder(name: str, parent_folder_id: str = "") -> CallToolResult:
    return _execute_public_v2_tool(
        "create_library_folder",
        {"name": name, "parent_folder_id": parent_folder_id},
    )


@_mcp_v2_tool_decorator("rename_library_folder")
def rename_library_folder(folder_id: str, name: str) -> CallToolResult:
    return _execute_public_v2_tool("rename_library_folder", {"folder_id": folder_id, "name": name})


@_mcp_v2_tool_decorator("delete_library_folder")
def delete_library_folder(folder_id: str) -> CallToolResult:
    return _execute_public_v2_tool("delete_library_folder", {"folder_id": folder_id})


@_mcp_v2_tool_decorator("save_papers")
def save_papers(sources: list[str], folder_id: str = "", note: str = "") -> CallToolResult:
    return _execute_public_v2_tool(
        "save_papers",
        {"sources": sources, "folder_id": folder_id, "note": note},
    )


@_mcp_v2_tool_decorator("move_papers")
def move_papers(sources: list[str], to_folder_id: str, from_folder_id: str = "") -> CallToolResult:
    return _execute_public_v2_tool(
        "move_papers",
        {"sources": sources, "to_folder_id": to_folder_id, "from_folder_id": from_folder_id},
    )


@_mcp_v2_tool_decorator("remove_papers")
def remove_papers(sources: list[str], folder_id: str = "") -> CallToolResult:
    return _execute_public_v2_tool("remove_papers", {"sources": sources, "folder_id": folder_id})


@_mcp_v2_tool_decorator("list_private_sources")
def public_list_private_sources(max_results: int = 50) -> CallToolResult:
    return _execute_public_v2_tool("list_private_sources", {"max_results": max_results})


class ToolCallPayload(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


@asynccontextmanager
async def app_lifespan(_: FastAPI):
    async with AsyncExitStack() as stack:
        for server in (mcp, mcp_v2):
            manager = getattr(server, "session_manager", None)
            if manager is not None:
                await stack.enter_async_context(manager.run())
        yield


app = FastAPI(title="Civil Engineering MCP Server", lifespan=app_lifespan)


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
            MCP_CALLER_CONTEXT.set(caller)
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


@app.get("/.well-known/oauth-protected-resource")
@app.get("/.well-known/oauth-protected-resource/v2/mcp")
async def oauth_protected_resource() -> JSONResponse:
    if not MCP_OAUTH_ENABLED:
        return JSONResponse({"error": "oauth_not_enabled"}, status_code=404)
    return JSONResponse({
        "resource": MCP_PUBLIC_URL,
        "authorization_servers": [f"{SUPABASE_URL.rstrip('/')}/auth/v1"],
        "scopes_supported": ["openid", "email", "profile"],
        "bearer_methods_supported": ["header"],
        "resource_name": "CivilMCP Research API",
        "resource_documentation": MCP_DOCUMENTATION_URL,
    })


@app.get("/health/ready")
async def readiness() -> JSONResponse:
    def check_dependencies() -> dict[str, Any]:
        docs = sb.table("civil_documents_v2").select("id", count="exact").limit(1).execute()
        readiness_response = sb.rpc("civil_backbone_readiness").execute()
        readiness_data = readiness_response.data
        readiness_row = readiness_data[0] if isinstance(readiness_data, list) and readiness_data else readiness_data
        if not isinstance(readiness_row, dict) or not all(
            readiness_row.get(key) is True
            for key in ("quota_table", "quota_rpc", "retention_rpc", "lexical_section_rpc", "lexical_chunk_rpc")
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
                "retrieval": {
                    "semantic": not embedding_circuit_status()["open"],
                    "lexical_fallback": True,
                    "circuit": embedding_circuit_status(),
                },
                "auth_clients": len(MCP_CLIENT_KEYS) + (1 if MCP_SERVER_API_KEY.strip() else 0),
                "oauth_enabled": MCP_OAUTH_ENABLED,
                "public_mcp_v2": MCP_PUBLIC_URL,
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
                "public_mcp_v2": "/v2/mcp",
                "oauth_resource_metadata": "/.well-known/oauth-protected-resource/v2/mcp",
            },
        }
    )


@app.get("/metrics")
async def metrics() -> dict[str, Any]:
    return {**METRICS.snapshot(), "embedding_circuit": embedding_circuit_status()}


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
        MCP_CALLER_CONTEXT.set(caller)
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
        if isinstance(exc, UnauthorizedToolCall):
            headers["WWW-Authenticate"] = oauth_challenge()
        if isinstance(exc, InsufficientPermissionToolCall):
            headers["WWW-Authenticate"] = oauth_challenge()

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


# Mount the public high-level contract before the legacy root transport.
if hasattr(mcp_v2, "streamable_http_app"):
    app.mount("/v2", mcp_v2.streamable_http_app())
elif hasattr(mcp_v2, "get_asgi_app"):
    app.mount("/v2", mcp_v2.get_asgi_app())
elif hasattr(mcp_v2, "asgi_app"):
    app.mount("/v2", mcp_v2.asgi_app)
else:
    raise RuntimeError("Public MCP v2 requires a streamable HTTP compatible FastMCP SDK.")

# Mount legacy MCP ASGI app for existing CivilMCP Web and CityMCP consumers.
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
