"""Single parser for the shared API-keys env file (paths.KEYS_ENV).

Replaces the copies in ai/router.py, error_report.py and sync_supabase.py.
Format: KEY=VALUE lines; blanks and '#' comments ignored; whitespace and
surrounding quotes stripped; later duplicates win. A missing/unreadable file
yields {}. Results are cached per process; call reload() to re-read.
"""
from __future__ import annotations

from pathlib import Path

from paths import KEYS_ENV

_cache: dict[str, dict] = {}


def _parse(path: Path) -> dict:
    out: dict = {}
    try:
        text = path.read_text()
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip("\"'")
    return out


def load_keys(path=None) -> dict:
    """Return a copy of the parsed keys (cached per path)."""
    p = Path(path) if path is not None else KEYS_ENV
    k = str(p)
    if k not in _cache:
        _cache[k] = _parse(p)
    return dict(_cache[k])


def get_key(name: str, default: str = "") -> str:
    return load_keys().get(name, default)


def reload(path=None) -> dict:
    """Drop the cache (all paths, or just `path`) and re-read."""
    if path is None:
        _cache.clear()
    else:
        _cache.pop(str(Path(path)), None)
    return load_keys(path)
