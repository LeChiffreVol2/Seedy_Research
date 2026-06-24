from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
HARNESS_DIR = ROOT / "harness"
REPORTS_DIR = HARNESS_DIR / "reports"
STATUS_ORDER = {"pass": 0, "warn": 1, "fail": 2}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def worst_status(statuses: list[str]) -> str:
    if not statuses:
        return "pass"
    return max(statuses, key=lambda status: STATUS_ORDER.get(status, 2))


@dataclass
class Check:
    name: str
    status: str
    details: str = ""
    remediation: str = ""
    latency_ms: float | None = None
    metrics: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "name": self.name,
            "status": self.status,
            "details": self.details,
            "remediation": self.remediation,
        }
        if self.latency_ms is not None:
            payload["latencyMs"] = round(self.latency_ms, 2)
        if self.metrics:
            payload["metrics"] = self.metrics
        return payload


def make_report(suite: str, checks: list[Check], metrics: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "status": worst_status([check.status for check in checks]),
        "suite": suite,
        "generatedAt": utc_now(),
        "checks": [check.as_dict() for check in checks],
        "metrics": metrics or {},
    }


def write_report(suite: str, report: dict[str, Any]) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    safe_suite = suite.replace("/", "_")
    latest = REPORTS_DIR / f"latest_{safe_suite}.json"
    stamped = REPORTS_DIR / f"{safe_suite}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    latest.write_text(text, encoding="utf-8")
    stamped.write_text(text, encoding="utf-8")
    return latest


def load_env() -> dict[str, str]:
    env = dict(os.environ)
    for path in [ROOT / ".env", ROOT / ".env.local", ROOT / "web" / ".env.local"]:
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in env:
                env[key] = value
    return env


def run_command(name: str, command: list[str], cwd: Path | None = None, timeout: int = 120) -> Check:
    started = time.perf_counter()
    try:
        result = subprocess.run(
            command,
            cwd=str(cwd or ROOT),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        return Check(name=name, status="fail", details=str(exc), remediation="Install the missing executable.")
    except subprocess.TimeoutExpired as exc:
        elapsed = (time.perf_counter() - started) * 1000
        return Check(
            name=name,
            status="fail",
            latency_ms=elapsed,
            details=f"Timed out after {timeout}s. Output: {(exc.stdout or '')[-2000:]}",
            remediation="Run the command locally and inspect the timeout cause.",
        )

    elapsed = (time.perf_counter() - started) * 1000
    output = (result.stdout or "").strip()
    return Check(
        name=name,
        status="pass" if result.returncode == 0 else "fail",
        latency_ms=elapsed,
        details=output[-3000:],
        remediation="Fix the command output above." if result.returncode != 0 else "",
        metrics={"returnCode": result.returncode},
    )


def http_json(method: str, url: str, body: dict[str, Any] | None = None, headers: dict[str, str] | None = None, timeout: int = 60) -> tuple[int, Any, float]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request_headers = {"Accept": "application/json", **(headers or {})}
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=request_headers, method=method.upper())
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            elapsed = (time.perf_counter() - started) * 1000
            try:
                return response.status, json.loads(raw), elapsed
            except json.JSONDecodeError:
                return response.status, {"raw": raw}, elapsed
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        elapsed = (time.perf_counter() - started) * 1000
        try:
            payload: Any = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return exc.code, payload, elapsed


def is_connection_error(exc: BaseException) -> bool:
    return isinstance(exc, (urllib.error.URLError, TimeoutError, ConnectionError, OSError))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def latest_report(name: str) -> dict[str, Any] | None:
    path = REPORTS_DIR / f"latest_{name}.json"
    if not path.exists():
        return None
    return read_json(path)


def print_report(report: dict[str, Any], path: Path) -> None:
    print(json.dumps({"status": report["status"], "suite": report["suite"], "report": str(path)}, ensure_ascii=False, indent=2))
