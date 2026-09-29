"""ffprobe wrappers shared by the HTTP server and the ingest pipeline.

`ffprobe_text` is the low-level primitive: it runs ffprobe and returns stdout, and lets
subprocess errors propagate so every call site keeps its own error semantics. The three
high-level helpers swallow errors and return a neutral value.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path


def ffprobe_text(args: list[str], path: Path | str, *, log_level: str = "error",
                 timeout: float | None = None, check: bool = False) -> str:
    """Run `ffprobe -v <log_level> <args...> <path>` and return stdout.

    Raises whatever subprocess.run raises (OSError, TimeoutExpired, and CalledProcessError
    when check=True)."""
    r = subprocess.run(["ffprobe", "-v", log_level, *args, str(path)],
                       capture_output=True, text=True, timeout=timeout, check=check)
    return r.stdout


def probe_duration(path: Path | str, timeout: float = 60) -> float:
    """Container duration in seconds; 0.0 on any error, timeout or unparsable output."""
    try:
        out = ffprobe_text(["-show_entries", "format=duration", "-of", "csv=p=0"],
                           path, timeout=timeout)
    except (subprocess.TimeoutExpired, OSError):
        return 0.0
    try:
        return float(out.strip())
    except ValueError:
        return 0.0


def has_audio(path: Path | str) -> bool:
    """True when the file has at least one audio stream (False on any failure)."""
    try:
        out = ffprobe_text(["-select_streams", "a", "-show_entries", "stream=index",
                            "-of", "csv=p=0"], path)
        return bool(out.strip())
    except Exception:
        return False


def probe_streams_json(path: Path | str, timeout: float = 30) -> dict | None:
    """`-show_streams -show_format` as a dict, or None on error/timeout/bad JSON."""
    try:
        out = ffprobe_text(["-show_streams", "-show_format", "-of", "json"],
                           path, timeout=timeout)
        d = json.loads(out)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return d if isinstance(d, dict) else None
