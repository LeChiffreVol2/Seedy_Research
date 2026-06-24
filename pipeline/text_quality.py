"""Conservative text cleanup and OCR quality metrics for indexing."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

OCR_CLEANUP_VERSION = "2026-06-11.1"

BOILERPLATE_PATTERNS = [
    re.compile(r"การประชุมวิชาการวิศวกรรมโยธาแห่งชาติ", re.I),
    re.compile(r"National Convention on Civil Engineering", re.I),
    re.compile(r"The\s+\d+(?:st|nd|rd|th)?\s+National Convention", re.I),
    re.compile(r"Online Conference|การประชุมรูปแบบออนไลน์", re.I),
    re.compile(r"\bTHAILAND\b", re.I),
]


def repair_thai_text(text: str) -> str:
    repaired = text.replace("\ufffd", " ")
    repaired = re.sub(r"[ \t]{2,}", " ", repaired)
    repaired = re.sub(r"([\u0E00-\u0E7F])\s+([\u0E31\u0E34-\u0E3A\u0E47-\u0E4E])", r"\1\2", repaired)
    repaired = re.sub(r"([\u0E40-\u0E44])\s+([\u0E00-\u0E7F])", r"\1\2", repaired)
    return repaired


def is_page_heading(line: str) -> bool:
    return bool(re.match(r"^#{1,6}\s+Page\s+\d+\s*$", line.strip(), re.I))


def is_markdown_heading(line: str) -> bool:
    return bool(re.match(r"^#{1,6}\s+\S", line.strip()))


def should_drop_boilerplate(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if is_markdown_heading(stripped):
        return False
    if any(pattern.search(stripped) for pattern in BOILERPLATE_PATTERNS):
        return True
    if re.match(r"^\d{1,2}\s*(?:-|–)\s*\d{1,2}\s+(?:May|June|July)\s+\d{4}", stripped, re.I):
        return True
    if re.match(r"^(?:หน้า|Page)\s*\d+\s*$", stripped, re.I):
        return True
    return False


def clean_markdown_for_index(markdown: str) -> str:
    lines: list[str] = []
    for raw_line in markdown.replace("\r", "\n").splitlines():
        line = repair_thai_text(raw_line).rstrip()
        if should_drop_boilerplate(line):
            continue
        if is_page_heading(line):
            lines.append(line.strip())
            continue
        lines.append(line)
    text = "\n".join(lines)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def ocr_quality_metrics(text: str) -> dict[str, Any]:
    chars = max(1, len(text))
    replacement_chars = text.count("\ufffd")
    control_chars = sum(1 for char in text if ord(char) < 32 and char not in "\n\t\r")
    prefixes = Counter(re.findall(r"\b([A-Z]{2,5})-?\d{1,3}\b", text))
    return {
        "chars": len(text),
        "replacementCharRate": round(replacement_chars / chars, 6),
        "controlCharRate": round(control_chars / chars, 6),
        "topCodePrefixes": prefixes.most_common(10),
    }
