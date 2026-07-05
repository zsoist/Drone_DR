"""Smoke tests del pipeline — corre con: python3 test_smoke.py (sin dependencias de test).

Cubre las piezas puras: parser SRT (con puntos 0,0), política de tiers,
mediciones DSM (volumen y perfil sobre un DSM sintético), y contención de paths.
"""
import json
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
FAILS = []


def _pid_alive(pid):
    import os
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, TypeError):
        return False


def _swallow(fn):
    try:
        fn()
    except Exception:
        pass


def check(name, cond, detail=""):
    print(("✅" if cond else "❌"), name, detail if not cond else "")
    if not cond:
        FAILS.append(name)


# ---------- srt_parser ----------
from srt_parser import parse_srt

SRT_SAMPLE = """1
00:00:00,000 --> 00:00:00,033
<font size="28">FrameCnt: 1, DiffTime: 33ms
2026-07-04 16:09:33.953
[iso: 100] [shutter: 1/120.0] [fnum: 1.7] [ev: 0] [color_md: default] [focal_len: 24.00] [latitude: 0.000000] [longitude: 0.000000] [rel_alt: 0.000 abs_alt: 0.000] [ct: 5232] </font>

2
00:00:01,000 --> 00:00:01,033
<font size="28">FrameCnt: 31, DiffTime: 33ms
2026-07-04 16:09:34.953
[iso: 100] [shutter: 1/120.0] [fnum: 1.7] [ev: 0] [color_md: default] [focal_len: 24.00] [latitude: 4.751684] [longitude: -74.064017] [rel_alt: 10.0 abs_alt: 2563.9] [ct: 5232] </font>

3
00:00:02,000 --> 00:00:02,033
<font size="28">FrameCnt: 61, DiffTime: 33ms
2026-07-04 16:09:35.953
[iso: 100] [shutter: 1/120.0] [fnum: 1.7] [ev: 0] [color_md: default] [focal_len: 24.00] [latitude: 4.752684] [longitude: -74.064017] [rel_alt: 20.0 abs_alt: 2573.9] [ct: 5232] </font>
"""
with tempfile.NamedTemporaryFile("w", suffix=".SRT", delete=False) as f:
    f.write(SRT_SAMPLE)
    srt_path = Path(f.name)
track = parse_srt(srt_path)
check("srt: descarta puntos 0,0 pre-GPS-lock", len(track["points"]) == 2,
      f"esperaba 2, hay {len(track['points'])}")
check("srt: stats con bbox válido", abs(track["stats"]["bbox"][1] - 4.751684) < 1e-6)
check("srt: distancia ~111m (0.001° lat)", 100 < track["stats"]["distance_m"] < 122,
      str(track["stats"]["distance_m"]))

# ---------- policy ----------
from policy import processing_tier

check("policy: clip corto = skim", processing_tier({"duration_s": 5, "has_srt": True, "stats": {}}) == "skim")
check("policy: vuelo real = full",
      processing_tier({"duration_s": 90, "has_srt": True, "stats": {"distance_m": 500}}) == "full")
check("policy: upload sin srt >=20s = full",
      processing_tier({"duration_s": 45, "has_srt": False, "stats": {}}) == "full")

# ---------- measure_dsm (sintético) ----------
import numpy as np
from aerobrain_server import measure_dsm

with tempfile.TemporaryDirectory() as td:
    mdir = Path(td)
    h, w = 100, 100
    # DSM sintético: plano a 100m con una "pila" de 10m de alto en el centro (20x20 celdas)
    arr = np.full((h, w), 100.0, dtype=np.float32)
    arr[40:60, 40:60] = 110.0
    arr.tofile(mdir / "dsm.bin")
    gt = [-74.001, 0.00001, 0, 4.001, 0, -0.00001]  # ~1.1m por celda
    (mdir / "meta.json").write_text(json.dumps({"dsm_shape": [h, w], "dsm_gt": gt, "dsm_nodata": None}))
    poly = [[-74.0009, 4.0009], [-74.0001, 4.0009], [-74.0001, 4.0001], [-74.0009, 4.0001]]
    v = measure_dsm(mdir, {"type": "volume", "points": poly})
    cell = 0.00001 * 111320 * 0.00001 * 110540  # ~1.23 m²
    expected = 20 * 20 * 10 * cell
    check("measure: volumen de pila sintética ±10%",
          abs(v["volume_m3"] - expected) / expected < 0.1, f"{v['volume_m3']} vs {expected:.0f}")
    check("measure: altura máx = 10m", abs(v["max_height"] - 10.0) < 0.2, str(v["max_height"]))
    p = measure_dsm(mdir, {"type": "profile", "points": [poly[0], poly[2]]})
    check("measure: perfil con 121 muestras", len(p["profile"]) == 121)
    check("measure: perfil cruza la pila (max 110)", max(x for x in p["profile"] if x) > 109)

# ---------- path containment ----------
base = Path("/Volumes/SSD/drone-vault").resolve()
evil = Path("/Volumes/SSD/drone-vault2/secret").resolve()
try:
    evil.relative_to(base)
    contained = True
except ValueError:
    contained = False
check("paths: drone-vault2 NO pasa el contención", not contained)

# ---------- jobs: sessions SQLite ----------
import jobs
jobs.DB = Path(tempfile.mkdtemp()) / "test-jobs.db"
jobs.init()
sid = jobs.session_create(1)
check("session: creada y válida", jobs.session_valid(sid))
check("session: id inexistente inválido", not jobs.session_valid("nope"))
jobs.session_delete(sid)
check("session: eliminada (logout) invalida", not jobs.session_valid(sid))
# corrupted DB row with NULL expiry must reject cleanly, not crash auth
with sqlite3.connect(jobs.DB) as _c:
    _c.execute("INSERT INTO sessions (id, expiry) VALUES ('null_row', NULL)")
try:
    check("session: NULL expiry rechazada sin crash", jobs.session_valid('null_row') is False)
except TypeError:
    check("session: NULL expiry rechazada sin crash", False, "TypeError")

# ---------- jobs: run_tracked records PID + cancel kills ----------
import threading, os
j = jobs.add("splat", "kill-test")
threading.Thread(target=lambda: _swallow(lambda: jobs.run_tracked(j["id"], ["sleep", "30"], 60)),
                 daemon=True).start()
time.sleep(1.2)
pid = jobs.get(j["id"])["pid"]
check("job: run_tracked registra PID", bool(pid))
alive = _pid_alive(pid)
jobs.cancel(j["id"])
time.sleep(1.2)
check("job: cancel MATA el proceso", alive and not _pid_alive(pid))
check("job: status queda cancelled", jobs.get(j["id"])["status"] == "cancelled")

# ---------- run_tracked timeout is self-consistent (row -> error) ----------
jt = jobs.add("splat", "timeout-test")
to_pid = {}
def _to_run():
    try:
        jobs.run_tracked(jt["id"], ["sleep", "30"], timeout=2)
    except TimeoutError:
        to_pid["timed_out"] = True
threading.Thread(target=_to_run, daemon=True).start()
time.sleep(0.8); to_pid["pid"] = jobs.get(jt["id"])["pid"]
time.sleep(2.5)
_jt = jobs.get(jt["id"])
check("job: timeout mata el proceso silencioso", not _pid_alive(to_pid.get("pid")))
check("job: timeout deja row en 'error' (auto-consistente)",
      _jt["status"] == "error" and "timeout" in (_jt["detail"] or ""))

# ---------- splat quality gate ----------
from aerobrain_server import splat_quality
import types
class FakeOut:
    def __init__(self, size): self._s = size
    def exists(self): return True
    def stat(self): return types.SimpleNamespace(st_size=self._s)
log_ok = "Step 1998: 0.18 (99%)\nStep 1999: 0.17 (100%)"
q = splat_quality(FakeOut(700_000), log_ok, 40, 2000)
check("splat: escena buena PASA el gate", q["passed"] and q["final_loss"] == 0.17)
q2 = splat_quality(FakeOut(50_000), log_ok, 40, 2000)
check("splat: archivo chico FALLA el gate", not q2["passed"])
q3 = splat_quality(FakeOut(700_000), log_ok, 3, 2000)
check("splat: <8 cámaras FALLA el gate", not q3["passed"])

# ---------- multi-date volume comparison (compare_dsm) ----------
from aerobrain_server import compare_dsm
_cd = Path(tempfile.mkdtemp())
_gt = [-74.001, 0.00001, 0, 4.001, 0, -0.00001]
_A = _cd / "A"; _A.mkdir(); (_A / "meta.json").write_text(json.dumps({"dsm_shape": [200, 200], "dsm_gt": _gt, "dsm_nodata": None}))
np.full((200, 200), 100.0, dtype=np.float32).tofile(_A / "dsm.bin")
_arrb = np.full((200, 200), 100.0, dtype=np.float32); _arrb[30:70, 30:70] = 105.0  # +5m edificio
_B = _cd / "B"; _B.mkdir(); (_B / "meta.json").write_text(json.dumps({"dsm_shape": [200, 200], "dsm_gt": _gt, "dsm_nodata": None}))
_arrb.tofile(_B / "dsm.bin")
_poly = [[-74.0009, 4.0009], [-74.0001, 4.0009], [-74.0001, 4.0001], [-74.0009, 4.0001]]
_r = compare_dsm(_A, _B, _poly)
check("compare: edificio 5m detectado como +volumen (~9800 m³)", 9000 < _r["net_change_m3"] < 10500)
check("compare: nada removido (sólo se agregó)", _r["removed_m3"] < 1)
check("compare: altura de cambio = 5m", abs(_r["max_rise_m"] - 5) < 0.1)

print(f"\n{'FALLARON: ' + ', '.join(FAILS) if FAILS else 'TODOS LOS TESTS PASAN'}")
sys.exit(1 if FAILS else 0)
