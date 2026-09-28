"""OrbStack only while a job needs it (operator decision 2026-09-28).

Heavy compute runs on the GPU PC; the Mac uses Docker only for short GDAL/PDAL/
OpenSfM post-processing steps inside the ODM image. OrbStack no longer starts at
login: `ensure_up()` boots it right before a local container step and the worker's
idle loop calls `stop_if_idle()`, which stops it once no job and no container has
used it for IDLE_STOP_S. Result: zero VM RAM/CPU while the Mac only serves web/video.

Note: any `docker` CLI call auto-starts OrbStack, so status probes must check
`orb status` first instead of calling docker.
"""
from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

DOCKER = "/usr/local/bin/docker"
IDLE_STOP_S = 300
# shared by the web server and the worker (both may run docker steps)
MARKER = Path.home() / "Library" / "Caches" / "AeroBrain" / "docker-last-use"


def touch() -> None:
    """Mark Docker as in use; the idle stopper waits IDLE_STOP_S from the last mark."""
    MARKER.parent.mkdir(parents=True, exist_ok=True)
    MARKER.touch()


def last_use() -> float:
    try:
        return MARKER.stat().st_mtime
    except OSError:
        return 0.0


def _orb() -> str | None:
    return shutil.which("orb") or ("/usr/local/bin/orb" if shutil.which("/usr/local/bin/orb") else None)


def running() -> bool:
    """True if the VM is up — never starts it (unlike any docker command)."""
    orb = _orb()
    if not orb:
        return True                      # no OrbStack CLI: assume a classic always-on daemon
    try:
        out = subprocess.run([orb, "status"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return out.strip().lower().startswith("running")


def ensure_up(timeout_s: int = 120) -> None:
    """Start OrbStack if needed and block until the docker API answers."""
    touch()
    orb = _orb()
    if orb and not running():
        subprocess.run([orb, "start"], capture_output=True, timeout=timeout_s)
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        r = subprocess.run([DOCKER, "info", "--format", "{{.ServerVersion}}"],
                           capture_output=True, text=True, timeout=30)
        if r.returncode == 0 and r.stdout.strip():
            return
        time.sleep(2)
    raise RuntimeError(f"Docker (OrbStack) no respondió en {timeout_s}s")


def stop_if_idle(active_jobs: int, now: float | None = None) -> bool:
    """Stop OrbStack when nothing has needed it for IDLE_STOP_S. Returns True if stopped."""
    now = now or time.time()
    orb = _orb()
    if not orb or active_jobs or now - last_use() < IDLE_STOP_S or not running():
        return False
    ps = subprocess.run([DOCKER, "ps", "-q"], capture_output=True, text=True, timeout=30)
    if ps.returncode != 0 or ps.stdout.strip():
        return False                     # a container is alive (maybe started by hand): leave it
    subprocess.run([orb, "stop"], capture_output=True, timeout=120)
    return True
