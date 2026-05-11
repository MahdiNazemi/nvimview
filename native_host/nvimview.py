#!/usr/bin/env python3
# ruff: noqa: E402, I001
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from native_host.session import run_native_host


if __name__ == "__main__":
    raise SystemExit(run_native_host())
