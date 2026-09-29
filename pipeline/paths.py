"""Single source of truth for AeroBrain's filesystem roots.

Before 2026-09-28 about 25 modules each hardcoded VAULT = Path("/Volumes/SSD/drone-vault").
Import from here instead. AEROBRAIN_VAULT overrides the vault (tests, other machines);
the default is the production location, so behavior is unchanged when it is unset.
"""
from __future__ import annotations

import os
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PIPE = REPO / "pipeline"
WEB = REPO / "web"
VAULT = Path(os.environ.get("AEROBRAIN_VAULT", "/Volumes/SSD/drone-vault"))
KEYS_ENV = Path(os.environ.get("AEROBRAIN_KEYS_ENV", "/Volumes/SSD/_system/claude/.api-keys.env"))
