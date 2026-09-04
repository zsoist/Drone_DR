"""Content-derived identities for immutable world builds."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping


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
