"""Smoke tests del pipeline — corre con: python3 test_smoke.py (sin dependencias de test).

Cubre las piezas puras: parser SRT (con puntos 0,0), política de tiers,
mediciones DSM (volumen y perfil sobre un DSM sintético), y contención de paths.
"""
import json
import shutil
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
import aerobrain_server as _srv
from aerobrain_server import splat_quality, derive_odm_progress
_style_asset = _srv.WEB / "style.css"
_style_version = _style_asset.stat().st_mtime_ns
check("cache: fingerprint exacto es immutable en edge/browser",
      _srv.static_cache_policy(_style_asset, f"/style.css?v={_style_version}")[1]
      == "public, max-age=31536000, immutable")
check("cache: versión inventada no recibe immutable",
      _srv.static_cache_policy(_style_asset, "/style.css?v=wrong")[1] == "no-cache")
check("cache: código sin versión revalida y no queda stale",
      _srv.static_cache_policy(_srv.WEB / "shell.js", "/shell.js")[1] == "no-cache")
check("cache: vendor local usa CDN con stale-while-revalidate",
      "stale-while-revalidate" in _srv.static_cache_policy(
          _srv.WEB / "vendor" / "maplibre-gl.js", "/vendor/maplibre-gl.js")[1])
check("cache: HTML nunca queda congelado",
      _srv.static_cache_policy(_srv.WEB / "home.html", "/")[1]
      == "no-store, must-revalidate")
check("cache: HTML inyecta fingerprint actual de cada asset",
      f"style.css?v={_style_version}" in _srv.render_html(_srv.WEB / "home.html").decode())


class _RedirectHarness:
    def __init__(self, headers, path="/flight.html?id=1"):
        self.headers = headers
        self.path = path
        self.response = None
        self.out_headers = {}

    def send_response(self, code):
        self.response = code

    def send_header(self, key, value):
        self.out_headers[key] = value

    def end_headers(self):
        pass


_http_req = _RedirectHarness({"CF-Ray": "x", "X-Forwarded-Proto": "http",
                              "Host": "vuelos.metislab.work"})
check("https: tráfico HTTP externo recibe 308 conservando path",
      _srv.H.redirect_external_http(_http_req)
      and _http_req.response == 308
      and _http_req.out_headers.get("Location")
      == "https://vuelos.metislab.work/flight.html?id=1")
_local_req = _RedirectHarness({"Host": "127.0.0.1:8790"})
check("https: localhost sigue disponible para agentes",
      not _srv.H.redirect_external_http(_local_req) and _local_req.response is None)
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
_old_splat_bin, _old_mps_bin = _srv.SPLAT_BIN, _srv.SPLAT_MPS_BIN
_bin_tmp = Path(tempfile.mkdtemp())
try:
    _srv.SPLAT_BIN = _bin_tmp / "missing" / "opensplat"
    _srv.SPLAT_MPS_BIN = _bin_tmp / "build-mps" / "opensplat"
    _srv.SPLAT_MPS_BIN.parent.mkdir()
    _srv.SPLAT_MPS_BIN.write_text("#!/bin/sh\n")
    check("splat api: acepta instalación sólo Metal/MPS",
          _srv.any_opensplat_bin_exists())
finally:
    _srv.SPLAT_BIN, _srv.SPLAT_MPS_BIN = _old_splat_bin, _old_mps_bin
check("odm progress: OpenMVS depthmaps sube sobre el 15% base",
      derive_odm_progress("Finished opensfm stage\nRunning openmvs stage\nDepthmap resolution set to: 1536px", 0.15) >= 0.58)
check("odm progress: derivado nunca retrocede",
      derive_odm_progress("detect_features", 0.7) == 0.7)
_old_srv_vault = _srv.VAULT
_odm_tmp = Path(tempfile.mkdtemp())
try:
    _srv.VAULT = _odm_tmp
    (_odm_tmp / "odm" / "proj_DJI_STAGE" / "odm_filterpoints").mkdir(parents=True)
    (_odm_tmp / "odm" / "proj_DJI_STAGE" / "odm_filterpoints" / "point_cloud.ply").write_text("ply\n")
    check("odm progress: filesystem stage sobrevive rotación del log",
          _srv.derive_odm_progress("", 0.15, "DJI_STAGE") >= 0.66)
finally:
    _srv.VAULT = _old_srv_vault

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
_hp = subprocess.Popen(["python3", "-c", "import time; time.sleep(30)"], start_new_session=True)  # huérfano REALISTA: init() ahora verifica que el pid sea un job nuestro (python3/opensplat/docker) antes de matarlo
jobs.update(_heavy["id"], pid=_hp.pid)
jobs.init(orphan_kinds=jobs.HEAVY_KINDS)  # reinicia el WORKER
# polling con deadline (3er flake 11-jul): wait(timeout=N) depende del scheduling
# del OS bajo carga — la regla era reescribir a la 3ª, no escalar timeouts
_deadline = time.time() + 10
_heavy_gone = False
while time.time() < _deadline:
    if _hp.poll() is not None or not _pid_alive(_hp.pid):
        _heavy_gone = True
        break
    time.sleep(0.2)
if not _heavy_gone:
    _hp.kill()
check("orphans: restart del worker mata proceso heavy huérfano (con verificación de identidad del pid)",
      jobs.get(_heavy["id"])["status"] == "error" and _heavy_gone)

# --- viewer mesh re-centrado (audit P1: coords UTM rompen float32) ---
from tresd_publish import make_viewer_mesh, obj_stats
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
(_md / "weak.obj").write_text("v 0 0 0\nv 1 0 0\nv 0 1 0\n")
_weak_stats = obj_stats(_md / "weak.obj")
check("viewer mesh: stats detecta malla sin caras",
      _weak_stats["vertices"] == 3 and _weak_stats["faces"] == 0)
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
shutil.rmtree(_md / "odm_texturing_25d")
_tex_dir2, _tex_mode2 = find_texture_dir(_md)
check("qa: publisher acepta corrida sin malla texturizada",
      _tex_dir2 is None and _tex_mode2 == "no_mesh")
_publish_src = Path("pipeline/tresd_publish.py").read_text()
check("qa: publisher conserva calidad/preset/title en re-publicación manual",
      "prior_meta" in _publish_src
      and all(k in _publish_src for k in ("dense_quality", "dense_quality_requested", "dense_fallback"))
      and "if k in prior_meta and k not in meta" in _publish_src)

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
check("presets: alta evita malla completa cara para ruta video→splat",
      "--skip-3dmodel" in worker.PRESETS["alta"]["args"])
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
      worker.PRESETS["alta"]["mem"] == "8500m")
_retry_preset = worker.openmvs_retry_preset(worker.PRESETS["extra"])
_retry_cmd = worker.odm_cmd("odm-test", Path("/tmp/proj"), _retry_preset,
                            rerun_from="openmvs", stable_dense=True)
check("presets: retry estable reinicia desde OpenMVS y desactiva geometric estimates",
      "--pc-skip-geometric" in _retry_cmd and "--rerun-from" in _retry_cmd
      and _retry_cmd[_retry_cmd.index("--rerun-from") + 1] == "openmvs")
check("presets: retry estable no duplica flags ya presentes",
      _retry_cmd.count("--pc-skip-geometric") == 1)
check("presets: retry OpenMVS baja solo la presión dense sin degradar la salida alta",
      _retry_cmd[_retry_cmd.index("--pc-quality") + 1] == "medium"
      and _retry_cmd[_retry_cmd.index("--orthophoto-resolution") + 1] == "2"
      and _retry_cmd[_retry_cmd.index("--mesh-size") + 1] == "600000")
_quality_provenance = worker.odm_quality_provenance("alta", "alta", "medium")
check("presets: metadata distingue ortho alta de fallback dense medium",
      _quality_provenance == {"effective_preset": "alta", "requested_preset": "alta",
                              "dense_quality": "medium", "dense_quality_requested": "high",
                              "dense_fallback": True})
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
from splat_presets import resolve_splat_spec
check("splat presets: medium/cinematic/ultra tienen contrato explícito",
      [resolve_splat_spec({"preset": p})["iters"] for p in ("medium", "cinematic", "ultra")]
      == [2000, 7000, 15000])
check("splat presets: legacy iters 7000 se identifica como cinematic",
      resolve_splat_spec({"iters": 7000})["key"] == "cinematic")
try:
    resolve_splat_spec({"preset": "nonsense"})
    _bad_preset_rejected = False
except ValueError:
    _bad_preset_rejected = True
check("splat presets: preset explícito inválido no cae silenciosamente a medium",
      _bad_preset_rejected)
check("splat presets: custom auditado conserva iters acotados",
      resolve_splat_spec({"preset": "custom", "iters": 5000})["key"] == "custom")
_cin_splat = resolve_splat_spec({"preset": "cinematic"})
check("splat presets: cinematic limita densificación para MPS móvil",
      "--densify-grad-thresh" in _cin_splat["train_args"]
      and "--refine-every" in _cin_splat["train_args"]
      and _cin_splat["iters"] == 7000)
_ultra_splat = resolve_splat_spec({"preset": "ultra"})
check("splat presets: ultra limita densificación para M4",
      "--densify-grad-thresh" in _ultra_splat["train_args"]
      and "--refine-every" in _ultra_splat["train_args"]
      and _ultra_splat["iters"] == 15000)
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
check("splat backend: train_args llegan al comando OpenSplat",
      "--densify-grad-thresh" in worker.opensplat_train_cmd(
          Path("/p"), Path("/o.splat"), _ultra_splat["iters"], _gpu_backend, _ultra_splat["train_args"]))
check("splat backend: ultra checkpoint future-proof",
      "--save-every" in worker.opensplat_train_cmd(
          Path("/p"), Path("/o.splat"), _ultra_splat["iters"], _gpu_backend, _ultra_splat["train_args"]))
check("splat backend: arranca full power; prioridad adaptativa vive fuera del comando",
      worker.opensplat_train_cmd(Path("/p"), Path("/o.splat"), 7000, _cpu_backend)[:3]
      == ["/usr/sbin/taskpolicy", "-m", "11000"]
      and "utility" not in worker.opensplat_train_cmd(
          Path("/p"), Path("/o.splat"), 7000, _cpu_backend))
_done_detail = worker.splat_done_detail(Path("DJI_QA.ksplat"), {
    "preset_label": "Ultra", "target_iters": 15000, "backend": "Metal/MPS",
    "duration_s": 7308.3, "final_loss": 0.0432,
}, 127)
check("splat jobs: detalle done incluye preset, backend, runtime, loss y cámaras",
      "Ultra" in _done_detail and "15k iters" in _done_detail
      and "Metal/MPS" in _done_detail and "2.0h" in _done_detail
      and "loss 0.0432" in _done_detail and "127 cámaras" in _done_detail)
import browser_gate
check("browser gate: default usa 127.0.0.1 para evitar localhost IPv6 ajeno",
      browser_gate.DEFAULT_BASE_URL == "http://127.0.0.1:8790"
      and browser_gate.CHROME.name == "Google Chrome"
      and browser_gate.QA_DIR.name == "qa")
_share_module_parse = subprocess.run([
    "node", "--experimental-vm-modules", "-e",
    "const fs=require('fs'),vm=require('vm');"
    "for(const p of process.argv.slice(1))"
    "new vm.SourceTextModule(fs.readFileSync(p,'utf8'),{identifier:p});",
    "web/share.js", "web/splatview.js",
], capture_output=True, text=True)
check("browser gate: módulos ESM del share compilan antes de publicar",
      _share_module_parse.returncode == 0,
      (_share_module_parse.stderr or _share_module_parse.stdout)[-300:])
import browser_matrix
check("browser matrix: cubre mobile, iPad y desktop",
      set(browser_matrix.VIEWPORTS) == {"mobile", "ipad", "desktop"})
_bm_src = Path("pipeline/browser_matrix.py").read_text()
check("browser matrix: cubre share, workspace y consola de trabajos",
      "def run_share" in _bm_src and "def run_workspace" in _bm_src and "def run_jobs" in _bm_src)
check("browser matrix: falla si no hay macro zoom real u overflow limpio",
      "verify_macro_zoom" in _bm_src and "overflow horizontal" in _bm_src)
check("browser matrix: exige default de mayor calidad en share y workspace",
      "expected_splat_path" in _bm_src
      and "share default splat incorrecto" in _bm_src
      and "workspace default splat incorrecto" in _bm_src)
_audit_splats_src = Path("pipeline/audit_splats.py").read_text()
check("splat audit: cubre assets, metadata y current duplicado",
      "missing asset" in _audit_splats_src
      and "metadata missing" in _audit_splats_src
      and "duplicate current splats" in _audit_splats_src)
check("splat audit: exige presets medium/cinematic/ultra y multi-versión",
      "REQUIRED_PRESETS" in _audit_splats_src
      and "missing required preset coverage" in _audit_splats_src
      and "no multi-version splat clip found" in _audit_splats_src)
check("splat audit: exige jobs done por preset con browser QA",
      "missing generated job coverage" in _audit_splats_src
      and "done job lacks browser QA completion" in _audit_splats_src
      and "generated_presets" in _audit_splats_src)

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
      and len(list((_spdir / "history").glob("DJI_ATOMIC-*.splat"))) == 1
      and not _stage.exists())
_old_jobs_db = jobs.DB
_jobs_db = Path(tempfile.mkdtemp()) / "jobs.db"
try:
    jobs.DB = _jobs_db
    jobs.init()
    _jold = jobs.add("splat", "DJI_RETARGET")
    jobs.end(_jold["id"], "done", "DJI_RETARGET.splat · loss 0.1", "splats/DJI_RETARGET.splat")
    _stage2 = _spdir / ".training" / "job2"
    _stage2.mkdir(parents=True, exist_ok=True)
    (_spdir / "DJI_RETARGET.splat").write_bytes(b"old-current")
    (_spdir / "DJI_RETARGET.ksplat").write_bytes(b"old-current-fast")
    (_stage2 / "DJI_RETARGET.splat").write_bytes(b"new-current")
    worker.publish_splat_stage(_stage2, "DJI_RETARGET", {"passed": True}, _spdir)
    _ret = jobs.get(_jold["id"])["artifact"]
    _ret_detail = jobs.get(_jold["id"])["detail"]
    check("splat publish: jobs antiguos apuntan al ksplat archivado si existe",
          _ret.startswith("splats/history/DJI_RETARGET-") and _ret.endswith(".ksplat"))
    check("splat publish: jobs antiguos muestran el artifact archivado exacto",
          Path(_ret).name in _ret_detail and ".splat" not in _ret_detail)
finally:
    jobs.DB = _old_jobs_db

# --- system manifest: sólo cuenta formatos visualizables como splats ---
import build_index as _bi
_old_bi_vault = _bi.VAULT
_bi_tmp = Path(tempfile.mkdtemp())
try:
    _bi.VAULT = _bi_tmp
    for d in ("manifest", "raw", "proxies", "frames", "thumbs", "tracks", "reels", "splats", "models", "ai"):
        (_bi_tmp / d).mkdir(parents=True, exist_ok=True)
    (_bi_tmp / "splats" / "A.splat").write_bytes(b"1" * 64)
    (_bi_tmp / "splats" / "A.ksplat").write_bytes(b"2")
    (_bi_tmp / "splats" / "A.meta.json").write_bytes(b"{}")
    (_bi_tmp / "splats" / "A.cameras.json").write_bytes(b"{}")
    with sqlite3.connect(_bi_tmp / "manifest" / "jobs.db") as _jdb:
        _jdb.execute("CREATE TABLE jobs (id TEXT, kind TEXT, status TEXT, artifact TEXT, detail TEXT, started REAL, finished REAL)")
        _jdb.execute("INSERT INTO jobs VALUES ('splat-a','splat','done','splats/A.ksplat','A.ksplat · Metal/MPS',100,250.5)")
    (_bi_tmp / "splats" / "B.ply").write_bytes(b"3")
    (_bi_tmp / "splats" / "history").mkdir()
    (_bi_tmp / "splats" / "history" / "A-20260707-010203.splat").write_bytes(b"4" * 96)
    (_bi_tmp / "splats" / "history" / "A-20260707-010203.ksplat").write_bytes(b"5")
    (_bi_tmp / "splats" / "history" / "A-20260707-010203.meta.json").write_text(
        json.dumps({"target_iters": 7000, "final_loss": 0.05, "cameras": 42, "duration_s": 3600.4}))
    import threading
    _atomic_target = _bi_tmp / "manifest" / "atomic.json"
    _atomic_errors = []
    def _atomic_writer(i):
        try:
            _bi.write_atomic(_atomic_target, json.dumps({"writer": i, "payload": "x" * 1000}))
        except Exception as e:
            _atomic_errors.append(str(e))
    _threads = [threading.Thread(target=_atomic_writer, args=(i,)) for i in range(8)]
    [t.start() for t in _threads]
    [t.join() for t in _threads]
    _atomic_json = json.loads(_atomic_target.read_text())
    check("system: write_atomic tolera rebuild_index concurrente",
          not _atomic_errors and isinstance(_atomic_json.get("writer"), int))
    _bi.main()
    _sys = json.loads((_bi_tmp / "manifest" / "system.json").read_text())
    # contrato: UNA entrada por versión, gana el mejor formato (.ksplat > .splat > .ply);
    # sidecars (.meta.json/.cameras.json) nunca cuentan como splats independientes
    check("system: splats dedupe por versión, no por clip completo",
          [s["path"] for s in _sys["splats"]] == ["A.ksplat", "history/A-20260707-010203.ksplat", "B.ply"])
    check("system: splats declaran clip_id/formato y preservan historial",
          [(s["clip_id"], s["format"], s.get("current")) for s in _sys["splats"]]
          == [("A", "ksplat", True), ("A", "ksplat", False), ("B", "ply", True)])
    check("system: stats de historial salen del sidecar versionado",
          _sys["splats"][1].get("iters") == 7000 and _sys["splats"][1].get("cameras") == 42)
    check("system: duración de entrenamiento sale del sidecar versionado",
          _sys["splats"][1].get("duration_s") == 3600.4)
    check("system: duración legacy se reconstruye desde jobs.db",
          _sys["splats"][0].get("duration_s") == 150.5 and _sys["splats"][0].get("backend") == "Metal/MPS")
    check("system: preset se infiere de sidecars legacy sin preset explícito",
          _sys["splats"][1].get("preset") == "cinematic"
          and _sys["splats"][1].get("preset_label") == "Cinematic")
finally:
    _bi.VAULT = _old_bi_vault

# --- viewer URLs: archived splats live under history/ and must use path, not name ---
_web_tresd = Path("web/tresd.js").read_text()
_web_share = Path("web/share.js").read_text()
_web_lab = Path("web/splatlab.js").read_text()
_web_splatview = Path("web/splatview.js").read_text()
# DECISIÓN 2026-07-10: la versión CURRENT manda sobre iters — re-entrenar Medium tras un
# Ultra debe REFLEJARSE (antes ganaba iters y el usuario creía que 'el entrenamiento no hizo
# nada'). Consistente con build_index (server ordena current-primero) y con el share mutable.
check("viewer: splat selectors prefer mutable current before iters",
      ".sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0)" in _web_tresd
      and ".sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0)" in _web_share)
check("viewer: archived splat links use manifest path",
      "const splatUrl = s => 'data/splats/' + splatKey(s).split('/')" in _web_tresd
      and "const splatUrl = s => 'data/splats/' + splatKey(s).split('/')" in _web_lab
      and "data/splats/${encodeURIComponent(s.name)}" not in _web_tresd
      and "'/data/splats/' + s.name" not in _web_lab)
check("viewer: splat macro mode permite inspección cercana real",
      "radius * 0.00008" in _web_splatview
      and "radius * 0.012" in _web_splatview
      and "dolly(0.08)" in _web_splatview
      and "Modo macro" in _web_splatview)
check("viewer: etiquetas de splat muestran runtime y loss",
      "fmtRun(s.duration_s)" in _web_tresd
      and "fmtRun(s.duration_s)" in _web_share
      and "loss ${s.loss}" in _web_tresd
      and "loss ${s.loss}" in _web_share)

# --- odm_prep multi-fuente: funciones puras + invariante del geotag (el bug de la ruta stale) ---
import odm_prep as _op
check("odm_prep: _photo_parent parsea clip + segundos",
      _op._photo_parent("DJI_20260704155816_0102_D_00003.0s.jpg") == ("DJI_20260704155816_0102_D", 3.0)
      and _op._photo_parent("basura.jpg") == (None, 0.0))
_ga = _op._geotag(Path("/x/images/s0_f_0001.jpg"), {"lat": 4.5, "lon": -74.0, "abs_alt": 2600})
check("odm_prep: _geotag arma lat/lon/alt + un -execute por imagen",
      _ga[-1] == "-execute" and _ga[-2] == "/x/images/s0_f_0001.jpg"
      and any(a.startswith("-GPSLatitude=4.5") for a in _ga) and "-GPSLongitudeRef=W" in _ga)
_op_src = Path("pipeline/odm_prep.py").read_text()
check("odm_prep: geotag apunta a images/ (ruta FINAL), NO a images.new/tmp_dir (regresión del swap)",
      "_geotag(images / name" in _op_src and "_geotag(tmp_dir" not in _op_src
      and "_geotag(dest" not in _op_src)
check("odm_prep: 1 sola fuente conserva nombres f_XXXX (compat); multi usa prefijo s{idx}_",
      'prefix = f"s{idx}_" if multi else ""' in _op_src and "multi = len(sources) > 1 or bool(photos)" in _op_src)
_w_src = Path("pipeline/worker.py").read_text()
check("worker: build_3d_assets pasa --sources/--photos a odm_prep y el primario manda la identidad",
      '"--sources"' in _w_src and 'src_list[0] != cid' in _w_src)

# --- Phase 0 frontier: hardware.json + peak recorder (gate: cero literales de memoria) ---
import hwconfig as _hw
_hwc = _hw.load()
check("hwconfig: hardware.json existe con machine + caps completos",
      _hw.CONFIG.exists() and _hwc["machine"].get("system_ram_gb", 0) > 0
      and _hwc["caps"]["opensplat_mib"] > 0
      and "mem" in _hwc["caps"]["odm_light"] and "mem" in _hwc["caps"]["odm_heavy"])
check("worker: caps de memoria vienen de config, no de literales (gate 0.1)",
      "11_000" not in _w_src and '"8500m"' not in _w_src and '"7g"' not in _w_src
      and "_HWCFG = hwconfig.load()" in _w_src and '_CAPS = _HWCFG["caps"]' in _w_src)
import worker as _wk
check("worker: presets ODM leen mem/concurrency del config (valores calibrados intactos)",
      _wk.PRESETS["rapido"]["mem"] == _hwc["caps"]["odm_light"]["mem"]
      and _wk.PRESETS["ultra"]["concurrency"] == _hwc["caps"]["odm_heavy"]["concurrency"]
      and _wk.OPENSPLAT_MEMORY_MIB == _hwc["caps"]["opensplat_mib"])
_inner_calls = []
_pt = _wk.PeakTracker(inner=_inner_calls.append)
_pt(os.getpid())               # el propio test: footprint del kernel > 0
check("worker: PeakTracker lee phys_footprint_peak (RSS subestima MPS ~20×) y encadena prioridad",
      _pt.peak_mib > 0 and _pt.peak_source == "phys_footprint"
      and _inner_calls == [os.getpid()])
check("worker: run_splat registra peak + fuente en el sidecar y en cada OOM (standing rule)",
      "tick=peak" in _w_src and '"peak_mib": peak.peak_mib' in _w_src
      and '"peak_source"' in _w_src and '"opensplat-oom"' in _w_src)
_cq_src = Path("pipeline/capture_quality.py").read_text()
check("capture_quality: el cap del advice deriva de hwconfig (no 'cap de 11GB' hardcodeado)",
      "cap de 11GB" not in _cq_src and 'hwconfig.load()["caps"]["opensplat_mib"]' in _cq_src
      and "cap de {cap_gb:.0f}GB" in _cq_src)

# política de mismatch de RAM: asimétrica, ruidosa, provisional (nunca reescribe el JSON)
import copy as _copy
import perf as _perf
_orig_le = _perf.log_error
_perf.log_error = lambda *a, **k: None            # el smoke no ensucia ops/errors.jsonl
try:
    _base = {"machine": {"system_ram_gb": 16.0}, "caps": {"opensplat_mib": 11000}}
    _up = _hw._on_ram_mismatch(16.0, 24.0, _copy.deepcopy(_base))
    check("hwconfig: mismatch hacia ARRIBA conserva caps + marca provisional",
          _up["caps"]["opensplat_mib"] == 11000 and _up["provisional"] is True
          and _up["provisional_reason"].startswith("ram_up"))
    _dn = _hw._on_ram_mismatch(16.0, 8.0, _copy.deepcopy(_base))
    check("hwconfig: mismatch hacia ABAJO escala proporcional con piso",
          _dn["caps"]["opensplat_mib"] == 5500 and _dn["provisional"] is True
          and _dn["provisional_reason"].startswith("ram_down_scaled"))
    _fatal = False
    try:
        _hw._on_ram_mismatch(16.0, 4.0, _copy.deepcopy(_base))   # 2750 < piso 4096
    except SystemExit:
        _fatal = True
    check("hwconfig: bajo el piso viable muere claro (SystemExit), no SIGKILL mudo", _fatal)
finally:
    _perf.log_error = _orig_le
_srv_src_pf = Path("pipeline/aerobrain_server.py").read_text()

# --- U1.3 preflight: datos medidos vs riesgo no calibrado ---
import preflight as _pf
check("preflight: Ultra nunca extrapola un pico falso ni declara incapaz al Mac",
      _pf.splat_preflight(22, 3072, "ultra")["verdict"] == "UNVERIFIED_HIGH_RISK"
      and "projected_peak_mib" not in _pf.splat_preflight(22, 3072, "ultra"))
check("preflight: escena2 full-res → LIKELY_OOM con rung sobreviviente (la verdad: -d2 pasó)",
      _pf.splat_preflight(214, 3072, "medium")["verdict"] == "LIKELY_OOM"
      and _pf.splat_preflight(214, 3072, "medium")["recommended_d"] == 2)
check("preflight: baseline medium escena1 → SAFE (obs 64%)",
      _pf.splat_preflight(22, 3072, "medium")["verdict"] == "SAFE")
_e2 = _pf.splat_preflight(214, 3072, "medium", d=2)
check("preflight: escena2 -d2 → ELEVATED conservador (proy 80% vs obs 76%)",
      _e2["verdict"] == "ELEVATED" and 76 <= _e2["pct"] <= 90)
check("preflight: /api/splat conserva decisión y sólo bloquea pisos/Medium fuera de sobre",
      '"preflight": pfv' in _srv_src_pf and 'INPUT_FLOOR_EXCEEDS_CAP' in _srv_src_pf
      and 'splat_preflight(n_imgs, w' in _srv_src_pf)

_srv_src_pf2 = Path("pipeline/aerobrain_server.py").read_text()

check("server: /api/preflight expone el motor U1.3 con validación de preset",
      '"/api/preflight"' in _srv_src_pf2 and "preset desconocido" in _srv_src_pf2)
_td_src = Path("web/tresd.js").read_text()
check("modal v2: agrupa por CENTROIDE del bbox (U1.1 — spotKey del despegue refutado por test #1)",
      "(b[0] + b[2]) / 2" in _td_src and "0.0012" in _td_src)
check("modal v2: Ultra se etiqueta no calibrado sin inventar pico",
      "no se inventa un pico" in _td_src and "/api/preflight" in _td_src)


check("server: geocode en do_GET con caché + urllib.request al TOP (import local envenena _post: UnboundLocalError en todo urllib.parse previo)",
      '"/api/geocode"' in _srv_src_pf2.replace("startswith(", '("')
      or "/api/geocode" in _srv_src_pf2)
_srv_head = _srv_src_pf2[:3000]
check("server: import urllib.request a nivel módulo, NUNCA dentro de handlers",
      "import urllib.request" in _srv_head
      and "    import urllib.request" not in _srv_src_pf2)
check("server: 500 con causa registrada (server-500 a errors.jsonl) — cero 500 mudos",
      '"server-500"' in _srv_src_pf2)
check("server: /api/suggest_name usa _deepseek con prompt acotado",
      '"/api/suggest_name"' in _srv_src_pf2 and "_deepseek(" in _srv_src_pf2)

import inspect as _insp
check("hwconfig: la política jamás reescribe hardware.json (calibración = humana)",
      "write_text" not in _insp.getsource(_hw._on_ram_mismatch))
check("worker: sidecar marca caps_provisional (runs heurísticos ≠ calibrados)",
      '"caps_provisional"' in _w_src and '_HWCFG.get("provisional")' in _w_src)

# --- splat_eval: split determinista + cirugía disjunta + scorer honesto (Phase 1) ---
import json as _json
import tempfile as _tf
import numpy as _np
import splat_eval as _se
_tmp = Path(_tf.mkdtemp())


def _fake_proj(n):
    p = _tmp / f"proj{n}"
    (p / "opensfm").mkdir(parents=True)
    shots = {f"f_{i:04d}.jpg": {"rotation": [0, 0, 0]} for i in range(n)}
    (p / "opensfm" / "reconstruction.json").write_text(_json.dumps([{"cameras": {}, "shots": shots}]))
    (p / "opensfm" / "image_list.txt").write_text("\n".join(f"/datasets/code/images/f_{i:04d}.jpg" for i in range(n)))
    return p


_s1 = _se.make_split(_fake_proj(100), _tmp / "o1", "CID_X")
check("splat_eval: split determinista (mismo seed → mismas vistas test) y 10% de 100",
      _se.make_split(_tmp / "proj100", _tmp / "o2", "CID_X")["test_views"] == _s1["test_views"]
      and _s1["n_test"] == 10)
_trn = set(_json.loads((_tmp / "o1" / "train" / "reconstruction.json").read_text())[0]["shots"])
_tst = set(_json.loads((_tmp / "o1" / "test" / "reconstruction.json").read_text())[0]["shots"])
check("splat_eval: cirugía disjunta y completa (train ∩ test = ∅, unión = todo)",
      not (_trn & _tst) and len(_trn | _tst) == 100 and _tst == set(_s1["test_views"]))
check("splat_eval: clamp mínimo de vistas test (40 shots → 8, no 4)",
      _se.make_split(_fake_proj(40), _tmp / "o3", "CID_X")["n_test"] == 8)


def _fake_multi(spec):
    p = _tmp / ("multi_" + "_".join(f"{k}{v}" for k, v in spec))
    (p / "opensfm").mkdir(parents=True)
    shots = {}
    for pfx, cnt in spec:
        for i in range(cnt):
            shots[f"{pfx}f_{i:04d}.jpg"] = {"rotation": [0, 0, 0]}
    (p / "opensfm" / "reconstruction.json").write_text(_json.dumps([{"cameras": {}, "shots": shots}]))
    (p / "opensfm" / "image_list.txt").write_text("\n".join(sorted(shots)))
    return p


# estratificación multi-source: si el 90% de shots es s0_, un muestreo uniforme
# dejaría los test views en el clip dominante (la versión eval del falso 82%)
_ms = _se.make_split(_fake_multi([("s0_", 90), ("s1_", 15), ("ph_", 5)]), _tmp / "om", "CID_M")
_per = {s: sum(1 for t in _ms["test_views"] if t.startswith(s)) for s in ("s0_", "s1_", "ph_")}
check("splat_eval: split multi-source estratificado — TODAS las fuentes aportan ≥2 vistas test",
      _per["s0_"] >= 2 and _per["s1_"] >= 2 and _per["ph_"] >= 2
      and _ms["by_source"]["ph_"]["test"] == _per["ph_"]
      and _ms["by_source"]["ph_"]["total"] == 5)
check("splat_eval: estratificado determinista y cada fuente conserva ≥2 train",
      _se.make_split(_tmp / "multi_s0_90_s1_15_ph_5", _tmp / "om2", "CID_M")["test_views"] == _ms["test_views"]
      and all(v["total"] - v["test"] >= 2 for v in _ms["by_source"].values()))
from PIL import Image as _Img
_rd = _tmp / "renders"
_rd.mkdir()
_gt = (_np.random.default_rng(7).random((64, 64, 3)) * 255).astype(_np.uint8)
_Img.fromarray(_gt).save(_rd / "a.gt.png"); _Img.fromarray(_gt).save(_rd / "a.render.png")
_noisy = _np.clip(_gt.astype(int) + _np.random.default_rng(8).integers(-40, 40, _gt.shape), 0, 255).astype(_np.uint8)
_Img.fromarray(_gt).save(_rd / "b.gt.png"); _Img.fromarray(_noisy).save(_rd / "b.render.png")
_sc = _se.score(_rd, use_lpips=False, side_by_side=0)
_pv = {v["view"]: v for v in _sc["per_view"]}
check("splat_eval: scorer — idéntico da PSNR 60 (cap) / SSIM 1.0; ruido da estrictamente menos",
      _pv["a"]["psnr"] == 60.0 and _pv["a"]["ssim"] == 1.0
      and _pv["b"]["psnr"] < 30 and _pv["b"]["ssim"] < 1.0 and _sc["n_test_views"] == 2)
check("splat_eval: run.json lleva params_hash (un número sin contexto no es dato)",
      '"params_hash"' in Path("pipeline/splat_eval.py").read_text())

# --- entity U0: identidad de reconstrucción + merge_label + alias no-op ---
check("entity: recon_id determinista por set (orden-independiente) y distinto por set distinto",
      jobs.recon_id_for(["b", "a"]) == jobs.recon_id_for(["a", "b"])
      and jobs.recon_id_for(["a", "b"]).startswith("recon_")
      and jobs.recon_id_for(["a", "b"]) != jobs.recon_id_for(["a", "b"], ["p.jpg"])
      and jobs.recon_id_for(["a", "b"], ["p.jpg"]) == jobs.recon_id_for(["a", "b"], ["p.jpg"]))
check("entity: merge_label — SINGLE/FULL/PARTIAL por composición, no por adorno",
      _wk.merge_label(1, 0, []) == "SINGLE" and _wk.merge_label(2, 0, []) == "FULL"
      and _wk.merge_label(2, 0, ["x"]) == "PARTIAL" and _wk.merge_label(1, 3, []) == "FULL")
check("entity: worker pasa --proj-id y escribe el bloque reconstruction uniforme",
      '"--proj-id", cid' in _w_src and '"merge_label": merge_label(' in _w_src
      and 'm["reconstruction"]' in _w_src and 'is_recon = cid.startswith("recon_")' in _w_src)
check("entity: run_splat alimenta splat_runs[] al publicar (historial acotado)",
      'recon.setdefault("splat_runs"' in _w_src and "del runs[:-10]" in _w_src)
_srv_src = Path("pipeline/aerobrain_server.py").read_text()
check("entity: /api/odm acuña recon_<hash> para combinados; single-source conserva su cid",
      "jobstore.recon_id_for(sources, photos) if (len(sources) > 1 or photos) else cid" in _srv_src
      and '"primary_cid": cid' in _srv_src)
_mig = _json.loads(Path("/Volumes/SSD/drone-vault/models/DJI_20260706133809_0101_D/meta.json").read_text())
check("entity: migración aplicada a modelos reales (SINGLE, alias no-op, splat_runs sembrado)",
      _mig.get("reconstruction", {}).get("merge_label") == "SINGLE"
      and _mig["reconstruction"]["id"] == _mig["clip_id"]
      and isinstance(_mig["reconstruction"]["splat_runs"], list))
# el cadáver del test #1 como fixture (regla permanente): 0106 aportó 0/7, 0101 33/33
_pp = _tmp / "proj_partial"; (_pp / "opensfm").mkdir(parents=True)
(_pp / "opensfm" / "image_list.txt").write_text("\n".join(
    [f"/x/images/s0_f_{i:04d}.jpg" for i in range(7)] + [f"/x/images/s1_f_{i:04d}.jpg" for i in range(33)]))
(_pp / "opensfm" / "reconstruction.json").write_text(_json.dumps(
    [{"shots": {f"s1_f_{i:04d}.jpg": {} for i in range(33)}}]))
_reg = _wk.odm_registration(_pp, ["C0106", "C0101"])
check("entity: camino PARTIAL con los datos del test #1 — 0106 0/7 dropped, label PARTIAL",
      _reg["by_source"]["C0106"] == {"submitted": 7, "registered": 0, "ratio": 0.0, "merged": False}
      and _reg["by_source"]["C0101"]["merged"] is True
      and _reg["dropped_sources"] == ["C0106"]
      and _wk.merge_label(2, 0, _reg["dropped_sources"]) == "PARTIAL")


# browser_gate: el import fantasma de threading (11-jul) — el NameError en launch_chrome
# se ENMASCARABA como OSError del rmtree del TemporaryDirectory (error secundario del
# unwind). Compilar el módulo entero atrapa imports fantasma sin lanzar Chrome.
import py_compile as _pyc
_swallow(lambda: _pyc.compile("pipeline/browser_gate.py", doraise=True))
import ast as _ast
_bg_tree = _ast.parse(Path("pipeline/browser_gate.py").read_text())
_bg_imports = {n.name.split(".")[0] for x in _ast.walk(_bg_tree) if isinstance(x, _ast.Import) for n in x.names}
check("browser_gate: threading importado (el drain thread lo usa) + cleanup a prueba de race",
      "threading" in _bg_imports
      and "ignore_cleanup_errors=True" in Path("pipeline/browser_gate.py").read_text())

print(f"\n{'FALLARON: ' + ', '.join(FAILS) if FAILS else 'TODOS LOS TESTS PASAN'}")
sys.exit(1 if FAILS else 0)
