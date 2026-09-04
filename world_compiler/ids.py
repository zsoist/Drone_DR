"""Content-derived identities for immutable world builds."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path


def canonical_json(value: object) -> bytes:
    """Encode JSON deterministically and reject values JSON cannot represent truthfully."""
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def hero_id(
    request: Mapping[str, object],
    source_hashes: Mapping[str, str],
    adapter_hashes: Mapping[str, str],
) -> str:
    """Return the stable Hero Cell identity for all content-defining inputs."""
    envelope = {
        "request": dict(request),
        "source_hashes": dict(source_hashes),
        "adapter_hashes": dict(adapter_hashes),
    }
    digest = hashlib.sha256(canonical_json(envelope)).hexdigest()
    return f"hero_{digest[:16]}"


def tree_hash(
    root: Path,
    *,
    suffixes: tuple[str, ...] = (".py", ".json", ".ini", ".cpp", ".h", ".cs", ".uproject"),
) -> str:
    """Hash stable source files below a tree, excluding generated/cache/test content."""
    root = Path(root).resolve()
    excluded = {"__pycache__", "tests", "Binaries", "DerivedDataCache", "Intermediate", "Saved", "Generated"}
    records = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in suffixes:
            continue
        relative = path.relative_to(root)
        if any(part in excluded for part in relative.parts):
            continue
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        records[relative.as_posix()] = digest.hexdigest()
    return hashlib.sha256(canonical_json(records)).hexdigest()
