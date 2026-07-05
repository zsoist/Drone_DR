"""Smoke tests del pipeline — corre con: python3 test_smoke.py (sin dependencias de test).

Cubre las piezas puras: parser SRT (con puntos 0,0), política de tiers,
mediciones DSM (volumen y perfil sobre un DSM sintético), y contención de paths.
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
FAILS = []


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

print(f"\n{'FALLARON: ' + ', '.join(FAILS) if FAILS else 'TODOS LOS TESTS PASAN'}")
sys.exit(1 if FAILS else 0)
