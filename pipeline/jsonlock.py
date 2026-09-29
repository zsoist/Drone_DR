"""Read-modify-write of a JSON file under an fcntl lock (per-file lock file)."""
from __future__ import annotations

import fcntl
from pathlib import Path

from fsutil import atomic_write_json, read_json


def locked_update_json(path, fn, lock_dir, *, default=None, **dump_kw):
    """Under an exclusive flock on <lock_dir>/<path.stem>.lock: re-read `path`, call fn(data),
    write the result atomically. fn may mutate in place (return None) or return a new object.
    Returns the object written. dump_kw go to atomic_write_json (indent, ensure_ascii, ...)."""
    path = Path(path)
    lock_dir = Path(lock_dir)
    lock_dir.mkdir(parents=True, exist_ok=True)
    with open(lock_dir / f"{path.stem}.lock", "a") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            data = read_json(path, {} if default is None else default)
            new = fn(data)
            if new is None:
                new = data
            atomic_write_json(path, new, **dump_kw)
            return new
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)
