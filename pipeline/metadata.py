"""CivilMCP metadata helpers shared by extraction and indexing."""

from __future__ import annotations

import re

DISCIPLINE_BY_PREFIX = {
    "TR": "transport",
    "TRL": "transport",
    "TRP": "transport",
    "TRE": "transport",
    "UTM": "transport",
    "STR": "structural",
    "ST": "structural",
    "MAT": "structural",
    "BTL": "structural",
    "GTE": "geotechnical",
    "GE": "geotechnical",
    "CEM": "construction_mgmt",
    "CM": "construction_mgmt",
    "WRE": "water_resources",
    "SGI": "surveying_gis",
    "ENV": "environmental",
    "INF": "infrastructure",
    "EEC": "infrastructure",
    "DET": "infrastructure",
    "CEE": "civil_education",
    "AIE": "ai_engineering",
    "AIC": "ai_engineering",
    # NCCE31 uses WER-24 for a water-engineering paper; retain the source code
    # while normalizing it to the canonical water-resources discipline.
    "WER": "water_resources",
}


def prefix_from_code(value: str) -> str:
    cleaned = value.strip().upper()
    match = re.search(r"(?:NCCE\d+_)?([A-Z]{2,5})(?:-?\d{1,3})?", cleaned)
    return match.group(1) if match else ""


def infer_discipline_from_code(value: str) -> str:
    prefix = prefix_from_code(value)
    if not prefix:
        return "unknown"
    return DISCIPLINE_BY_PREFIX.get(prefix, DISCIPLINE_BY_PREFIX.get(prefix[:3], "unknown"))
