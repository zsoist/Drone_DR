#!/opt/homebrew/bin/python3
"""One-shot AeroBrain operations audit.

Read-only status check for the 24/7 Mac Mini setup. The watchdog heals common
failures; this script proves current state for humans and agents.
"""
import argparse
import datetime
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
REPO = Path("/Volumes/SSD/work/forge-projects/aerobrain")
TUNNEL_CONFIG = Path("/Users/daniel_serverm4/.cloudflared/metislab-work.yml")
LOGS = (
    Path("/tmp/aerobrain-web.log"),
    Path("/tmp/aerobrain-worker.log"),
    Path("/tmp/metislab-tunnel.log"),
    Path("/tmp/aerobrain-watchdog.log"),
    Path("/tmp/aerobrain-watchdog.launchd.log"),
)
WATCHDOG_LOG = Path("/tmp/aerobrain-watchdog.log")
LABELS = ("com.aerobrain.web", "com.aerobrain.worker", "com.metislab.tunnel", "com.aerobrain.watchdog")


def launch_state(label: str) -> dict:
    try:
        out = subprocess.check_output(
            ["launchctl", "print", f"gui/501/{label}"],
            stderr=subprocess.STDOUT,
            text=True,
            timeout=5,
        )
    except Exception as e:
        return {"state": "missing", "error": type(e).__name__}
    state = "unknown"
    pid = None
    runs = None
    last_exit = None
    for line in out.splitlines():
        s = line.strip()
        if s.startswith("state ="):
            state = s.partition("=")[2].strip()
        elif s.startswith("pid ="):
            try:
                pid = int(s.partition("=")[2].strip())
            except ValueError:
                pass
        elif s.startswith("runs ="):
            try:
                runs = int(s.partition("=")[2].strip())
            except ValueError:
                pass
        elif s.startswith("last exit code ="):
            try:
                last_exit = int(s.partition("=")[2].strip())
            except ValueError:
                pass
    ok = bool(state in ("running", "active") and pid) if label != "com.aerobrain.watchdog" else (last_exit == 0)
    return {"state": state, "pid": pid, "runs": runs, "last_exit": last_exit, "ok": ok}


def fetch_json(url: str, timeout: int) -> tuple[bool, dict | str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AeroBrainOpsStatus/1"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 400, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            detail = str(e)
        return False, f"{e.code} {detail}"
    except Exception as e:
        return False, type(e).__name__


def fetch_text(url: str, timeout: int) -> tuple[bool, str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AeroBrainOpsStatus/1"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 400, f"{r.status} {r.read(180).decode('utf-8', 'replace')}"
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            detail = str(e)
        return False, f"{e.code} {detail}"
    except Exception as e:
        return False, type(e).__name__


def latest_proxy_url() -> str | None:
    try:
        flights = json.loads((VAULT / "manifest" / "flights.json").read_text()).get("flights", [])
    except Exception:
        return None
    for f in flights:
        cid = f.get("clip_id")
        if cid and f.get("has_proxy") and (VAULT / "proxies" / f"{cid}.mp4").is_file():
            return "https://vuelos.metislab.work/data/proxies/" + urllib.parse.quote(f"{cid}.mp4")
    return None


def range_probe(url: str | None) -> dict:
    if not url:
        return {"ok": False, "detail": "no proxy video found"}
    req = urllib.request.Request(url, headers={
        "User-Agent": "AeroBrainOpsStatus/1",
        "Range": "bytes=0-0",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read(1)
            cr = r.headers.get("Content-Range", "")
            cache = r.headers.get("cf-cache-status", "")
            ok = r.status == 206 and cr.startswith("bytes 0-0/")
            return {"ok": ok, "status": r.status, "content_range": cr, "cache": cache,
                    "file": url.rsplit("/", 1)[-1]}
    except Exception as e:
        return {"ok": False, "detail": type(e).__name__, "file": url.rsplit("/", 1)[-1]}


def jobs_status() -> dict:
    db = VAULT / "manifest" / "jobs.db"
    try:
        with sqlite3.connect(db, timeout=5) as c:
            c.row_factory = sqlite3.Row
            active = [dict(r) for r in c.execute(
                "SELECT id,kind,label,status,progress,started FROM jobs "
                "WHERE status IN ('queued','running') ORDER BY started DESC LIMIT 10")]
            stale = [dict(r) for r in c.execute(
                "SELECT id,kind,label,status,started FROM jobs "
                "WHERE status='running' AND started < ? ORDER BY started ASC LIMIT 10",
                (time.time() - 8 * 3600,))]
        return {"ok": not stale, "active": active, "stale_running": stale}
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}


def resource_status(active_jobs: int = 0) -> dict:
    try:
        out = subprocess.check_output(["ps", "-axo", "pid,pcpu,pmem,rss,command"], text=True, timeout=5)
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}
    base_rows = []
    workload_rows = []
    total_cpu = 0.0
    total_rss = 0
    for line in out.splitlines()[1:]:
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        pid, cpu, mem, rss, cmd = parts
        is_base = ("pipeline/aerobrain_server.py" in cmd
                   or "pipeline/worker.py" in cmd
                   or ("cloudflared tunnel" in cmd and "metislab-work.yml" in cmd))
        is_workload = ("splat/OpenSplat" in cmd
                       or any(f"pipeline/{name}" in cmd for name in
                              ("odm_prep.py", "tresd_publish.py", "process.py"))
                       or ("ffmpeg" in cmd and "/Volumes/SSD/drone-vault" in cmd)
                       or ("docker run" in cmd and "odm-" in cmd))
        if not (is_base or is_workload):
            continue
        cpu_f = float(cpu)
        rss_i = int(rss)
        row = {"pid": int(pid), "cpu": cpu_f, "mem": float(mem),
               "rss_mb": round(rss_i / 1024, 1), "cmd": cmd[:120]}
        if is_base:
            total_cpu += cpu_f
            total_rss += rss_i
            base_rows.append(row)
        elif is_workload:
            workload_rows.append(row)

    odm_containers = []
    try:
        raw = subprocess.check_output(
            ["/usr/local/bin/docker", "ps", "--filter", "name=odm-", "--format", "{{.Names}}"],
            text=True, timeout=5)
        odm_containers = [name for name in raw.splitlines() if name.startswith("odm-")]
    except Exception:
        pass
    orphan_workload = bool((workload_rows or odm_containers) and active_jobs == 0)
    return {"ok": total_cpu < 15 and total_rss < 500_000 and not orphan_workload,
            "mode": "working" if active_jobs else "idle",
            "total_cpu": round(total_cpu, 1),
            "total_rss_mb": round(total_rss / 1024, 1),
            "processes": base_rows,
            "workload_processes": workload_rows,
            "odm_containers": odm_containers,
            "orphan_workload": orphan_workload}


def logs_status() -> dict:
    items = []
    ok = True
    for p in LOGS:
        size = p.stat().st_size if p.exists() else 0
        if size > 6 * 1024 * 1024:
            ok = False
        items.append({"path": str(p), "mb": round(size / 1024**2, 2)})
    return {"ok": ok, "logs": items}


def latency_status() -> dict:
    buckets = {"local_probe": [], "public_probe": [], "public_www_probe": [], "stream_probe": []}
    try:
        lines = WATCHDOG_LOG.read_text(errors="replace").splitlines()[-500:]
    except OSError:
        return {"ok": False, "error": "watchdog log missing"}
    for line in lines:
        try:
            row = json.loads(line)
        except ValueError:
            continue
        event = row.get("event")
        ms = row.get("ms")
        if event in buckets and isinstance(ms, (int, float)):
            buckets[event].append(float(ms))
    summary = {}
    ok = True
    limits = {"local_probe": 1000, "public_probe": 3000, "public_www_probe": 3000, "stream_probe": 5000}
    for event, vals in buckets.items():
        if not vals:
            summary[event] = {"samples": 0}
            continue
        latest = vals[-1]
        sorted_vals = sorted(vals)
        p95 = sorted_vals[min(len(sorted_vals) - 1, int(len(sorted_vals) * 0.95))]
        if p95 > limits[event]:
            ok = False
        summary[event] = {
            "samples": len(vals),
            "latest_ms": round(latest),
            "p95_ms": round(p95),
            "limit_ms": limits[event],
        }
    return {"ok": ok, **summary}


def reliability_status(window_hours: int = 24) -> dict:
    """Prove continuity from watchdog history, not only current reachability."""
    now = time.time()
    cutoff = now - window_hours * 3600
    rows = []
    for path in (WATCHDOG_LOG.with_name(WATCHDOG_LOG.name + ".1"), WATCHDOG_LOG):
        try:
            lines = path.read_text(errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                row = json.loads(line)
                ts = datetime.datetime.strptime(row["ts"], "%Y-%m-%dT%H:%M:%S%z").timestamp()
            except (KeyError, TypeError, ValueError):
                continue
            if ts >= cutoff:
                row["_ts"] = ts
                rows.append(row)
    rows.sort(key=lambda r: r["_ts"])
    local = [r for r in rows if r.get("event") == "local_probe"]
    if not local:
        return {"ok": False, "window_hours": window_hours, "error": "no watchdog samples"}

    gaps = [b["_ts"] - a["_ts"] for a, b in zip(local, local[1:])]
    coverage_h = max(0.0, (local[-1]["_ts"] - max(cutoff, local[0]["_ts"])) / 3600)
    probe_rows = [r for r in rows if str(r.get("event", "")).endswith("_probe")]
    failed = [r for r in probe_rows if r.get("ok") is False]
    recovered = [r for r in probe_rows if r.get("recovered") in ("retry", "restart")]
    kickstarts = [r for r in rows if r.get("event") == "kickstart"]
    max_gap = max(gaps, default=0)
    # Allow normal launchd jitter, but not a sleeping/stalled Mac. The first and
    # last samples must cover virtually the whole requested window.
    ok = coverage_h >= window_hours - 0.5 and max_gap <= 180 and not failed
    return {
        "ok": ok,
        "window_hours": window_hours,
        "coverage_hours": round(coverage_h, 2),
        "samples": len(local),
        "max_gap_s": round(max_gap, 1),
        "failed_probes": len(failed),
        "recoveries": len(recovered),
        "kickstarts": len(kickstarts),
        "first": datetime.datetime.fromtimestamp(local[0]["_ts"]).astimezone().isoformat(timespec="seconds"),
        "last": datetime.datetime.fromtimestamp(local[-1]["_ts"]).astimezone().isoformat(timespec="seconds"),
    }


def power_status() -> dict:
    """Verify AC settings required for an always-on local origin."""
    try:
        out = subprocess.check_output(["pmset", "-g", "custom"], text=True, timeout=5)
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}
    settings = {}
    in_ac = False
    for line in out.splitlines():
        if line.strip() == "AC Power:":
            in_ac = True
            continue
        if not in_ac:
            continue
        m = re.match(r"\s*(sleep|disksleep|autorestart)\s+(\d+)\s*$", line)
        if m:
            settings[m.group(1)] = int(m.group(2))
    ok = (settings.get("sleep") == 0
          and settings.get("disksleep") == 0
          and settings.get("autorestart") == 1)
    return {"ok": ok, **settings}


def tunnel_config_status() -> dict:
    try:
        txt = TUNNEL_CONFIG.read_text()
    except OSError as e:
        return {"ok": False, "error": type(e).__name__}
    ok = ("hostname: vuelos.metislab.work" in txt
          and "hostname: www.metislab.work" in txt
          and "service: http://127.0.0.1:8790" in txt)
    return {"ok": ok, "config": str(TUNNEL_CONFIG)}


def manifest_status() -> dict:
    out = {}
    ok = True
    for name in ("flights.json", "system.json"):
        p = VAULT / "manifest" / name
        try:
            data = json.loads(p.read_text())
            out[name] = {"ok": True, "bytes": p.stat().st_size}
            if name == "flights.json":
                out[name]["flights"] = len(data.get("flights", []))
        except Exception as e:
            ok = False
            out[name] = {"ok": False, "error": type(e).__name__}
    return {"ok": ok, **out}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = ap.parse_args()

    local_ok, local = fetch_json("http://127.0.0.1:8790/api/healthz", 8)
    public_ok, public = fetch_json("https://vuelos.metislab.work/api/healthz", 15)
    www_ok, www = fetch_text("https://www.metislab.work/", 15)
    jobs = jobs_status()
    running_jobs = sum(j.get("status") == "running" for j in jobs.get("active", []))
    report = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "services": {label: launch_state(label) for label in LABELS},
        "health": {
            "local": {"ok": local_ok, "detail": local},
            "public": {"ok": public_ok, "detail": public},
            "www": {"ok": www_ok, "detail": www},
        },
        "stream": range_probe(latest_proxy_url()),
        "jobs": jobs,
        "resources": resource_status(running_jobs),
        "logs": logs_status(),
        "latency": latency_status(),
        "reliability": reliability_status(),
        "power": power_status(),
        "tunnel_config": tunnel_config_status(),
        "manifests": manifest_status(),
    }
    checks = []
    checks.extend(v.get("ok", False) for v in report["services"].values())
    checks.extend((local_ok, public_ok, www_ok, report["stream"]["ok"], report["jobs"]["ok"],
                   report["resources"]["ok"], report["logs"]["ok"],
                   report["latency"]["ok"], report["reliability"]["ok"],
                   report["power"]["ok"],
                   report["tunnel_config"]["ok"], report["manifests"]["ok"]))
    report["ok"] = all(checks)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"AeroBrain ops: {'PASS' if report['ok'] else 'FAIL'} · {report['ts']}")
        print(f"  health: local={local_ok} public={public_ok} www={www_ok}")
        print(f"  stream: ok={report['stream']['ok']} {report['stream'].get('content_range', report['stream'].get('detail', ''))} cache={report['stream'].get('cache', '')}")
        print(f"  resources: mode={report['resources'].get('mode')} "
              f"cpu={report['resources'].get('total_cpu')}% "
              f"rss={report['resources'].get('total_rss_mb')}MB "
              f"workloads={len(report['resources'].get('workload_processes', [])) + len(report['resources'].get('odm_containers', []))}")
        lat = report.get("latency", {})
        print("  latency: " + " ".join(
            f"{k}=p95:{v.get('p95_ms', 'n/a')}ms"
            for k, v in lat.items() if isinstance(v, dict) and k.endswith("_probe")))
        rel = report["reliability"]
        print(f"  reliability: {rel.get('coverage_hours', 0)}h "
              f"failures={rel.get('failed_probes', 0)} max_gap={rel.get('max_gap_s', 0)}s")
        pwr = report["power"]
        print(f"  power: sleep={pwr.get('sleep')} disksleep={pwr.get('disksleep')} "
              f"autorestart={pwr.get('autorestart')}")
        print(f"  jobs: active={len(report['jobs'].get('active', []))} stale={len(report['jobs'].get('stale_running', []))}")
        for label, st in report["services"].items():
            print(f"  {label}: {st.get('state')} pid={st.get('pid')} runs={st.get('runs')} ok={st.get('ok')}")
        if not report["ok"]:
            print(json.dumps(report, indent=2), file=sys.stderr)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
