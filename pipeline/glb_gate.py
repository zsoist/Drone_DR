#!/usr/bin/env python3
"""Visual + budget gate for the W1 GLB tiers (fail closed).

For every tier, in a COLD Chrome (cache disabled, fresh profile) it runs the real web
loader twice with the same fixed cameras:

    reference  attachVisualMesh(glb:false)  - today's OBJ + JPEG ladder for that tier
    candidate  attachVisualMesh(glb:<tier>) - the GLB (meshopt + KTX2)

and compares them:

    * SSIM (per fixed camera, mean over cameras)      >= 0.97
    * Laplacian sharpness ratio (GLB / OBJ, mean)     >= 0.95
    * download bytes (wire), GPU texture MB, first-frame ms   each <= the OBJ ladder's

The verdict is written to models/<cid>/glb/gate.json (bound to the GLB source
fingerprint + per-tier build key). scene_manifest.py advertises a tier to the web ONLY
when that tier is green here, so a red gate leaves the GLBs generated but unused.

Rendering runs on the server's own 404 document (same origin, no interference); a separate
CSP check loads the GLB on a static page that carries the PRODUCTION CSP (no 'unsafe-eval'),
and browser_matrix --flightverse exercises the real Flightverse page.
Only Page.navigate + Runtime.evaluate are used (no Fetch/Network interception).

Usage:  python3 glb_gate.py <clip_id> [--tier mobile ...] [--base-url URL] [--shots DIR]
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys
import time
from pathlib import Path

import numpy as np

import glb_export
from browser_gate import DEFAULT_BASE_URL, launch_chrome, new_page, teardown_chrome, _LIVE
from fsutil import atomic_write_json, read_json  # noqa: E402
from paths import VAULT, WEB  # noqa: E402

SSIM_MIN = 0.97
SHARPNESS_MIN = 0.95
WIDTH, HEIGHT = 960, 600
HOST_PAGE = "/__glb_gate__.html"        # 404 document: same origin, no CSP
CSP_HOST_PAGE = "/flightverse/world-collision-fixture.html"   # static page WITH the production CSP


def web_version() -> str:
    m = re.search(r"three\.js\?v=(\d+)", (WEB / "flightverse" / "scene.js").read_text())
    return m.group(1) if m else "0"


# Runs inside Chrome. PLACEHOLDERS: __V__ web version, __ARGS__ JSON {cid, tier, variant, ...}
HARNESS = r"""
(async () => {
  const A = __ARGS__;
  const THREE = await import('/flightverse/three.js?v=__V__');
  const S = await import('/flightverse/scene.js?v=__V__');
  const t0 = performance.now();
  const man = await S.loadManifest(A.cid);
  // candidate: advertise the GLBs this run wants (the published manifest may not yet)
  man.capabilities.glb_mesh = true;
  for (const t of ['mobile', 'desktop', 'extra'])
    man.assets['mesh_glb_' + t] = (A.files && A.files[t]) || `data/models/${A.cid}/glb/${t}.glb`;
  // reference ladder per tier: mobile -> low mtl, desktop -> vtx, extra -> geo atlas
  if (A.tier === 'mobile') { delete man.assets.mesh_mtl_extra; delete man.assets.mesh_mtl; }
  if (A.tier === 'extra') man.assets.mesh_mtl_extra = man.assets.mesh_mtl_geo;

  const canvas = document.createElement('canvas');
  canvas.width = A.width; canvas.height = A.height;
  document.body ? document.body.appendChild(canvas) : document.documentElement.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(A.width, A.height, false);
  renderer.setClearColor(0x1b2028, 1);
  const scene = new THREE.Scene();
  const gl = renderer.getContext();
  const sync = () => { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };

  performance.clearResourceTimings();
  const tStart = performance.now();
  const handle = await S.attachVisualMesh(man, scene, {
    renderer, glb: A.variant === 'glb' ? A.tier : false });
  if (!handle) throw new Error('attachVisualMesh devolvió null');
  const tLoaded = performance.now();
  const cam = new THREE.PerspectiveCamera(50, A.width / A.height, 0.5, 2000);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(handle.object);
  const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  cam.position.copy(ctr).add(new THREE.Vector3(0, size.length() * 0.5, 0.01)); cam.lookAt(ctr);
  renderer.render(scene, cam); sync();
  const firstFrameMs = performance.now() - tStart;
  // OBJ/MTL textures stream in AFTER attachVisualMesh resolves (TextureLoader): wait for
  // every page so bytes/GPU are complete; firstFrameMs above is what the player sees first.
  const allMaps = () => { const out = []; handle.object.traverse(n => { if (!n.isMesh) return;
    for (const m of (Array.isArray(n.material) ? n.material : [n.material])) if (m.map) out.push(m.map); }); return out; };
  const tWait = performance.now();
  while (allMaps().some(t => !t.image && !(t.mipmaps && t.mipmaps.length)) && performance.now() - tWait < 90000)
    await new Promise(r => setTimeout(r, 50));
  renderer.render(scene, cam); sync();
  const texturedMs = performance.now() - tStart;
  // resources fetched by this variant (wire bytes)
  const res = performance.getEntriesByType('resource')
    .filter(e => /\/(data|vendor)\//.test(e.name))
    .map(e => ({ n: e.name.split('?')[0].split('/').slice(-1)[0], w: e.transferSize || 0, b: e.encodedBodySize || 0, d: e.decodedBodySize || 0 }));
  const wire = res.reduce((s, e) => s + (e.w || e.b), 0);
  const body = res.reduce((s, e) => s + e.b, 0);
  // geometry + texture accounting
  let tris = 0, geoBytes = 0, texBytes = 0, meshes = 0, compressed = 0, fmt = {};
  const seen = new Set();
  handle.object.traverse(n => {
    if (!n.isMesh) return;
    meshes++;
    const g = n.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    for (const k in g.attributes) geoBytes += g.attributes[k].array.byteLength;
    if (g.index) geoBytes += g.index.array.byteLength;
    const list = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of list) {
      const t = m.map; if (!t || seen.has(t)) continue; seen.add(t);
      if (t.isCompressedTexture) {
        compressed++; fmt[t.format] = (fmt[t.format] || 0) + 1;
        for (const mip of t.mipmaps) texBytes += mip.data.byteLength;
      } else {
        const w = t.image.width, h = t.image.height;
        texBytes += w * h * 4 * (t.generateMipmaps === false ? 1 : 4 / 3);
      }
    }
  });



  // fixed cameras from the bbox (deterministic; identical for both variants)
  const R = size.length();
  const view = (pos, look) => { cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld(); };
  // highest mesh point -> close-up ring
  let top = new THREE.Vector3(0, -1e9, 0); const v3 = new THREE.Vector3();
  handle.object.traverse(n => {
    if (!n.isMesh) return;
    const p = n.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 7) {
      v3.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld);
      if (v3.y > top.y) top.copy(v3);
    }
  });
  let cams = [];
  cams.push([ctr.clone().add(new THREE.Vector3(0.001, R * 0.62, 0)), ctr]);
  for (const az of [45, 135, 225, 315]) {
    const a = az * Math.PI / 180;
    cams.push([ctr.clone().add(new THREE.Vector3(Math.cos(a) * R * 0.42, R * 0.3, Math.sin(a) * R * 0.42)), ctr]);
  }
  for (const az of [20, 140, 260]) {
    const a = az * Math.PI / 180;
    cams.push([top.clone().add(new THREE.Vector3(Math.cos(a) * 22, 9, Math.sin(a) * 22)),
               top.clone().add(new THREE.Vector3(0, -7, 0))]);
  }
  // the candidate MUST reuse the reference cameras: bbox / highest vertex differ once
  // the mesh is simplified, and a moved camera would be measured as a "visual" change
  if (A.cams) cams = A.cams.map(([p, l]) => [new THREE.Vector3(...p), new THREE.Vector3(...l)]);
  const shots = [];
  for (const [p, l] of cams) {
    view(p, l); renderer.render(scene, cam); sync();
    shots.push(canvas.toDataURL('image/png'));
  }
  // steady-state cost of the first camera
  view(cams[1][0], cams[1][1]);
  const f0 = performance.now(); for (let i = 0; i < 20; i++) { renderer.render(scene, cam); } sync();
  const renderMs = (performance.now() - f0) / 20;

  const out = {
    variant: A.variant, tier: A.tier, source: handle.source, glbTier: handle.tier || null,
    tris, meshes, geoMB: geoBytes / 1048576, gpuTexMB: texBytes / 1048576, compressedTextures: compressed,
    formats: fmt, loadMs: tLoaded - tStart, firstFrameMs, texturedMs, renderMs,
    wireBytes: wire, bodyBytes: body, resources: res.filter(r => r.b > 100000)
      .sort((a, b) => b.b - a.b).slice(0, 6),
    textures: seen.size, shots, cams: cams.map(([p, l]) => [p.toArray(), l.toArray()]),
    gl: gl.getParameter(gl.RENDERER), bbox: [box.min.toArray(), box.max.toArray()],
  };
  handle.dispose(); renderer.dispose();
  return out;
})()
"""


def run_variant(base_url: str, cid: str, tier: str, variant: str, timeout: int = 240,
                files: dict | None = None, cams: list | None = None, host: str = HOST_PAGE) -> dict:
    proc, profile, port = launch_chrome()
    cdp = None
    try:
        cdp = new_page(port)
        cdp.send("Network.enable")
        cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
        cdp.send("Page.navigate", {"url": f"{base_url.rstrip('/')}{host}"})
        cdp.pump(1.0 if host == HOST_PAGE else 3.0)
        cdp.eval("document.head.insertAdjacentHTML('beforeend', '<base href=\"/\">')")
        args = {"cid": cid, "tier": tier, "variant": variant, "width": WIDTH, "height": HEIGHT,
                "files": files or {}, "cams": cams}
        code = HARNESS.replace("__V__", web_version()).replace("__ARGS__", json.dumps(args))
        res = cdp.send("Runtime.evaluate", {"expression": code, "awaitPromise": True,
                                            "returnByValue": True, "timeout": timeout * 1000})
        if res.get("exceptionDetails"):
            det = res["exceptionDetails"]
            msg = (det.get("exception") or {}).get("description") or det.get("text")
            raise RuntimeError(f"harness {tier}/{variant}: {msg} · {cdp.errors[:3]}")
        out = res["result"]["value"]
        out["console_warnings"] = cdp.warnings[:6]
        out["console_errors"] = cdp.errors[:6]
        return out
    finally:
        if cdp:
            cdp.close()
        _LIVE.pop(proc.pid, None)
        teardown_chrome(proc, profile)


def _decode(data_url: str) -> np.ndarray:
    from PIL import Image
    raw = base64.b64decode(data_url.split(",", 1)[1])
    return np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.float64)


def lap_var(rgb: np.ndarray) -> float:
    from scipy.ndimage import laplace
    gray = rgb @ np.array([0.299, 0.587, 0.114])
    return float(laplace(gray).var())


def compare_shots(ref: list[str], cand: list[str]) -> dict:
    from skimage.metrics import structural_similarity
    ssims, ratios = [], []
    for a, b in zip(ref, cand):
        ia, ib = _decode(a), _decode(b)
        ssims.append(float(structural_similarity(ia, ib, channel_axis=2, data_range=255.0)))
        la = lap_var(ia)
        ratios.append(lap_var(ib) / la if la > 0 else 1.0)
    return {"ssim_per_cam": [round(x, 4) for x in ssims], "ssim_mean": round(float(np.mean(ssims)), 4),
            "ssim_min": round(float(np.min(ssims)), 4),
            "sharpness_ratio_per_cam": [round(x, 3) for x in ratios],
            "sharpness_ratio_mean": round(float(np.mean(ratios)), 3)}


def gate_tier(base_url: str, cid: str, tier: str, shots_dir: Path | None, log=print,
              files: dict | None = None, ref: dict | None = None) -> dict:
    ref = ref or run_variant(base_url, cid, tier, "obj")
    cand = run_variant(base_url, cid, tier, "glb", files=files, cams=ref["cams"])
    if cand.get("source") != "glb":
        raise RuntimeError(f"[{tier}] el candidato cayó al OBJ (no cargó el GLB): {cand}")
    if ref.get("source") != "obj":
        raise RuntimeError(f"[{tier}] la referencia no fue OBJ: {ref}")
    cmpr = compare_shots(ref["shots"], cand["shots"])
    if shots_dir:
        from PIL import Image
        shots_dir.mkdir(parents=True, exist_ok=True)
        for tag, run in (("obj", ref), ("glb", cand)):
            for i, s in enumerate(run["shots"]):
                Image.open(io.BytesIO(base64.b64decode(s.split(",", 1)[1]))).save(
                    shots_dir / f"{tier}-cam{i}-{tag}.png")
    slim = lambda r: {k: v for k, v in r.items() if k not in ("shots", "cams")}  # noqa: E731
    budget = {
        "download_mb": (round(ref["wireBytes"] / 1e6, 2), round(cand["wireBytes"] / 1e6, 2)),
        "gpu_texture_mb": (round(ref["gpuTexMB"], 1), round(cand["gpuTexMB"], 1)),
        "first_frame_ms": (round(ref["firstFrameMs"]), round(cand["firstFrameMs"])),
        "fully_textured_ms": (round(ref["texturedMs"]), round(cand["texturedMs"])),
        "tris": (int(ref["tris"]), int(cand["tris"])),
        "render_ms": (round(ref["renderMs"], 2), round(cand["renderMs"], 2)),
    }
    checks = {
        "ssim": cmpr["ssim_mean"] >= SSIM_MIN,
        "sharpness": cmpr["sharpness_ratio_mean"] >= SHARPNESS_MIN,
        "download": cand["wireBytes"] <= ref["wireBytes"],
        "gpu": cand["gpuTexMB"] <= ref["gpuTexMB"],
        "first_frame": cand["firstFrameMs"] <= ref["firstFrameMs"],
    }
    verdict = {"ok": all(checks.values()), "checks": checks, **cmpr, "budget": budget,
               "reference": slim(ref), "candidate": slim(cand)}
    log(f"[{tier}] {'OK' if verdict['ok'] else 'FAIL'} ssim {cmpr['ssim_mean']} (min {cmpr['ssim_min']}) "
        f"sharp {cmpr['sharpness_ratio_mean']} · dl {budget['download_mb']} MB · gpu {budget['gpu_texture_mb']} MB · "
        f"ff {budget['first_frame_ms']} ms · tris {budget['tris']} · checks {checks}")
    return verdict


def fallback_check(base_url: str, cid: str, vault: Path = VAULT, log=print) -> dict:
    """The web must fall back to the OBJ ladder, silently (console.warn only), when the GLB
    is missing (404) or corrupt. Uses the real attachVisualMesh path."""
    _model_dir, glb_dir, _viewer = glb_export._paths(cid, vault)
    corrupt = glb_dir / ".fallback-corrupt.glb"
    corrupt.write_bytes(b"glTF" + bytes(range(256)) * 64)          # magic ok, body garbage
    out = {}
    try:
        for name, rel in (("missing", "glb/__does_not_exist__.glb"), ("corrupt", "glb/.fallback-corrupt.glb")):
            r = run_variant(base_url, cid, "mobile", "glb", files={"mobile": f"data/models/{cid}/{rel}"})
            warned = any("GLB" in w for w in r.get("console_warnings", []))
            out[name] = {"ok": r.get("source") == "obj" and warned and r["tris"] > 0,
                         "source": r.get("source"), "warned": warned}
            log(f"[fallback/{name}] {'OK' if out[name]['ok'] else 'FAIL'} source={r.get('source')} warned={warned}")
    finally:
        corrupt.unlink(missing_ok=True)
    out["ok"] = all(v["ok"] for v in out.values())
    return out


def csp_check(base_url: str, cid: str, log=print, tiers: tuple = ("mobile", "desktop")) -> dict:
    """Load the GLB (both device tiers) on a page that carries the PRODUCTION CSP
    (no 'unsafe-eval'): the KTX2 blob worker + wasm must work, with zero console errors."""
    out = {}
    for tier in tiers:
        r = run_variant(base_url, cid, tier, "glb", host=CSP_HOST_PAGE)
        noise = [e for e in r.get("console_errors", []) if "404" not in e]
        out[tier] = {"ok": r.get("source") == "glb" and not noise and not r.get("console_warnings"),
                     "source": r.get("source"), "errors": noise[:3]}
        log(f"[csp/{tier}] {'OK' if out[tier]['ok'] else 'FAIL'} source={r.get('source')} errors={noise[:1]}")
    out["ok"] = all(v["ok"] for v in out.values())
    return out


def run(cid: str, tiers: list[str] | None = None, base_url: str = DEFAULT_BASE_URL,
        shots_dir: Path | None = None, vault: Path = VAULT, log=print,
        precomputed: dict | None = None) -> dict:
    """`precomputed` = {tier: verdict} from gate_tier() runs the caller already did (the
    backfill's bounded parameter search); those tiers are not re-rendered. Thresholds are
    the module constants either way - this only avoids measuring twice."""
    meta = glb_export.validate(cid, vault=vault)
    _model_dir, glb_dir, _viewer = glb_export._paths(cid, vault)
    prev = read_json(glb_dir / "gate.json", {}) or {}
    keep = prev.get("tiers", {}) if prev.get("source_fingerprint") == meta["source_fingerprint"] else {}
    results = dict(keep)
    for tier in (list(meta["tiers"]) if tiers is None else tiers):
        if tier not in meta["tiers"]:
            continue
        verdict = (precomputed or {}).get(tier) or gate_tier(base_url, cid, tier, shots_dir, log=log)
        verdict["key"] = meta["tiers"][tier]["key"]
        results[tier] = verdict
    fallback = fallback_check(base_url, cid, vault, log=log)
    # the CSP-safe decode is a property of the loader, not of a tier: probe the device tiers
    # this model has (a model whose mobile/desktop GLB was rejected still proves it via extra)
    csp_tiers = tuple(t for t in ("mobile", "desktop") if t in meta["tiers"]) or tuple(list(meta["tiers"])[:1])
    csp = csp_check(base_url, cid, log=log, tiers=csp_tiers)
    gate = {"version": 1, "clip_id": cid, "fallback": fallback, "csp": csp, "source_fingerprint": meta["source_fingerprint"],
            "gltfpack": meta.get("gltfpack"), "web_version": web_version(),
            "measured_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "ok": all(t.get("ok") for t in results.values()) and bool(results) and fallback["ok"] and csp["ok"],
            "tiers": results}
    atomic_write_json(glb_dir / "gate.json", gate, indent=1)
    return gate


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("clip_id")
    ap.add_argument("--tier", action="append", choices=list(glb_export.TIERS))
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--shots", type=Path, help="save the OBJ/GLB camera renders here")
    ap.add_argument("--experiment", action="append", metavar="TIER=FILE",
                    help="dev only: compare another glb/<FILE> for TIER; writes no verdict")
    args = ap.parse_args(argv)
    if args.experiment:
        for spec in args.experiment:
            tier, name = spec.split("=", 1)
            gate_tier(args.base_url, args.clip_id, tier, args.shots and args.shots / name.replace(".glb", ""),
                      files={tier: f"data/models/{args.clip_id}/glb/{name}"})
        return 0
    try:
        gate = run(args.clip_id, args.tier, args.base_url, args.shots)
    except (RuntimeError, ValueError, OSError) as err:
        print(f"glb_gate: {err}", file=sys.stderr)
        return 1
    print("glb gate:", "GREEN" if gate["ok"] else "RED")
    return 0 if gate["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
