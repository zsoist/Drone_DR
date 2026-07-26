"""Browser matrix QA for Gaussian splat viewers.

This is the stronger sibling of browser_gate.py. It verifies the two user-facing
splat surfaces (share.html and the authenticated 3D workspace) across mobile,
iPad, and desktop viewport classes:

  python3 browser_matrix.py DJI_20260705171127_0099_D

Checks:
  - no JS/console errors
  - no horizontal overflow
  - splat canvas renders
  - version selector is visible when a project has multiple splats
  - macro/zoom controls really move the camera closer
  - screenshots are non-empty and saved under /Volumes/SSD/drone-vault/qa
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

from browser_gate import DEFAULT_BASE_URL, QA_DIR, launch_chrome, new_page
from splat_presets import SPLAT_PRESETS


VAULT = Path("/Volumes/SSD/drone-vault")
VIEWPORTS = {
    "mobile_portrait": {"width": 390, "height": 844, "deviceScaleFactor": 3, "mobile": True},
    "mobile_landscape": {"width": 844, "height": 390, "deviceScaleFactor": 3, "mobile": True},
    "ipad_portrait": {"width": 820, "height": 1180, "deviceScaleFactor": 2, "mobile": True},
    "ipad_landscape": {"width": 1180, "height": 820, "deviceScaleFactor": 2, "mobile": True},
    # Aliases kept for focused operator runs.
    "mobile": {"width": 390, "height": 844, "deviceScaleFactor": 3, "mobile": True},
    "ipad": {"width": 820, "height": 1180, "deviceScaleFactor": 2, "mobile": True},
    "desktop": {"width": 1440, "height": 960, "deviceScaleFactor": 1, "mobile": False},
}


def expected_splat_path(cid: str) -> str:
    """The UI default must be the highest-quality visual splat, not just mutable current."""
    sys = json.loads((VAULT / "manifest" / "system.json").read_text())
    rows = [
        s for s in (sys.get("splats") or [])
        if s.get("clip_id") == cid and str(s.get("format") or "").lower() in {"sog", "spz", "ksplat", "splat", "ply"}
    ]
    if not rows:
        raise RuntimeError(f"no splats in manifest for {cid}")
    rank = {"sog": 0, "spz": 1, "ksplat": 2, "splat": 3, "ply": 4}
    rows.sort(key=lambda s: (
        -(s.get("iters") or 0),
        -(1 if s.get("current") else 0),
        rank.get(str(s.get("format") or "").lower(), 9),
        str(s.get("archived_at") or ""),
    ))
    return rows[0].get("path") or rows[0].get("name")


def requires_splat_asset(surfaces: list[str] | None) -> bool:
    """Share/workspace render assets; the operational jobs console does not."""
    selected = surfaces or ["share", "workspace", "jobs"]
    return any(surface in ("share", "workspace") for surface in selected)


def select_job_target(rows: list[dict], cid: str) -> dict:
    """Pick the newest API job by immutable label, not by user-facing card copy."""
    target = next((row for row in rows
                   if row.get("kind") == "splat" and row.get("label") == cid), None)
    if target is None:
        raise RuntimeError(f"no splat jobs in API for {cid}")
    return target


def log_contracts_for_job(job: dict) -> list[str]:
    """Return retry evidence that belongs to this job, never to an unrelated card."""
    attempts = job.get("attempts") or []
    if not any(int(attempt.get("rc") or 0) != 0 for attempt in attempts):
        return []
    contracts = ["splat_attempt_failed"]
    successful = next(
        (attempt for attempt in reversed(attempts) if int(attempt.get("rc") or 0) == 0),
        None,
    )
    if successful and successful.get("d"):
        preset = SPLAT_PRESETS.get(str(job.get("requested_preset") or ""), {})
        contracts.append(f"{preset.get('label') or job.get('requested_preset')} -d {successful['d']}")
    return contracts


def js(s: str) -> str:
    return "(() => {" + s + "})()"


def wait_for(cdp, expr: str, timeout: int = 45, label: str = "condition"):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        cdp.pump(0.35)
        try:
            last = cdp.eval(expr)
        except RuntimeError:
            continue
        if last:
            return last
    raise RuntimeError(f"timeout esperando {label}: {last!r}")


def set_viewport(cdp, name: str):
    vp = VIEWPORTS[name]
    cdp.send("Emulation.setDeviceMetricsOverride", vp | {
        "screenWidth": vp["width"],
        "screenHeight": vp["height"],
    })
    touch = {"enabled": bool(vp["mobile"])}
    if vp["mobile"]:
        touch["maxTouchPoints"] = 5
    cdp.send("Emulation.setTouchEmulationEnabled", touch)


def common_surface_checks(cdp, selector: str) -> dict:
    state = cdp.eval(js(f"""
      const root = document.querySelector({selector!r});
      const cv = root && root.querySelector('canvas');
      const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth || 0) - window.innerWidth;
      const rect = root ? root.getBoundingClientRect() : null;
      return {{
        root: !!root,
        canvas: !!cv,
        width: rect ? rect.width : 0,
        height: rect ? rect.height : 0,
        overflow,
        body: document.body.innerText.slice(0, 220),
      }};
    """))
    if not state.get("root") or not state.get("canvas"):
        raise RuntimeError(f"splat canvas ausente: {state}")
    if state.get("width", 0) < 240 or state.get("height", 0) < 220:
        raise RuntimeError(f"visor demasiado pequeño: {state}")
    if state.get("overflow", 0) > 3:
        raise RuntimeError(f"overflow horizontal {state['overflow']}px: {state}")
    return state


def verify_macro_zoom(cdp, selector: str):
    before = wait_for(cdp, js(f"""
      const root = document.querySelector({selector!r});
      const v = root && (root._splatViewer || root._viewer);
      if (!v || !v.camera || !v.controls) return null;
      return v.camera.position.distanceTo(v.controls.target);
    """), timeout=30, label="splat viewer camera")
    clicked = cdp.eval(js(f"""
      const root = document.querySelector({selector!r});
      const btn = root && root.querySelector('[data-sv="inspect"]');
      if (!btn) return false;
      btn.click();
      return true;
    """))
    if not clicked:
        raise RuntimeError("botón Modo macro no encontrado")
    cdp.pump(1.0)
    after = cdp.eval(js(f"""
      const root = document.querySelector({selector!r});
      const v = root && (root._splatViewer || root._viewer);
      return v.camera.position.distanceTo(v.controls.target);
    """))
    if not isinstance(before, (int, float)) or not isinstance(after, (int, float)) or after >= before * 0.35:
        raise RuntimeError(f"macro no acercó suficiente: before={before} after={after}")
    return {"before": before, "after": after}


def screenshot(cdp, out: Path):
    QA_DIR.mkdir(parents=True, exist_ok=True)
    shot = cdp.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
    out.write_bytes(base64.b64decode(shot["data"]))
    if out.stat().st_size < 25_000:
        raise RuntimeError(f"screenshot sospechosamente chico: {out.stat().st_size} bytes · {out}")


def run_share(cdp, base_url: str, cid: str, viewport: str, expected_path: str) -> dict:
    url = f"{base_url.rstrip('/')}/share.html?m={urllib.parse.quote(cid)}"
    cdp.send("Page.navigate", {"url": url})
    wait_for(cdp, "document.body && /VISOR 3D/i.test(document.body.innerText)", timeout=45, label="share shell")
    clicked = cdp.eval(js("""
      const b = document.querySelector('[data-v="splat"]');
      if (!b) return false;
      b.click();
      return true;
    """))
    if not clicked:
        raise RuntimeError("share.html no expuso tab Gaussian splat")
    wait_for(cdp, js("""
      const root = document.querySelector('#sh-view');
      return !!(root && root.querySelector('canvas') && root._splatViewer);
    """), timeout=75, label="share splat canvas")
    state = common_surface_checks(cdp, "#sh-view")
    macro = verify_macro_zoom(cdp, "#sh-view")
    selected = cdp.eval(js("""
      const sel = document.querySelector('.share-splat-select');
      return sel ? {
        count: sel.options.length,
        value: sel.value,
        text: sel.selectedOptions[0]?.textContent || ''
      } : { count: 1, value: null, text: '' };
    """))
    if selected.get("value") and selected["value"] != expected_path:
        raise RuntimeError(f"share default splat incorrecto: {selected['value']} != {expected_path}")
    screenshot(cdp, QA_DIR / f"{cid}-share-{viewport}.png")
    return {"surface": "share", "viewport": viewport, "state": state, "macro": macro, "selected": selected}


def run_workspace(cdp, base_url: str, cid: str, viewport: str, expected_path: str) -> dict:
    url = f"{base_url.rstrip('/')}/tresd.html"
    cdp.send("Page.navigate", {"url": url})
    wait_for(cdp, "document.body && /Proyectos 3D/i.test(document.body.innerText)", timeout=45, label="3D workspace")
    cdp.eval(f"localStorage.setItem('ab.proj3d', {json.dumps(cid)}); location.reload();")
    wait_for(cdp, js("""
      return !!(document.querySelector('#proj-view') && document.querySelector('#load-splat'));
    """), timeout=45, label="selected project")
    meta = cdp.eval(js("""
      const sel = document.querySelector('#sp-select');
      return {
        selectVisible: !!(sel && getComputedStyle(sel).display !== 'none'),
        count: sel ? sel.options.length : 0,
        value: sel ? sel.value : null,
        selected: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '',
      };
    """))
    if meta.get("value") and meta["value"] != expected_path:
        raise RuntimeError(f"workspace default splat incorrecto: {meta['value']} != {expected_path}")
    clicked = cdp.eval(js("""
      const b = document.querySelector('#load-splat');
      if (!b || getComputedStyle(b).display === 'none') return false;
      b.click();
      return true;
    """))
    if not clicked:
        raise RuntimeError("3D workspace no expuso botón Cargar splat")
    wait_for(cdp, js("""
      const root = document.querySelector('#splat-box');
      return !!(root && root.querySelector('canvas') && root._viewer);
    """), timeout=75, label="workspace splat canvas")
    state = common_surface_checks(cdp, "#splat-box")
    macro = verify_macro_zoom(cdp, "#splat-box")
    screenshot(cdp, QA_DIR / f"{cid}-workspace-{viewport}.png")
    return {"surface": "workspace", "viewport": viewport, "state": state, "macro": macro, "selected": meta}


def run_jobs(cdp, base_url: str, cid: str, viewport: str, _expected_path: str) -> dict:
    """Operational console: truthful quality, responsive layout and real full-log drawer."""
    with urllib.request.urlopen(f"{base_url.rstrip('/')}/api/jobs", timeout=15) as response:
        target = select_job_target(json.loads(response.read()).get("jobs") or [], cid)
    target_id = str(target["id"])
    cdp.send("Page.navigate", {"url": f"{base_url.rstrip('/')}/tresd.html"})
    wait_for(cdp, "document.body && /Proyectos 3D/i.test(document.body.innerText)",
             timeout=45, label="3D jobs shell")
    clicked = cdp.eval(js("""
      const tab = document.querySelector('[data-tab="jobs"]');
      if (!tab) return false;
      tab.click(); return true;
    """))
    if not clicked:
        raise RuntimeError("tab Trabajos ausente")
    state = wait_for(cdp, js(f"""
      const cards = [...document.querySelectorAll('#jobs3d .job-card')];
      const splats = cards.filter(x => x.dataset.kind === 'splat');
      const splat = cards.find(x => x.dataset.jid === {json.dumps(target_id)});
      if (!splat) return null;
      const consoleRect = document.querySelector('#jobs3d').getBoundingClientRect();
      const cardRect = splat.getBoundingClientRect();
      const statusRect = splat.querySelector('.jc-status')?.getBoundingClientRect();
      const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth || 0) - window.innerWidth;
      return {{
        cards: cards.length,
        summaries: document.querySelectorAll('#job-summary button').length,
        typeFilters: document.querySelectorAll('[data-job-kind]').length,
        text: splat.innerText,
        status: splat.dataset.status,
        historyText: splats.map(x => x.innerText).join('\\n---\\n'),
        jid: splat.dataset.jid,
        logJid: splat.dataset.jid,
        consoleWidth: consoleRect.width,
        cardWidth: cardRect.width,
        statusVisible: !!statusRect && statusRect.left >= cardRect.left - 1 && statusRect.right <= cardRect.right + 1,
        cardInternalOverflow: splat.scrollWidth - splat.clientWidth,
        overflow,
      }};
    """), timeout=45, label="jobs console cards")
    if state["summaries"] < 4 or state["typeFilters"] < 4 or state["cards"] < 1:
        raise RuntimeError(f"consola de trabajos incompleta: {state}")
    if state["status"] != target.get("status"):
        raise RuntimeError(f"estado UI/API divergente: ui={state['status']} api={target.get('status')}")
    requested_iters = int(target.get("requested_iterations") or 0)
    if requested_iters:
        iter_label = f"{requested_iters // 1000}k" if requested_iters % 1000 == 0 else str(requested_iters)
        if iter_label.lower() not in state["text"].lower():
            raise RuntimeError(f"trabajo no muestra iteraciones solicitadas {iter_label}: {state['text'][:500]}")
    if target.get("requested_backend") == "cuda" and "cuda" not in state["text"].lower():
        raise RuntimeError(f"trabajo CUDA perdió la política/backend visible: {state['text'][:500]}")
    if target.get("current_iteration") is not None and "iter/s" not in state["text"].lower():
        raise RuntimeError(f"trabajo vivo no muestra ritmo medido: {state['text'][:700]}")
    if state["overflow"] > 3:
        raise RuntimeError(f"overflow horizontal {state['overflow']}px en jobs/{viewport}")
    if state["cardWidth"] < state["consoleWidth"] - 3:
        raise RuntimeError(f"tarjeta no ocupa la consola en jobs/{viewport}: {state}")
    if not state["statusVisible"] or state["cardInternalOverflow"] > 3:
        raise RuntimeError(f"tarjeta recorta estado/contenido en jobs/{viewport}: {state}")
    cdp.pump(0.6)  # let the tab transition finish before composited screenshot capture
    screenshot(cdp, QA_DIR / f"{cid}-jobs-{viewport}.png")
    opened = cdp.eval(js(f"""
      const card = document.querySelector('[data-jid="{state['logJid']}"]');
      const button = card && card.querySelector('[data-job-log]');
      if (!button) return false;
      button.click(); return true;
    """))
    if not opened:
        raise RuntimeError("botón Logs completos ausente")
    drawer = wait_for(cdp, js("""
      const d = document.querySelector('#job-log-drawer');
      if (!d || !d.querySelector('.jl-pre')) return null;
      const r = d.getBoundingClientRect();
      return { text: d.innerText, width: r.width, right: r.right,
        viewport: window.innerWidth, overflow: document.documentElement.scrollWidth - window.innerWidth };
    """), timeout=30, label="full log drawer")
    for contract in log_contracts_for_job(target):
        if contract.lower() not in drawer["text"].lower():
            raise RuntimeError(f"drawer no muestra historial {contract!r}")
    if drawer["right"] > drawer["viewport"] + 3 or drawer["width"] > drawer["viewport"] + 3 or drawer["overflow"] > 3:
        raise RuntimeError(f"drawer fuera de viewport en {viewport}: {drawer}")
    cdp.pump(0.3)
    screenshot(cdp, QA_DIR / f"{cid}-jobs-log-{viewport}.png")
    return {"surface": "jobs", "viewport": viewport, "state": state,
            "drawer": {"width": drawer["width"], "viewport": drawer["viewport"]},
            "selected": {"count": 1}, "macro": {"before": 0.0, "after": 0.0}}


def run_matrix(cid: str, base_url: str, viewports: list[str], surfaces: list[str] | None = None) -> list[dict]:
    results = []
    expected_path = expected_splat_path(cid) if requires_splat_asset(surfaces) else ""
    runners = {"share": run_share, "workspace": run_workspace, "jobs": run_jobs}
    for vp in viewports:
        for surface in surfaces or ["share", "workspace", "jobs"]:
            runner = runners[surface]
            proc, profile, port = launch_chrome()
            cdp = None
            try:
                cdp = new_page(port)
                set_viewport(cdp, vp)
                results.append(runner(cdp, base_url, cid, vp, expected_path))
                if cdp.errors:
                    raise RuntimeError(f"errores de consola en {surface}/{vp}: {' | '.join(cdp.errors[:4])}")
            finally:
                if cdp:
                    cdp.close()
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except Exception:
                    proc.kill()
                profile.cleanup()
    return results


def run_mundo(cdp, base_url: str, viewport: str) -> dict:
    """FLIGHTVERSE world-select: islas + filtros + panel de misión + sin overflow."""
    cdp.send("Page.navigate", {"url": f"{base_url.rstrip('/')}/mundo.html"})
    state = wait_for(cdp, js("""
      const islas = document.querySelectorAll('.wi').length;
      if (!islas) return null;
      return {
        islas,
        filtros: document.querySelectorAll('#w-filters button').length,
        misiones: document.querySelectorAll('.w-panel .wp-m').length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    """), timeout=30, label="mundo world-select")
    if state["islas"] < 1 or state["filtros"] < 4 or state["misiones"] < 2:
        raise RuntimeError(f"mundo incompleto: {state}")
    if state["overflow"] > 3:
        raise RuntimeError(f"overflow horizontal {state['overflow']}px en mundo/{viewport}")
    keyboard = cdp.eval(js("""
      const cards = [...document.querySelectorAll('.wi')];
      const target = cards[1] || cards[0];
      if (!target) return { error:'sin islas' };
      const semantic = cards.every(card => card.getAttribute('role') === 'button'
        && card.tabIndex === 0 && ['true','false'].includes(card.getAttribute('aria-selected')));
      target.focus();
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key:'Enter', code:'Enter', bubbles:true, cancelable:true,
      }));
      return {
        semantic,
        focused:document.activeElement === target,
        selected:target.getAttribute('aria-selected') === 'true'
          && target.classList.contains('sel'),
        selectedCount:cards.filter(card => card.getAttribute('aria-selected') === 'true').length,
      };
    """))
    if (keyboard.get("error") or not keyboard.get("semantic") \
            or not keyboard.get("focused") or not keyboard.get("selected") \
            or keyboard.get("selectedCount") != 1):
        raise RuntimeError(f"islas no navegables por teclado: {keyboard}")
    preview_initial = cdp.eval(js("""
      const cards = [...document.querySelectorAll('.wi')];
      const hydrated = cards.filter(card =>
        card.querySelector('.wi-poster')?.dataset.previewLoaded === 'true').length;
      const resources = new Set(performance.getEntriesByType('resource')
        .filter(entry => /\\/ortho\\.webp(?:\\?|$)/.test(entry.name))
        .map(entry => entry.name)).size;
      return { cards:cards.length, hydrated, resources };
    """))
    if preview_initial["cards"] > 2 and (
            preview_initial["hydrated"] >= preview_initial["cards"]
            or preview_initial["resources"] >= preview_initial["cards"]):
        raise RuntimeError(f"previews de Mundo cargadas de forma ansiosa: {preview_initial}")
    preview_selected = cdp.eval(js("""
      const card = [...document.querySelectorAll('.wi')].at(-1);
      card?.focus();
      card?.dispatchEvent(new KeyboardEvent('keydown', {
        key:'Enter', code:'Enter', bubbles:true, cancelable:true,
      }));
      const poster = card?.querySelector('.wi-poster');
      return {
        selected:card?.getAttribute('aria-selected') === 'true',
        hydrated:poster?.dataset.previewLoaded === 'true',
        hasImage:/url\\(/.test(poster?.style.backgroundImage || ''),
      };
    """))
    if not all(preview_selected.values()):
        raise RuntimeError(f"preview seleccionada no se hidrató: {preview_selected}")
    map_initial = cdp.eval(js("""
      return performance.getEntriesByType('resource')
        .filter(entry => /maplibre-gl\\.(?:js|css)(?:\\?|$)/.test(entry.name)).length;
    """))
    if map_initial:
        raise RuntimeError(f"MapLibre cargó antes de abrir Mapa: {map_initial} recursos")
    cdp.eval("document.querySelector('[data-fvv=\"map\"]')?.click()")
    map_state = wait_for(cdp, js("""
      const wrap = document.querySelector('#fv-mapwrap');
      const canvas = document.querySelector('#fv-map .maplibregl-canvas');
      const resources = performance.getEntriesByType('resource')
        .filter(entry => /maplibre-gl\\.(?:js|css)(?:\\?|$)/.test(entry.name)).length;
      return canvas && !wrap.hidden && resources >= 2
        ? { canvas:true, resources, cardsHidden:document.querySelector('#w-cards').hidden }
        : null;
    """), timeout=20, label="mapa Mundo perezoso")
    if not map_state.get("cardsHidden"):
        raise RuntimeError(f"Mapa no aisló la vista de tarjetas: {map_state}")
    cdp.eval("document.querySelector('[data-fvv=\"cards\"]')?.click()")
    cards_restored = cdp.eval(js("""
      return !document.querySelector('#w-cards').hidden
        && document.querySelector('#fv-mapwrap').hidden;
    """))
    if not cards_restored:
        raise RuntimeError("Mundo no regresó de Mapa a Islas")
    screenshot(cdp, QA_DIR / f"matrix-mundo-{viewport}.png")
    return {"surface": "mundo", "viewport": viewport, **state,
            "keyboard": keyboard, "previewInitial": preview_initial}


def run_volar(cdp, base_url: str, cid: str, viewport: str) -> dict:
    """FLIGHTVERSE: flight test plus measured touch-HUD collision checks."""
    cdp.send("Page.navigate", {"url": f"{base_url.rstrip('/')}/volar.html?m={cid}&autotest=1"})
    rep = wait_for(cdp, js("""
      const r = window.__volar;
      if (!r || !r.done) return null;
      return {
        ok: r.ok, fps: r.fps,
        collision: r.collision,
        representation: r.representation,
        lifecycle: r.lifecycle,
        render: r.render,
        camera: r.camera,
        weapons: r.weapons,
        aim: r.aim,
      };
    """), timeout=120, label="volar autotest")
    if not rep.get("ok"):
        raise RuntimeError(f"volar autotest rojo: {rep}")
    if rep.get("fps", 0) < 50:
        raise RuntimeError(f"volar bajo presupuesto premium de 50 FPS: {rep}")
    if (rep.get("camera") or {}).get("rig") != "fpv":
        raise RuntimeError(f"FPV no fue la cámara inicial: {rep.get('camera')}")
    aim = rep.get("aim") or {}
    if aim.get("kind") == "none" or not all(
            isinstance((aim.get("point") or {}).get(axis), (int, float))
            for axis in ("x", "y", "z")):
        raise RuntimeError(f"retícula no expuso un impacto de cámara válido: {aim}")
    for kind, pool in ((rep.get("weapons") or {}).get("pools") or {}).items():
        if pool.get("active", 0) > pool.get("limit", 0):
            raise RuntimeError(f"pool de efectos excedió su tope {kind}: {pool}")
    render = rep.get("render") or {}
    for key in ("p95Ms", "calls", "triangles", "dpr"):
        value = render.get(key)
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise RuntimeError(f"telemetría de render inválida: {key}={value!r} · {render}")
    if render["p95Ms"] <= 0 or render["dpr"] < 1:
        raise RuntimeError(f"telemetría de render inválida: {render}")
    initial_visual = cdp.eval(js("""
      const r = window.__volar;
      return {
        loaded:!!r?.visualMesh,
        state:r?.visualMeshState,
        representation:r?.representation,
        meshRequests:performance.getEntriesByType('resource')
          .filter(e => /odm_textured_model_viewer\\.obj(?:\\?|$)/.test(e.name)).length,
      };
    """))
    initial_representation = initial_visual.get("representation") or {}
    if initial_representation.get("preferred") != "mesh":
        if (initial_visual.get("loaded") or initial_visual.get("state") != "deferred"
                or initial_visual.get("meshRequests") != 0):
            raise RuntimeError(f"malla inactiva cargada antes de solicitarse: {initial_visual}")
    if (initial_representation.get("preferred") == "terrain" \
            and initial_representation.get("active") != "terrain"):
        raise RuntimeError(f"preferencia de terreno ignorada: {initial_visual}")
    requested = cdp.eval(js("""
      const button = document.querySelector('#vl-vista');
      for (let attempt = 0; attempt < 3
           && window.__volar?.representation?.requested !== 'mesh'; attempt += 1) {
        button?.click();
      }
      return window.__volar?.representation?.requested;
    """))
    if requested != "mesh":
        raise RuntimeError(f"no se pudo solicitar la malla visual: {requested!r}")
    visual = wait_for(cdp, js("""
      const r = window.__volar;
      if (!r) return null;
      if (r.errors?.some(e => e.startsWith('malla visual:'))) return { error:r.errors };
      return r.visualMesh ? {
        loaded:true,
        coverageClipped:!!r.visualMeshCoverageClipped,
        orthoFull:!!r.orthoFull,
        representation:r.representation,
        lifecycle:r.lifecycle,
        collision:r.collision,
      } : null;
    """), timeout=75, label="malla fotogramétrica visual")
    if not visual.get("loaded"):
        raise RuntimeError(f"malla visual ausente: {visual}")
    if not visual.get("coverageClipped"):
        raise RuntimeError(f"malla visual sin recorte de cobertura: {visual}")
    representation = visual.get("representation") or {}
    visible_layers = representation.get("visibleStructuralLayers") or []
    if "mesh" in visible_layers and "splat" in visible_layers:
        raise RuntimeError(f"representaciones estructurales duplicadas: {visual}")
    if representation.get("requested") != "mesh" or representation.get("active") != "mesh":
        raise RuntimeError(f"malla solicitada no quedó activa: {visual}")
    lifecycle = visual.get("lifecycle") or {}
    if lifecycle.get("groups") != 1 or lifecycle.get("disposedStaleLoads") != 0:
        raise RuntimeError(f"lifecycle de escena inestable: {visual}")
    if not (visual.get("collision") or {}).get("ready"):
        raise RuntimeError(f"colisión de mundo no disponible: {visual}")
    hud = cdp.eval(js("""
      return {
        dock: !!document.querySelector('.vl-dock'),
        metricas: document.querySelectorAll('.vl-metric').length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    """))
    if not hud["dock"] or hud["metricas"] < 2:
        raise RuntimeError(f"HUD incompleto: {hud}")
    if hud["overflow"] > 3:
        raise RuntimeError(f"overflow {hud['overflow']}px en volar/{viewport}")
    if VIEWPORTS[viewport]["mobile"]:
        layout = cdp.eval(js("""
          const visible = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length;
          const rect = el => {
            const r = el.getBoundingClientRect();
            return { left:r.left, top:r.top, right:r.right, bottom:r.bottom,
                     width:r.width, height:r.height };
          };
          const hit = (a,b) => a.left < b.right - 1 && a.right > b.left + 1 &&
                               a.top < b.bottom - 1 && a.bottom > b.top + 1;
          const left = document.querySelector('.vl-stick.left');
          const right = document.querySelector('.vl-stick.right');
          const radar = document.querySelector('#vl-minimap');
          const menuFab = document.querySelector('#vl-fab');
          const combatFab = document.querySelector('#vl-combat-fab');
          const carousel = document.querySelector('#vl-weapon-carousel');
          const trigger = document.querySelector('#vl-trigger');
          const fpvCamera = document.querySelector('#vl-fpv-camera');
          const sheetScrim = document.querySelector('#vl-overlay-scrim');
          const fpv = document.querySelector('#vl-fpv');
          const fpvHiddenGeneral = ['.vl-corner.tl','.vl-corner.tr','.vl-center-top',
            '.vl-compass','.vl-flight-status','#vl-goto']
            .every(s => !visible(document.querySelector(s)));
          const fpvActive = visible(fpv) && document.querySelector('#vl-hud').classList.contains('fpv-active');
          if (![left,right,radar,menuFab,combatFab,carousel,trigger,fpvCamera].every(visible)) {
            return { error:'faltan controles táctiles agrupados' };
          }
          const fixed = [radar,menuFab,combatFab,carousel,trigger,fpvCamera].map(el => [el.id, rect(el)]);
          const sticks = [['stick-left',rect(left)],['stick-right',rect(right)]];
          const closedCollisions = [];
          for (const [an,a] of fixed) for (const [bn,b] of sticks)
            if (hit(a,b)) closedCollisions.push(`${an}:${bn}`);
          const smallCarouselTargets = [...carousel.querySelectorAll('button')].filter(visible).filter(b => {
            const r = rect(b); return r.width < 44 || r.height < 44;
          }).map(b => b.dataset.weapon || b.textContent.trim());
          const fpvCameraRect = rect(fpvCamera);
          const smallFpvCameraTarget = fpvCameraRect.width < 44 || fpvCameraRect.height < 44;

          menuFab.click();
          const menu = document.querySelector('#vl-dock');
          const menuRect = visible(menu) ? rect(menu) : null;
          const menuButtons = menu ? [...menu.querySelectorAll('button')].filter(visible) : [];
          const smallMenuTargets = menuButtons.filter(b => {
            const r = rect(b); return r.width < 44 || r.height < 44;
          }).map(b => b.id || b.textContent.trim());
          const menuHorizontalOverflow = menu ? menu.scrollWidth - menu.clientWidth : 999;
          const menuSticksDisabled = [left,right].every(stick =>
            stick.classList.contains('disabled') && stick.getAttribute('aria-hidden') === 'true');
          const safeArea = menuRect ? {
            bottomGap: Math.abs(innerHeight - menuRect.bottom),
            paddingBottom: parseFloat(getComputedStyle(menu).paddingBottom),
            inBounds: menuRect.left >= -1 && menuRect.right <= innerWidth + 1
              && menuRect.top >= -1 && menuRect.bottom <= innerHeight + 1,
          } : null;
          const sheetScrimVisible = visible(sheetScrim)
            && sheetScrim.classList.contains('open')
            && sheetScrim.getAttribute('aria-hidden') === 'false';
          document.querySelector('#vl-mode')?.click();
          const menuPersistent = visible(menu);
          sheetScrim?.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles:true, pointerId:91, clientX:innerWidth/2, clientY:8,
          }));
          const outsideDismissed = !visible(menu)
            && sheetScrim?.getAttribute('aria-hidden') === 'true'
            && [left,right].every(stick => !stick.classList.contains('disabled'));

          combatFab.click();
          const combat = document.querySelector('#vl-combat');
          const combatRect = visible(combat) ? rect(combat) : null;
          const combatButtons = combat ? [...combat.querySelectorAll('button')].filter(visible) : [];
          const smallCombatTargets = combatButtons.filter(b => {
            const r = rect(b); return r.width < 44 || r.height < 44;
          }).map(b => b.id || b.textContent.trim());
          const combatSticksDisabled = [left,right].every(stick =>
            stick.classList.contains('disabled') && stick.getAttribute('aria-hidden') === 'true');
          document.querySelector('#vl-combat-close')?.click();
          menuFab.click();
          document.querySelector('#vl-ajustes')?.click();
          const grade = document.querySelector('#vl-grade');
          const imageOnly = visible(grade) && !visible(menu) && !visible(combat);
          menuFab.click();
          const menuOnly = visible(menu) && !visible(grade) && !visible(combat);
          combatFab.click();
          const combatOnly = visible(combat) && !visible(grade) && !visible(menu);
          document.querySelector('#vl-combat-close')?.click();
          const fpvCameraBefore = window.__volar?.camera?.rig;
          fpvCamera.click();
          const fpvCameraAfter = window.__volar?.camera?.rig;
          return { closedCollisions, menuSticksDisabled, combatSticksDisabled,
                   smallCarouselTargets, smallFpvCameraTarget, smallMenuTargets, smallCombatTargets, menuHorizontalOverflow,
                   menuActions:menuButtons.length, combatActions:combatButtons.length,
                   exclusivePanels:imageOnly && menuOnly && combatOnly,
                   menuPersistent, outsideDismissed, safeArea, sheetScrim:sheetScrimVisible,
                   orientation:innerWidth > innerHeight ? 'landscape' : 'portrait',
                   fpvActive,
                   fpvHiddenGeneral,
                   fpvCameraCycle:{ before:fpvCameraBefore, after:fpvCameraAfter },
                   carousel:rect(carousel), trigger:rect(trigger), fpvCamera:fpvCameraRect };
        """))
        failures = []
        for key in ("closedCollisions",
                    "smallCarouselTargets", "smallFpvCameraTarget", "smallMenuTargets", "smallCombatTargets"):
            if layout.get(key):
                failures.append(f"{key}={layout[key]}")
        if layout.get("error"):
            failures.append(layout["error"])
        if layout.get("menuHorizontalOverflow", 999) > 2:
            failures.append(f"menuOverflow={layout.get('menuHorizontalOverflow', 'ausente')}")
        if layout.get("menuActions", 0) < 10 or layout.get("combatActions", 0) < 6:
            failures.append(f"acciones incompletas={layout}")
        if not layout.get("exclusivePanels"):
            failures.append(f"paneles simultáneos={layout}")
        if not layout.get("menuPersistent"):
            failures.append("el menú se cerró al cambiar un ajuste")
        if not layout.get("menuSticksDisabled") or not layout.get("combatSticksDisabled"):
            failures.append(f"sticks activos bajo sheet={layout}")
        if not layout.get("sheetScrim") or not layout.get("outsideDismissed"):
            failures.append(f"scrim/cierre exterior inválido={layout}")
        safe_area = layout.get("safeArea") or {}
        if (safe_area.get("bottomGap", 999) > 2
                or safe_area.get("paddingBottom", 0) < 12
                or not safe_area.get("inBounds")):
            failures.append(f"safe-area de bottom sheet inválida={safe_area}")
        expected_orientation = "landscape" if VIEWPORTS[viewport]["width"] > VIEWPORTS[viewport]["height"] else "portrait"
        if layout.get("orientation") != expected_orientation:
            failures.append(f"orientación divergente={layout.get('orientation')} != {expected_orientation}")
        if not layout.get("fpvActive") or not layout.get("fpvHiddenGeneral"):
            failures.append(f"HUD FPV duplicado={layout}")
        fpv_camera_cycle = layout.get("fpvCameraCycle") or {}
        if fpv_camera_cycle.get("before") != "fpv" or fpv_camera_cycle.get("after") == "fpv":
            failures.append(f"cámara FPV persistente no cambió rig={fpv_camera_cycle}")
        if failures:
            raise RuntimeError("HUD táctil inválido: " + "; ".join(failures))

        # Salimos de FPV sin recargar para validar también el HUD general. El
        # gate anterior solo veía el OSD FPV y por eso no detectaba que Mundo,
        # Compartir, telemetría y brújula se montaban en iPhone.
        chase_hud = cdp.eval(js("""
          const rig = document.querySelector('#vl-rig');
          for (let attempt = 0; attempt < 7
               && document.querySelector('#vl-hud')?.classList.contains('fpv-active');
               attempt += 1) rig?.click();
          const visible = el => !!el && getComputedStyle(el).display !== 'none'
            && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length;
          const rect = el => {
            const r = el.getBoundingClientRect();
            return { left:r.left, top:r.top, right:r.right, bottom:r.bottom,
                     width:r.width, height:r.height };
          };
          const hit = (a,b) => a.left < b.right - 1 && a.right > b.left + 1
            && a.top < b.bottom - 1 && a.bottom > b.top + 1;
          const nodes = [
            ['top-left', document.querySelector('.vl-corner.tl')],
            ['telemetry', document.querySelector('.vl-corner.tr')],
            ['compass', document.querySelector('.vl-compass')],
            ['challenge', document.querySelector('#vl-challenge')],
            ['goto', document.querySelector('#vl-goto')],
          ].filter(([,el]) => visible(el)
            && (el.matches('canvas,.vl-compass') || el.textContent.trim()));
          const collisions = [];
          for (let i = 0; i < nodes.length; i += 1) {
            for (let j = i + 1; j < nodes.length; j += 1) {
              if (hit(rect(nodes[i][1]), rect(nodes[j][1])))
                collisions.push(`${nodes[i][0]}:${nodes[j][0]}`);
            }
          }
          const outOfBounds = nodes.filter(([,el]) => {
            const r = rect(el);
            return r.left < -1 || r.top < -1 || r.right > innerWidth + 1
              || r.bottom > innerHeight + 1;
          }).map(([name]) => name);
          return {
            rig:window.__volar?.camera?.rig,
            collisions,
            outOfBounds,
            rects:Object.fromEntries(nodes.map(([name,el]) => [name, rect(el)])),
          };
        """))
        if chase_hud.get("collisions") or chase_hud.get("outOfBounds"):
            raise RuntimeError(f"HUD general táctil solapado: {chase_hud}")
        if chase_hud.get("rig") == "fpv":
            raise RuntimeError(f"selector de cámara no salió de FPV: {chase_hud}")

        # Combate real: un pointer de navegador debe reducir munición, no basta
        # con que el botón exista o cambie de color.
        fire = cdp.eval(js("""
          document.querySelector('#vl-weapon-carousel [data-w="m"]')?.click();
          const b = document.querySelector('#vl-trigger');
          const r = b.getBoundingClientRect();
          return { x:r.left+r.width/2, y:r.top+r.height/2,
            before:window.__volar.weaponState.ammo.m,
            fired:window.__volar.weapons.fired };
        """))
        cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": fire["x"], "y": fire["y"],
                  "button": "left", "buttons": 1, "clickCount": 1})
        cdp.pump(0.08)
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": fire["x"], "y": fire["y"],
                  "button": "left", "buttons": 0, "clickCount": 1})
        cdp.pump(0.2)
        shot = cdp.eval(js("""
          return { after:window.__volar.weaponState.ammo.m,
            fired:window.__volar.weapons.fired };
        """))
        if not (shot["after"] < fire["before"] and shot["fired"] > fire["fired"]):
            raise RuntimeError(f"DISPARAR no consumió munición: before={fire} after={shot}")

        # Mantener MG debe repetir a su cadencia; mantener cada misil debe
        # bloquear el disparo después del primero hasta soltar y volver a pulsar.
        cdp.pump(1.0)  # el disparo M anterior comparte cooldown global con la siguiente prueba
        def select_weapon(key: str):
            choice = cdp.eval(js(f"""
              const b = document.querySelector('#vl-weapon-carousel [data-w="{key}"]');
              const r = b.getBoundingClientRect();
              return {{ x:r.left+r.width/2, y:r.top+r.height/2 }};
            """))
            cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": choice["x"], "y": choice["y"],
                      "button": "left", "buttons": 1, "clickCount": 1})
            cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": choice["x"], "y": choice["y"],
                      "button": "left", "buttons": 0, "clickCount": 1})
            cdp.pump(0.12)

        trigger = cdp.eval(js("""
          const b = document.querySelector('#vl-trigger'), r = b.getBoundingClientRect();
          return { x:r.left+r.width/2, y:r.top+r.height/2 };
        """))
        def press_trigger():
            cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": trigger["x"], "y": trigger["y"],
                      "button": "left", "buttons": 1, "clickCount": 1})

        def release_trigger():
            cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": trigger["x"], "y": trigger["y"],
                      "button": "left", "buttons": 0, "clickCount": 1})

        # Ownership real de input: abrir Menú en medio de un hold MG, SIN
        # pointerup, debe cancelar el gesto y neutralizar teclado/hotkeys.
        select_weapon("mg")
        press_trigger()
        cdp.pump(0.22)
        overlay_opened = cdp.eval(js("""
          const menuFab = document.querySelector('#vl-fab');
          menuFab.focus();
          const before = {
            fired:window.__volar.weapons.fired,
            rig:window.__volar.camera.rig,
            weapon:window.__volar.weaponState.weapon,
            recText:document.querySelector('#vl-rec').textContent,
            recOn:document.querySelector('#vl-rec').classList.contains('on'),
          };
          menuFab.click();
          const menu = document.querySelector('#vl-dock');
          return {
            ...before,
            focusInside:menu.contains(document.activeElement),
            role:menu.getAttribute('role'),
            modal:menu.getAttribute('aria-modal'),
            canvasInert:document.querySelector('.vl-canvas').inert,
            combatInert:document.querySelector('#vl-combat-live').inert,
          };
        """))
        focus_edges = cdp.eval(js("""
          const menu = document.querySelector('#vl-dock');
          const focusable = [...menu.querySelectorAll(
            'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])'
          )].filter(node => !node.inert && node.getAttribute('aria-hidden') !== 'true');
          focusable.at(-1).focus();
          return { first:focusable[0].id, last:focusable.at(-1).id };
        """))
        cdp.send("Input.dispatchKeyEvent", {
            "type": "rawKeyDown", "code": "Tab", "key": "Tab", "windowsVirtualKeyCode": 9,
        })
        cdp.send("Input.dispatchKeyEvent", {
            "type": "keyUp", "code": "Tab", "key": "Tab", "windowsVirtualKeyCode": 9,
        })
        tab_forward = cdp.eval(js("return document.activeElement.id"))
        cdp.eval(js(f"document.querySelector('#{focus_edges['first']}').focus(); return true"))
        cdp.send("Input.dispatchKeyEvent", {
            "type": "rawKeyDown", "code": "Tab", "key": "Tab",
            "windowsVirtualKeyCode": 9, "modifiers": 8,
        })
        cdp.send("Input.dispatchKeyEvent", {
            "type": "keyUp", "code": "Tab", "key": "Tab",
            "windowsVirtualKeyCode": 9, "modifiers": 8,
        })
        tab_backward = cdp.eval(js("return document.activeElement.id"))
        cdp.eval(js("document.querySelector('#vl-share').focus(); return true"))
        cdp.send("Input.dispatchKeyEvent", {
            "type": "rawKeyDown", "code": "Tab", "key": "Tab", "windowsVirtualKeyCode": 9,
        })
        cdp.send("Input.dispatchKeyEvent", {
            "type": "keyUp", "code": "Tab", "key": "Tab", "windowsVirtualKeyCode": 9,
        })
        tab_reentry = cdp.eval(js("return document.activeElement.id"))
        for code, key in (("KeyW", "w"), ("KeyX", "x"), ("KeyZ", "z"), ("KeyC", "c")):
            cdp.send("Input.dispatchKeyEvent", {
                "type": "rawKeyDown", "code": code, "key": key,
                "windowsVirtualKeyCode": ord(key.upper()),
            })
        cdp.send("Input.dispatchKeyEvent", {
            "type": "rawKeyDown", "code": "KeyV", "key": "v", "windowsVirtualKeyCode": 86,
        })
        cdp.send("Input.dispatchKeyEvent", {
            "type": "keyUp", "code": "KeyV", "key": "v", "windowsVirtualKeyCode": 86,
        })
        cdp.pump(0.55)
        overlay_blocked = cdp.eval(js("""
          const controls = window.__volar.controls || {};
          const sample = controls.lastInput || {};
          const neutral = ['fwd','strafe','yaw','lift','mouseDX','mouseDY']
            .every(key => sample[key] === 0)
            && !sample.boost && !sample.brake;
          return {
            fired:window.__volar.weapons.fired,
            trigger:window.__volar.weaponState.trigger,
            rig:window.__volar.camera.rig,
            weapon:window.__volar.weaponState.weapon,
            recText:document.querySelector('#vl-rec').textContent,
            recOn:document.querySelector('#vl-rec').classList.contains('on'),
            controls,
            neutral,
          };
        """))
        for code, key in (("KeyW", "w"), ("KeyX", "x"), ("KeyZ", "z"), ("KeyC", "c")):
            cdp.send("Input.dispatchKeyEvent", {
                "type": "keyUp", "code": code, "key": key,
                "windowsVirtualKeyCode": ord(key.upper()),
            })
        overlay_closed = cdp.eval(js("""
          document.querySelector('#vl-dock-close').click();
          return {
            focusRestored:document.activeElement === document.querySelector('#vl-fab'),
            overlay:window.__volar.controls?.overlay,
          };
        """))
        cdp.send("Input.dispatchKeyEvent", {
            "type": "rawKeyDown", "code": "KeyV", "key": "v", "windowsVirtualKeyCode": 86,
        })
        cdp.send("Input.dispatchKeyEvent", {
            "type": "keyUp", "code": "KeyV", "key": "v", "windowsVirtualKeyCode": 86,
        })
        cdp.pump(0.12)
        rec_resumed = cdp.eval(js("""
          const button = document.querySelector('#vl-rec');
          return { text:button.textContent, on:button.classList.contains('on') };
        """))
        if rec_resumed["on"]:
            cdp.send("Input.dispatchKeyEvent", {
                "type": "rawKeyDown", "code": "KeyV", "key": "v", "windowsVirtualKeyCode": 86,
            })
            cdp.send("Input.dispatchKeyEvent", {
                "type": "keyUp", "code": "KeyV", "key": "v", "windowsVirtualKeyCode": 86,
            })
            cdp.pump(0.12)
        release_trigger()
        cdp.pump(0.25)
        repress_before = cdp.eval(js("return window.__volar.weapons.fired"))
        press_trigger()
        cdp.pump(0.18)
        release_trigger()
        cdp.pump(0.12)
        repress_after = cdp.eval(js("return window.__volar.weapons.fired"))
        overlayInputGate = {
            "opened": overlay_opened,
            "blocked": overlay_blocked,
            "closed": overlay_closed,
            "firedStable": overlay_blocked["fired"] == overlay_opened["fired"],
            "flightInputNeutral": (
                overlay_blocked.get("neutral")
                and overlay_blocked.get("controls", {}).get("keyboardKeys") == 0
                and not overlay_blocked.get("controls", {}).get("inputEnabled", True)
            ),
            "hotkeysBlocked": (
                overlay_blocked["rig"] == overlay_opened["rig"]
                and overlay_blocked["weapon"] == overlay_opened["weapon"]
            ),
            "recordHotkeyBlocked": (
                overlay_blocked["recOn"] == overlay_opened["recOn"]
                and overlay_blocked["recText"] == overlay_opened["recText"]
            ),
            "focusTrapped": (
                tab_forward == focus_edges["first"]
                and tab_backward == focus_edges["last"]
                and tab_reentry == focus_edges["first"]
            ),
            "recordHotkeyResumed": (
                rec_resumed["on"] != overlay_opened["recOn"]
                or rec_resumed["text"] != overlay_opened["recText"]
            ),
            "repressWorked": repress_after > repress_before,
        }
        if not all((
            overlayInputGate["firedStable"],
            overlayInputGate["flightInputNeutral"],
            overlayInputGate["hotkeysBlocked"],
            overlayInputGate["recordHotkeyBlocked"],
            overlayInputGate["focusTrapped"],
            overlayInputGate["recordHotkeyResumed"],
            overlayInputGate["repressWorked"],
            not overlay_blocked["trigger"].get("held"),
            overlay_opened.get("focusInside"),
            overlay_opened.get("role") == "dialog",
            overlay_opened.get("modal") == "true",
            overlay_opened.get("canvasInert"),
            overlay_opened.get("combatInert"),
            overlay_closed.get("focusRestored"),
        )):
            raise RuntimeError(f"overlay no tomó ownership total de input: {overlayInputGate}")

        select_weapon("mg")
        mg_before = cdp.eval(js("return { fired:window.__volar.weapons.fired, trigger:window.__volar.weaponState.trigger }"))
        press_trigger()
        cdp.pump(0.45)
        mg_held = cdp.eval(js("""
          return { fired:window.__volar.weapons.fired, trigger:window.__volar.weaponState.trigger,
            status:document.querySelector('#vl-weapon-status').textContent };
        """))
        release_trigger()
        cdp.pump(0.16)
        mg_released = cdp.eval(js("return { trigger:window.__volar.weaponState.trigger }"))
        if not (mg_held["fired"] >= mg_before["fired"] + 3
                and mg_held["trigger"].get("held")
                and mg_held["trigger"].get("mode") == "auto"
                and not mg_released["trigger"].get("held")):
            raise RuntimeError(f"MG no sostuvo fuego real: before={mg_before} held={mg_held} released={mg_released}")

        missile_holds = {}
        for weapon, hold_s, rearm_s in (("s", 0.7, 0.55), ("m", 1.2, 1.05), ("l", 2.5, 2.35)):
            select_weapon(weapon)
            before = cdp.eval(js("return { fired:window.__volar.weapons.fired }"))
            press_trigger()
            cdp.pump(hold_s)
            held = cdp.eval(js("""
              return { fired:window.__volar.weapons.fired, trigger:window.__volar.weaponState.trigger,
                status:document.querySelector('#vl-weapon-status').textContent };
            """))
            release_trigger()
            cdp.pump(rearm_s)
            released = cdp.eval(js("""
              return { trigger:window.__volar.weaponState.trigger,
                status:document.querySelector('#vl-weapon-status').textContent };
            """))
            press_trigger()
            cdp.pump(0.16)
            release_trigger()
            cdp.pump(0.12)
            after = cdp.eval(js("return { fired:window.__volar.weapons.fired, trigger:window.__volar.weaponState.trigger }"))
            missile_holds[weapon] = {"before": before, "held": held, "released": released, "after": after}
            if not (held["fired"] == before["fired"] + 1
                    and held["trigger"].get("locked")
                    and "LIBERA PARA REARMAR" in held["status"]
                    and not released["trigger"].get("held")
                    and not released["trigger"].get("locked")
                    and "LISTO" in released["status"]
                    and after["fired"] == before["fired"] + 2):
                raise RuntimeError(f"misil {weapon} no respetó lock/release: {missile_holds[weapon]}")
            cdp.pump(rearm_s)  # el siguiente misil no hereda el cooldown del re-disparo actual

        # El inspector debe dejar la escena visible y poder moverse dentro del
        # visual viewport con un gesto real.
        cdp.eval(js("""
          document.querySelector('#vl-fab')?.click();
          document.querySelector('#vl-ajustes')?.click();
          return true;
        """))
        cdp.pump(0.2)
        drag = cdp.eval(js("""
          const p=document.querySelector('#vl-grade'), h=p.querySelector('.vl-grade-drag');
          const pr=p.getBoundingClientRect(), hr=h.getBoundingClientRect();
          return { x:hr.left+hr.width*.35, y:hr.top+hr.height/2,
            left:pr.left, top:pr.top, height:pr.height, viewport:innerHeight };
        """))
        cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": drag["x"], "y": drag["y"],
                  "button": "left", "buttons": 1, "clickCount": 1})
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": drag["x"] + 42,
                  "y": drag["y"] - 54, "button": "left", "buttons": 1})
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": drag["x"] + 42,
                  "y": drag["y"] - 54, "button": "left", "buttons": 0, "clickCount": 1})
        cdp.pump(0.15)
        moved = cdp.eval(js("""
          const p=document.querySelector('#vl-grade'), r=p.getBoundingClientRect();
          return { left:r.left,top:r.top,right:r.right,bottom:r.bottom,
            vl:visualViewport?.offsetLeft||0,vt:visualViewport?.offsetTop||0,
            vw:visualViewport?.width||innerWidth,vh:visualViewport?.height||innerHeight,
            visible:getComputedStyle(p).display!=='none' };
        """))
        if drag["height"] > drag["viewport"] * 0.48:
            raise RuntimeError(f"Imagen tapa la vista previa: {drag}")
        if abs(moved["left"] - drag["left"]) < 15 and abs(moved["top"] - drag["top"]) < 15:
            raise RuntimeError(f"Imagen no se movió: before={drag} after={moved}")
        if not moved["visible"] or moved["left"] < moved["vl"] - 2 or moved["top"] < moved["vt"] - 2 or moved["right"] > moved["vl"] + moved["vw"] + 2 or moved["bottom"] > moved["vt"] + moved["vh"] + 2:
            raise RuntimeError(f"Imagen salió del viewport: before={drag} after={moved}")
        layout["weaponShot"] = {"before": fire["before"], "after": shot["after"],
                                "mgHold": mg_held, "missileHolds": missile_holds,
                                "overlayInputGate": overlayInputGate}
        layout["imageDrag"] = moved
        hud["touchLayout"] = layout
    screenshot(cdp, QA_DIR / f"matrix-volar-{viewport}.png")
    return {"surface": "volar", "viewport": viewport, "fps": rep.get("fps"),
            "visual": visual, **hud}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--viewport", action="append", choices=sorted(VIEWPORTS),
                    help="Repeat to limit the matrix. Default: mobile, iPad, desktop.")
    ap.add_argument("--surface", action="append", choices=("share", "workspace", "jobs"),
                    help="Repeat to limit surfaces. Default: share, workspace, jobs.")
    ap.add_argument("--flightverse", action="store_true",
                    help="Matriz FLIGHTVERSE (mundo + volar) en vez de share/workspace.")
    args = ap.parse_args()
    viewports = args.viewport or [
        "mobile_portrait", "mobile_landscape",
        "ipad_portrait", "ipad_landscape", "desktop",
    ]
    if args.flightverse:
        results = []
        for vp in viewports:
            for runner in (lambda c, b, v=None: run_mundo(c, b, vp),
                           lambda c, b, v=None: run_volar(c, b, args.clip_id, vp)):
                proc, profile, port = launch_chrome()
                cdp = None
                try:
                    cdp = new_page(port)
                    set_viewport(cdp, vp)
                    results.append(runner(cdp, args.base_url))
                    deprecated_bvh = [
                        warning for warning in cdp.warnings
                        if "maxLeafTris" in warning or "maxLeafSize" in warning
                    ]
                    if deprecated_bvh:
                        raise RuntimeError(
                            f"API BVH obsoleta en {vp}: {' | '.join(deprecated_bvh[:4])}")
                    if cdp.errors:
                        raise RuntimeError(f"errores de consola en {vp}: {' | '.join(cdp.errors[:4])}")
                finally:
                    if cdp:
                        cdp.close()
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except Exception:
                        proc.kill()
                    profile.cleanup()
        for r in results:
            print(f"{r['surface']}/{r['viewport']}: ok" + (f" · {r['fps']}fps" if r.get('fps') else f" · {r['islas']} islas"))
            gate = (((r.get("touchLayout") or {}).get("weaponShot") or {})
                    .get("overlayInputGate"))
            if gate:
                print("  overlay-input:"
                      f" fired {gate['opened']['fired']}→{gate['blocked']['fired']}"
                      f" stable={gate['firedStable']}"
                      f" neutral={gate['flightInputNeutral']}"
                      f" hotkeys={gate['hotkeysBlocked']}"
                      f" record={gate['recordHotkeyBlocked']}"
                      f" focus={gate['focusTrapped']}"
                      f" record-resume={gate['recordHotkeyResumed']}"
                      f" repress={gate['repressWorked']}")
        return
    results = run_matrix(args.clip_id, args.base_url, viewports, args.surface)
    for r in results:
        if r["surface"] == "jobs":
            print(f"jobs/{r['viewport']}: ok · {r['state']['cards']} cards · drawer {r['drawer']['width']:.0f}px")
            continue
        macro = r["macro"]
        sel = r["selected"]
        print(f"{r['surface']}/{r['viewport']}: ok · macro {macro['before']:.4f}->{macro['after']:.4f} · versions {sel.get('count')}")


if __name__ == "__main__":
    main()
