"""License, privacy, reproducibility, and measurement gate for optional models."""

from __future__ import annotations

import re


_HASH = re.compile(r"^[0-9a-f]{64}$")
_NONCOMMERCIAL = ("noncommercial", "non-commercial", "-nc-", "cc-by-nc")


def evaluate_model_intake(record: dict) -> str:
    """Return ``production``, ``research-only``, or ``rejected`` conservatively."""
    if not isinstance(record, dict):
        return "rejected"
    if not record.get("name") or not record.get("code_license"):
        return "rejected"
    if not _HASH.fullmatch(str(record.get("checkpoint_sha256") or "")):
        return "rejected"
    if record.get("data_egress") != "none" and not record.get("private_upload_opt_in"):
        return "rejected"
    weights_license = str(record.get("weights_license") or "").lower()
    if not weights_license:
        return "rejected"
    if any(marker in weights_license for marker in _NONCOMMERCIAL):
        return "research-only"
    if record.get("evaluated") is not True:
        return "research-only"
    if record.get("performance_claims") and not record.get("hardware_measurements"):
        return "research-only"
    return "production"
