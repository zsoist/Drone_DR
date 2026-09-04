"""Strict JSON and hashing helpers that never mutate source manifests."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


def load_object(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except FileNotFoundError:
        raise
    except (OSError, ValueError) as error:
        raise ValueError(f"invalid JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise ValueError(f"JSON root is not an object: {path.name}")
    return value


def hash_file(path: Path, chunk_bytes: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(chunk_bytes):
            digest.update(chunk)
    return digest.hexdigest()
