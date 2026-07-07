"""Smoke tests del pipeline — corre con: python3 test_smoke.py (sin dependencias de test).

Cubre las piezas puras: parser SRT (con puntos 0,0), política de tiers,
mediciones DSM (volumen y perfil sobre un DSM sintético), y contención de paths.
"""
import json
import sqlite3
import subprocess
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
from aerobrain_server import measure_dsm, check_polygon

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

try:
    check_polygon([[0, 0], [1, 1]])
    _bad_poly = False
except ValueError:
    _bad_poly = True
check("measure: polígono con <3 vértices rechaza limpio", _bad_poly)

try:
    check_polygon([[-74, 4], [-73, 4], [-73, 5], [-74, 5]])
    _huge_poly = False
except ValueError as e:
    _huge_poly = "área demasiado grande" in str(e)
check("measure: polígono gigante rechaza antes de asignar malla", _huge_poly)

# ---------- path containment ----------
base = Path("/Volumes/SSD/drone-vault").resolve()
evil = Path("/Volumes/SSD/drone-vault2/secret").resolve()
try:
    evil.relative_to(base)
    contained = True
except ValueError:
    contained = False
check("paths: drone-vault2 NO pasa el contención", not contained)

# ---------- SD importer: respaldo por stem + tamaño, no sólo nombre ----------
import aerobrain_server as _srv
_old_vault = _srv.VAULT
_sd_tmp = Path(tempfile.mkdtemp())
try:
    _srv.VAULT = _sd_tmp
    (_sd_tmp / "raw" / "DJI Flip").mkdir(parents=True)
    (_sd_tmp / "raw" / "DJI Flip" / "DJI_TEST.MP4").write_bytes(b"12345")
    (_sd_tmp / "raw" / "DJI Flip" / "DJI_PHOTO.JPG").write_bytes(b"abc")
    check("sd: find_raw exige tamaño cuando se pasa size",
          _srv.find_raw("DJI_TEST", 5) is not None and _srv.find_raw("DJI_TEST", 6) is None)
    check("sd: limpieza reconoce fotos respaldadas por nombre+tamaño",
          _srv._same_size_copy(_sd_tmp / "raw" / "DJI Flip" / "DJI_PHOTO.JPG") is not None)
finally:
    _srv.VAULT = _old_vault

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
q4 = splat_quality(FakeOut(700_000), "Step 1071: 0.1334 (15%)\nStep 1278: nan (18%)", 40, 7000)
check("splat: loss=nan (divergencia) FALLA el gate", not q4["passed"] and "divergió" in q4["reason"])
check("splat: final_loss ignora los nan y toma el último numérico", q4["final_loss"] == 0.1334)
q5 = splat_quality(FakeOut(700_000), "Step 100: 1.2e-1 (5%)", 40, 2000)
check("splat: entrenamiento incompleto FALLA aunque el archivo exista",
      not q5["passed"] and "incompleto" in q5["reason"] and q5["final_loss"] == 0.12)

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

# ---------- worker queue: enqueue / claim atómico / cancel / orphans por dueño ----------
jobs.DB = Path(tempfile.mkdtemp()) / "q.db"
jobs.init()
qj = jobs.enqueue("3d", "DJI_TEST", {"clip_id": "DJI_TEST"})
check("queue: enqueue deja status 'queued'", jobs.get(qj["id"])["status"] == "queued")
check("queue: pending() detecta el encolado", jobs.pending("3d", "DJI_TEST"))
c1 = jobs.claim(("3d", "splat"))
check("queue: claim devuelve el job y lo pone running", c1 and c1["status"] == "running")
check("queue: claim parsea el spec JSON", c1["spec"]["clip_id"] == "DJI_TEST")
c2 = jobs.claim(("3d", "splat"))
check("queue: segundo claim NO re-toma el mismo (atómico)", c2 is None)
# cancelar un job en cola: sin proceso, se marca cancelled limpio
qj2 = jobs.enqueue("splat", "DJI_Q2", {"clip_id": "DJI_Q2"})
check("queue: cancel de un 'queued' -> cancelled", jobs.cancel(qj2["id"]) and jobs.get(qj2["id"])["status"] == "cancelled")
# orphans por dueño: el server (light) NO debe marcar huérfano un 3D del worker
jobs.update(c1["id"], status="running")  # simula 3D corriendo en el worker
jobs.add("upload", "u1")  # un light running
_light = [r for r in jobs.recent() if r["kind"] == "upload"][0]["id"]
jobs.init(orphan_kinds=jobs.LIGHT_KINDS)  # reinicia el SERVER
check("orphans: restart del server NO mata el 3D del worker",
      jobs.get(c1["id"])["status"] == "running")
check("orphans: restart del server SÍ limpia sus light huérfanos",
      jobs.get(_light)["status"] == "error")
_heavy = jobs.add("3d", "worker-owned")
_hp = subprocess.Popen(["sleep", "30"], start_new_session=True)
jobs.update(_heavy["id"], pid=_hp.pid)
jobs.init(orphan_kinds=jobs.HEAVY_KINDS)  # reinicia el WORKER
try:
    _hp.wait(timeout=1)
    _heavy_gone = True
except subprocess.TimeoutExpired:
    _heavy_gone = False
    _hp.kill()
check("orphans: restart del worker mata proceso heavy huérfano",
      jobs.get(_heavy["id"])["status"] == "error" and _heavy_gone)

# --- viewer mesh re-centrado (audit P1: coords UTM rompen float32) ---
from tresd_publish import make_viewer_mesh
from tresd_publish import wgs84_area_m2, ply_vertex_count, find_copc_asset, find_texture_dir
_md = Path(tempfile.mkdtemp())
(_md / "geo.obj").write_text(
    "mtllib m.mtl\nv 500000.5 4500000.25 2550.0\nv 500002.5 4500002.25 2552.0\nf 1 2 1\n")
make_viewer_mesh(_md / "geo.obj", _md / "viewer.obj")
_vl = (_md / "viewer.obj").read_text().splitlines()
_verts = [ln.split()[1:] for ln in _vl if ln.startswith("v ")]
check("viewer mesh: vertices re-centrados cerca del origen",
      all(abs(float(c)) < 10 for v in _verts for c in v))
check("viewer mesh: caras y mtllib intactos",
      "f 1 2 1" in (_md / "viewer.obj").read_text() and "mtllib m.mtl" in (_md / "viewer.obj").read_text())
check("qa: área WGS84 fallback calcula una huella realista",
      12_000 < wgs84_area_m2([[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]]) < 13_000)
(_md / "cloud.ply").write_text("ply\nformat ascii 1.0\nelement vertex 12345\nend_header\n")
check("qa: PLY vertex count sale del header", ply_vertex_count(_md / "cloud.ply") == 12345)
(_md / "odm_georeferencing").mkdir()
(_md / "odm_georeferencing" / "odm_georeferenced_model.copc.laz").write_bytes(b"copc")
check("qa: publisher encuentra COPC de ODM si existe",
      find_copc_asset(_md).name == "odm_georeferenced_model.copc.laz")
(_md / "odm_texturing_25d").mkdir()
(_md / "odm_texturing_25d" / "odm_textured_model_geo.obj").write_text("v 0 0 0\n")
_tex_dir, _tex_mode = find_texture_dir(_md)
check("qa: publisher cae a odm_texturing_25d si OpenMVS full falla",
      _tex_dir.name == "odm_texturing_25d" and _tex_mode == "ortho_25d_fallback")

# --- capture intelligence ---
from capture_quality import sharpness, choose_frames, gps_metrics
from PIL import Image as _Img, ImageFilter as _ImF
_rng = np.random.default_rng(7)
_sharp_img = _Img.fromarray((_rng.random((240, 320)) * 255).astype("uint8"))
_blur_img = _sharp_img.filter(_ImF.GaussianBlur(6))
check("captura: imagen nítida puntúa más que borrosa",
      sharpness(_sharp_img) > sharpness(_blur_img) * 3)
_track = [{"t": i, "lon": -74.0 + i * 0.00005, "lat": 4.0, "rel_alt": 60} for i in range(0, 300)]
_times = [round(i + 0.5, 1) for i in range(0, 300)]
_sh = {t: 100.0 for t in _times}
_sel = choose_frames(_track, _times, _sh, "preview")
check("captura: presupuesto de frames respetado (preview <= 160)", 0 < len(_sel) <= 160)
_sh_blur = dict(_sh)
for t in _times[:80]:
    _sh_blur[t] = 1.0
_sel2 = choose_frames(_track, _times, _sh_blur, "balanced")
check("captura: los frames borrosos se descartan",
      all(x["t"] not in set(_times[:20]) for x in _sel2[:5]))
_gap_pts = [{"t": t, "lon": -74.0 + t * 0.0001, "lat": 4.0, "rel_alt": 50}
            for t in [0, 1, 2, 10, 11, 20, 21]]
check("captura: huecos GPS detectados", gps_metrics(_gap_pts)["gaps"] == 2)

# --- presets ODM del worker ---
import worker
check("presets: rapido..ultra definidos",
      set(worker.PRESETS) == {"rapido", "estandar", "alta", "extra", "ultra"})
check("presets: todos con pc-quality + timeout coherentes",
      all("--pc-quality" in p["args"] and p["timeout"] >= 3600 for p in worker.PRESETS.values()))
check("presets: alta es mas fina que rapido (ortho res)",
      int(worker.PRESETS["alta"]["args"][worker.PRESETS["alta"]["args"].index("--orthophoto-resolution") + 1])
      < int(worker.PRESETS["rapido"]["args"][worker.PRESETS["rapido"]["args"].index("--orthophoto-resolution") + 1]))
check("presets: alta prioriza dense estable sobre COPC crítico",
      "--pc-skip-geometric" in worker.PRESETS["alta"]["args"]
      and "--pc-copc" not in worker.PRESETS["alta"]["args"])
check("presets: ultra pesados tienen fallback de degradado",
      worker.PRESETS["ultra"]["fallback"] == "extra" and worker.PRESETS["extra"]["fallback"] == "alta")
check("presets: ultra usa pc-quality ultra + malla mas densa que alta",
      "ultra" in worker.PRESETS["ultra"]["args"]
      and int(worker.PRESETS["ultra"]["args"][worker.PRESETS["ultra"]["args"].index("--mesh-size") + 1])
      > int(worker.PRESETS["alta"]["args"][worker.PRESETS["alta"]["args"].index("--mesh-size") + 1]))
_ultra_cmd = worker.odm_cmd("odm-test", Path("/tmp/proj"), worker.PRESETS["ultra"])
check("presets: ultra baja concurrencia para aguantar frames premium en M4",
      _ultra_cmd[_ultra_cmd.index("--max-concurrency") + 1] == "2")
_alta_cmd = worker.odm_cmd("odm-test", Path("/tmp/proj"), worker.PRESETS["alta"])
check("presets: alta usa concurrencia 2 y geometric off en el camino principal",
      _alta_cmd[_alta_cmd.index("--max-concurrency") + 1] == "2"
      and "--pc-skip-geometric" in _alta_cmd)
check("presets: alta usa casi todo el presupuesto ODM del M4 para evitar sub-scene recovery",
      worker.PRESETS["alta"]["mem"] == "9500m")
_retry_preset = worker.openmvs_retry_preset(worker.PRESETS["extra"])
_retry_cmd = worker.odm_cmd("odm-test", Path("/tmp/proj"), _retry_preset,
                            rerun_from="openmvs", stable_dense=True)
check("presets: retry estable reinicia desde OpenMVS y desactiva geometric estimates",
      "--pc-skip-geometric" in _retry_cmd and "--rerun-from" in _retry_cmd
      and _retry_cmd[_retry_cmd.index("--rerun-from") + 1] == "openmvs")
check("presets: retry OpenMVS baja solo la presión dense sin degradar la salida alta",
      _retry_cmd[_retry_cmd.index("--pc-quality") + 1] == "medium"
      and _retry_cmd[_retry_cmd.index("--orthophoto-resolution") + 1] == "2"
      and _retry_cmd[_retry_cmd.index("--mesh-size") + 1] == "600000")
_old_vault = worker.VAULT
_odm_root = Path(tempfile.mkdtemp()) / "odm"
worker.VAULT = _odm_root.parent
_proj = _odm_root / "proj_TEST"
(_proj / "images").mkdir(parents=True)
(_proj / "images" / "f_0001.jpg").write_bytes(b"jpg")
(_proj / "opensfm").mkdir()
(_proj / "opensfm" / "reconstruction.json").write_text("stale")
(_proj / "odm_texturing").mkdir()
(_proj / "log.json").write_text("old")
(_proj / "frames_manifest.json").write_text("{}")
_removed = worker.clean_odm_outputs(_proj)
check("presets: fresh ODM rerun limpia outputs stale y conserva imágenes geotagged",
      "opensfm" in _removed and "odm_texturing" in _removed and "log.json" in _removed
      and (_proj / "images" / "f_0001.jpg").exists()
      and (_proj / "frames_manifest.json").exists())
worker.VAULT = _old_vault
_fast_cmd = worker.fast_ortho_cmd("odm-test", Path("/tmp/proj"))
check("presets: fallback ODM usa fast-orthophoto 25D desde georreferenciación",
      "--fast-orthophoto" in _fast_cmd and "--rerun-from" in _fast_cmd
      and _fast_cmd[_fast_cmd.index("--rerun-from") + 1] == "odm_georeferencing")
import odm_prep
check("prep: premium extrae más ancho que balanced sin llegar a 4K completo",
      odm_prep.PROFILE_WIDTH["premium"] > odm_prep.PROFILE_WIDTH["balanced"]
      and odm_prep.PROFILE_WIDTH["premium"] < 3840)
_cpu_backend = worker.choose_splat_backend(7000, mps_ready=False,
                                           mps_bin=Path("/tmp/opensplat-mps"),
                                           cpu_bin=Path("/tmp/opensplat-cpu"))
_gpu_backend = worker.choose_splat_backend(7000, mps_ready=True,
                                           mps_bin=Path("/tmp/opensplat-mps"),
                                           cpu_bin=Path("/tmp/opensplat-cpu"))
check("splat backend: CPU fallback conserva --cpu",
      "--cpu" in worker.opensplat_train_cmd(Path("/p"), Path("/o.splat"), 7000, _cpu_backend))
check("splat backend: Metal/MPS NO fuerza --cpu",
      "--cpu" not in worker.opensplat_train_cmd(Path("/p"), Path("/o.splat"), 7000, _gpu_backend)
      and _gpu_backend["device"] == "Metal/MPS")
check("splat backend: sh-degree-interval queda por encima de iters",
      worker.opensplat_train_cmd(Path("/p"), Path("/o.splat"), 7000, _gpu_backend)[-1] == "7001")
check("splat backend: entrena con QoS utility (UI fluida durante 4h de CPU)",
      worker.opensplat_train_cmd(Path("/p"), Path("/o.splat"), 7000, _cpu_backend)[:3]
      == ["/usr/sbin/taskpolicy", "-c", "utility"])
import browser_gate
check("browser gate: default usa 127.0.0.1 para evitar localhost IPv6 ajeno",
      browser_gate.DEFAULT_BASE_URL == "http://127.0.0.1:8790"
      and browser_gate.CHROME.name == "Google Chrome"
      and browser_gate.QA_DIR.name == "qa")

# --- splat publish: stage -> atomic public artifact ---
_spdir = Path(tempfile.mkdtemp())
_stage = _spdir / ".training" / "job1"
_stage.mkdir(parents=True)
(_spdir / "DJI_ATOMIC.splat").write_bytes(b"old-good")
(_stage / "DJI_ATOMIC.splat").write_bytes(b"new-good")
(_stage / "cameras.json").write_text("{}")
try:
    worker.publish_splat_stage(_stage, "DJI_ATOMIC", {"passed": False, "reason": "bad"}, _spdir)
    _blocked = False
except RuntimeError:
    _blocked = True
check("splat publish: quality fail NO pisa el splat existente",
      _blocked and (_spdir / "DJI_ATOMIC.splat").read_bytes() == b"old-good")
_stage.mkdir(parents=True, exist_ok=True)
(_stage / "DJI_ATOMIC.splat").write_bytes(b"new-good")
(_stage / "cameras.json").write_text("{}")
worker.publish_splat_stage(_stage, "DJI_ATOMIC", {"passed": True, "final_loss": 0.1}, _spdir)
check("splat publish: pass promueve splat/meta/cameras por proyecto",
      (_spdir / "DJI_ATOMIC.splat").read_bytes() == b"new-good"
      and (_spdir / "DJI_ATOMIC.meta.json").exists()
      and (_spdir / "DJI_ATOMIC.cameras.json").exists()
      and not _stage.exists())

# --- system manifest: sólo cuenta formatos visualizables como splats ---
import build_index as _bi
_old_bi_vault = _bi.VAULT
_bi_tmp = Path(tempfile.mkdtemp())
try:
    _bi.VAULT = _bi_tmp
    for d in ("manifest", "raw", "proxies", "frames", "thumbs", "tracks", "reels", "splats", "models", "ai"):
        (_bi_tmp / d).mkdir(parents=True, exist_ok=True)
    (_bi_tmp / "splats" / "A.splat").write_bytes(b"1")
    (_bi_tmp / "splats" / "A.ksplat").write_bytes(b"2")
    (_bi_tmp / "splats" / "A.meta.json").write_bytes(b"{}")
    (_bi_tmp / "splats" / "A.cameras.json").write_bytes(b"{}")
    (_bi_tmp / "splats" / "B.ply").write_bytes(b"3")
    _bi.main()
    _sys = json.loads((_bi_tmp / "manifest" / "system.json").read_text())
    # contrato: UNA entrada por clip, gana el mejor formato (.ksplat > .splat > .ply);
    # sidecars (.meta.json/.cameras.json) nunca cuentan como splats
    check("system: splats dedupe por clip, mejor formato gana",
          [s["name"] for s in _sys["splats"]] == ["A.ksplat", "B.ply"])
    check("system: splats declaran clip_id + formato",
          [(s["clip_id"], s["format"]) for s in _sys["splats"]] == [("A", "ksplat"), ("B", "ply")])
finally:
    _bi.VAULT = _old_bi_vault

print(f"\n{'FALLARON: ' + ', '.join(FAILS) if FAILS else 'TODOS LOS TESTS PASAN'}")
sys.exit(1 if FAILS else 0)
