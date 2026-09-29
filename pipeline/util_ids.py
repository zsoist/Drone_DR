"""Filename / id sanitizers shared by the HTTP server.

Each helper is byte-identical to the inline `re.sub(...)` it replaced in aerobrain_server.py
(same pattern, same replacement, input coerced with str()).
"""
from __future__ import annotations

import re

_ID_RE = re.compile(r"[^\w-]")
_NAME_RE = re.compile(r"[^\w.\- ]")
_UPLOAD_RE = re.compile(r"[^\w.\-]")


def safe_id(x) -> str:
    """Clip / scene / cid id: keep word chars and '-', drop everything else."""
    return _ID_RE.sub("", str(x))


def safe_name(x) -> str:
    """File name that may contain spaces and dots: keep [\\w.\\- ], drop the rest."""
    return _NAME_RE.sub("", str(x))


def safe_upload_name(x) -> str:
    """Upload file name: keep [\\w.\\-], replace everything else with '_'."""
    return _UPLOAD_RE.sub("_", str(x))


def safe_upload_name_spaces(x) -> str:
    """Upload file name that keeps spaces: keep [\\w.\\- ], replace the rest with '_'."""
    return _NAME_RE.sub("_", str(x))
