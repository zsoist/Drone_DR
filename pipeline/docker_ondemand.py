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

import os
import shutil
import subprocess
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

DOCKER = "/usr/local/bin/docker"
IDLE_STOP_S = 300
# shared by the web server and the worker (both may run docker steps)
MARKER = Path.home() / "Library" / "Caches" / "AeroBrain" / "docker-last-use"
LEASE_MAX_AGE_S = 2 * 3600       # a lease older than this is ignored (crashed holder)


def _lease_dir() -> Path:
    return MARKER.parent


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def active_leases(now: float | None = None) -> list[Path]:
    """Lease files of live callers younger than LEASE_MAX_AGE_S (stale/dead ones ignored)."""
    now = now or time.time()
    out = []
    try:
        files = list(_lease_dir().glob("docker-lease-*"))
    except OSError:
        return []
    for f in files:
        try:
            age = now - f.stat().st_mtime
            pid = int(f.name.rsplit("-", 2)[-2])
        except (OSError, ValueError, IndexError):
            continue
        if age < LEASE_MAX_AGE_S and _pid_alive(pid):
            out.append(f)
    return out


@contextmanager
def session(timeout_s: int = 120):
    """Hold Docker for one container step: lease first (so stop_if_idle/release cannot stop
    the VM under us), then ensure_up(). The lease is removed on exit even on failure."""
    _lease_dir().mkdir(parents=True, exist_ok=True)
    lease = _lease_dir() / f"docker-lease-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    lease.touch()
    try:
        ensure_up(timeout_s)
        yield
    finally:
        try:
            lease.unlink()
        except OSError:
            pass
        try:
            touch()                      # idle window starts when the step ends
        except OSError:
            pass


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
        try:
            r = subprocess.run([DOCKER, "info", "--format", "{{.ServerVersion}}"],
                               capture_output=True, text=True, timeout=30)
        except subprocess.TimeoutExpired:
            r = None                     # daemon still booting: retry until the deadline
        if r is not None and r.returncode == 0 and r.stdout.strip():
            return
        time.sleep(2)
    raise RuntimeError(f"Docker (OrbStack) no respondió en {timeout_s}s")


def _stop_vm(orb: str) -> None:
    subprocess.run([orb, "stop"], capture_output=True, timeout=120)
    if not running():
        # `orb start/stop` leave a ~66 MB CLI helper alive; with the VM already down it
        # holds nothing, and ensure_up() relaunches everything from cold in ~1.3 s
        subprocess.run(["pkill", "-TERM", "-f", "OrbStack --internal-cli-background"],
                       capture_output=True, timeout=10)


def stop_if_idle(active_jobs: int, now: float | None = None) -> bool:
    """Stop OrbStack when nothing has needed it for IDLE_STOP_S. Returns True if stopped."""
    now = now or time.time()
    orb = _orb()
    if not orb or active_jobs or now - last_use() < IDLE_STOP_S or not running():
        return False
    if active_leases():
        return False                     # a step is between ensure_up() and its container
    ps = subprocess.run([DOCKER, "ps", "-q"], capture_output=True, text=True, timeout=30)
    if ps.returncode != 0 or ps.stdout.strip():
        return False                     # a container is alive (maybe started by hand): leave it
    # `docker ps` takes a while: a server thread may have called ensure_up() meanwhile
    if time.time() - last_use() < IDLE_STOP_S or active_leases():
        return False
    _stop_vm(orb)
    return True


def release(expected_mark: float | None = None) -> bool:
    """Stop OrbStack right now (ignoring the idle window) when no container is running.

    For a step that just finished while the job continues for hours without Docker
    (e.g. export_colmap before a remote 4 h training). `expected_mark` is the value of
    last_use() the caller saw after its own touch(); if anyone touched the marker since
    (web server thread starting a GDAL step), OrbStack is left alone."""
    orb = _orb()
    if not orb or not running():
        return False
    if active_leases():
        return False
    if expected_mark is not None and last_use() != expected_mark:
        return False
    ps = subprocess.run([DOCKER, "ps", "-q"], capture_output=True, text=True, timeout=30)
    if ps.returncode != 0 or ps.stdout.strip():
        return False
    if (expected_mark is not None and last_use() != expected_mark) or active_leases():
        return False
    _stop_vm(orb)
    return True
