from __future__ import annotations

import sys
from pathlib import Path

# Vercel function config.
config = {
    "maxDuration": 60,
    "regions": ["sin1"],
}

# Make parent directory importable so `server.py` can be loaded.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import app  # noqa: E402
