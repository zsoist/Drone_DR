"""Crash-safe file writes shared by server, worker and tools.

Replaces a dozen ad-hoc tmp+replace helpers, several of which used a fixed tmp name
(`meta.json.tmp`) that two processes could write at once.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path


def atomic_write_bytes(path: Path | str, data: bytes, mode: int = 0o644, fsync: bool = False) -> None:
    """Write data to path atomically: unique tmp in the same dir, then os.replace."""
    path = Path(path)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            os.fchmod(fh.fileno(), mode)     # mkstemp creates 0600
            if fsync:
                fh.flush()
                os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def atomic_write_text(path: Path | str, text: str, **kw) -> None:
    atomic_write_bytes(path, text.encode("utf-8"), **kw)


def atomic_write_json(path: Path | str, obj, *, indent=None, ensure_ascii=False,
                      separators=None, allow_nan=True, **kw) -> None:
    atomic_write_text(path, json.dumps(obj, indent=indent, ensure_ascii=ensure_ascii,
                                       separators=separators, allow_nan=allow_nan), **kw)


def read_json(path: Path | str, default=None):
    """json.loads(read_text) that returns `default` on missing/corrupt files."""
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default
