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


def touch_point(pointer_id: int, x: float, y: float) -> dict:
    """Build one CDP touch point. Callers retain and resend every active point."""
    return {
        "id": pointer_id,
        "x": x,
        "y": y,
        "radiusX": 8,
        "radiusY": 8,
        "force": 1,
    }


def dispatch_touches(cdp, event_type: str, points: list[dict]):
    """Dispatch a CDP touch transition.

    touchStart/touchMove carry the active points. touchEnd carries the points
    being lifted; Chrome keeps all omitted contacts active.
    """
    cdp.send("Input.dispatchTouchEvent", {
        "type": event_type,
        "touchPoints": points,
    })


def release_touches(cdp, points: list[dict]):
    """Lift exactly these CDP contacts while preserving omitted contacts."""
    dispatch_touches(cdp, "touchEnd", points)


def synthesize_tap(cdp, x: float, y: float, *, tap_count: int = 1,
                   duration_ms: int = 45):
    cdp.send("Input.synthesizeTapGesture", {
        "x": x,
        "y": y,
        "duration": duration_ms,
        "tapCount": tap_count,
        "gestureSourceType": "touch",
    })


def command_hud_screenshot_path(viewport: str, state: str) -> Path:
    if state not in {"closed", "weapons", "menu"}:
        raise ValueError(f"estado de captura táctil inválido: {state}")
    return QA_DIR / f"matrix-volar-{viewport}-{state}.png"


def apply_safe_area_override(cdp) -> dict:
    """Apply and resolve a real non-zero CDP safe-area emulation."""
    requested = {"top": 17, "right": 13, "bottom": 23, "left": 11}
    try:
        cdp.send("Emulation.setSafeAreaInsetsOverride", {"insets": requested})
    except Exception as exc:
        return {
            "supported": False,
            "requested": requested,
            "resolved": {},
            "violations": [],
            "error": repr(exc),
        }
    cdp.pump(0.1)
    resolved = cdp.eval(js("""
      let probe=document.querySelector('#task3-safe-area-probe');
      if (!probe) {
        probe=document.createElement('div');
        probe.id='task3-safe-area-probe';
        probe.style.cssText=[
          'position:fixed','visibility:hidden','pointer-events:none',
          'padding-top:env(safe-area-inset-top)',
          'padding-right:env(safe-area-inset-right)',
          'padding-bottom:env(safe-area-inset-bottom)',
          'padding-left:env(safe-area-inset-left)',
        ].join(';');
        document.body.append(probe);
      }
      const style=getComputedStyle(probe);
      return {
        top:parseFloat(style.paddingTop) || 0,
        right:parseFloat(style.paddingRight) || 0,
        bottom:parseFloat(style.paddingBottom) || 0,
        left:parseFloat(style.paddingLeft) || 0,
      };
    """))
    return {
        "supported": True,
        "requested": requested,
        "resolved": resolved,
        "violations": [],
    }


def element_center(cdp, selector: str) -> dict:
    center = cdp.eval(js(f"""
      const el = document.querySelector({selector!r});
      if (!el || getComputedStyle(el).display === 'none' || !el.getClientRects().length) return null;
      const r = el.getBoundingClientRect();
      return {{ x:r.left+r.width/2, y:r.top+r.height/2, width:r.width, height:r.height }};
    """))
    if not center:
        raise RuntimeError(f"control táctil ausente o invisible: {selector}")
    return center


def touch_tap(cdp, pointer_id: int, point: dict, settle: float = 0.12):
    active = [touch_point(pointer_id, point["x"], point["y"])]
    dispatch_touches(cdp, "touchStart", active)
    cdp.pump(0.04)
    dispatch_touches(cdp, "touchEnd", [])
    cdp.pump(settle)


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


def touch_command_geometry(cdp, state: str) -> dict:
    """Measure the command surface in one of its three user-visible states."""
    return cdp.eval(js(f"""
      const state = {state!r};
      const visible = el => {{
        if (!el || !el.getClientRects().length
            || el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
        for (let node=el; node && node.nodeType === 1; node=node.parentElement) {{
          const style=getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden'
              || parseFloat(style.opacity || '1') <= 0.05) return false;
        }}
        return true;
      }};
      const rect = el => {{
        const r = el.getBoundingClientRect();
        return {{ left:r.left, top:r.top, right:r.right, bottom:r.bottom,
          width:r.width, height:r.height }};
      }};
      const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1
        && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      const vv = window.visualViewport;
      const viewport = {{
        left:vv?.offsetLeft || 0,
        top:vv?.offsetTop || 0,
        right:(vv?.offsetLeft || 0) + (vv?.width || innerWidth),
        bottom:(vv?.offsetTop || 0) + (vv?.height || innerHeight),
        width:vv?.width || innerWidth,
        height:vv?.height || innerHeight,
      }};
      const elements = {{
        leftZone:document.querySelector('.vl-stick.left'),
        rightZone:document.querySelector('.vl-stick.right'),
        leftBase:document.querySelector('.vl-stick.left .vl-stick-base'),
        rightBase:document.querySelector('.vl-stick.right .vl-stick-base'),
        fire:document.querySelector('#vl-trigger'),
        weapon:document.querySelector('#vl-weapon-toggle'),
        picker:document.querySelector('#vl-weapon-picker'),
        menu:document.querySelector('#vl-fab'),
        sheetScrim:document.querySelector('#vl-overlay-scrim'),
        sheet:document.querySelector('#vl-dock'),
      }};
      const boxes = Object.fromEntries(Object.entries(elements)
        .filter(([,el]) => visible(el)).map(([name,el]) => [name,rect(el)]));
      const pairs = [
        ['leftZone','rightZone'],
        ['leftZone','fire'], ['leftZone','weapon'], ['leftZone','picker'], ['leftZone','menu'],
        ['rightZone','fire'], ['rightZone','weapon'], ['rightZone','picker'], ['rightZone','menu'],
        ['leftBase','rightBase'],
        ['leftBase','fire'], ['leftBase','weapon'], ['leftBase','picker'], ['leftBase','menu'],
        ['rightBase','fire'], ['rightBase','weapon'], ['rightBase','picker'], ['rightBase','menu'],
        ['fire','weapon'], ['fire','picker'], ['fire','menu'],
        ['weapon','picker'], ['weapon','menu'], ['picker','menu'],
      ];
      const collisions = pairs
        .filter(([a,b]) => boxes[a] && boxes[b] && hit(boxes[a], boxes[b]))
        .map(([a,b]) => `${{a}}:${{b}}`);
      const outOfBounds = Object.entries(boxes)
        .filter(([name,r]) => name !== 'sheet' && (
          r.left < viewport.left - 1 || r.top < viewport.top - 1
          || r.right > viewport.right + 1 || r.bottom > viewport.bottom + 1))
        .map(([name]) => name);
      const smallTargets = [
        ['fire',elements.fire,72,72],
        ['weapon',elements.weapon,56,56],
        ['menu',elements.menu,52,52],
        ...[...elements.picker?.querySelectorAll('button') || []]
          .map((el,index) => [`picker-${{index}}`,el,44,48]),
      ].filter(([,el]) => visible(el)).filter(([,el,w,h]) => {{
        const r = rect(el); return r.width < w - 1 || r.height < h - 1;
      }}).map(([name]) => name);
      const commandHidden = !visible(elements.fire) && !visible(elements.weapon)
        && !visible(elements.menu) && !visible(elements.leftZone) && !visible(elements.rightZone);
      const focusInside = !!elements.sheet?.contains(document.activeElement);
      const sheetInBounds = !boxes.sheet || (
        boxes.sheet.left >= viewport.left - 1 && boxes.sheet.top >= viewport.top - 1
        && boxes.sheet.right <= viewport.right + 1
        && boxes.sheet.bottom <= viewport.bottom + 1);
      const probe=document.querySelector('#task3-safe-area-probe');
      const probeStyle=probe ? getComputedStyle(probe) : null;
      const resolvedSafeArea={{
        top:parseFloat(probeStyle?.paddingTop) || 0,
        right:parseFloat(probeStyle?.paddingRight) || 0,
        bottom:parseFloat(probeStyle?.paddingBottom) || 0,
        left:parseFloat(probeStyle?.paddingLeft) || 0,
      }};
      const safeNames=['leftBase','rightBase','fire','weapon','picker','menu'];
      const safeViolations=safeNames.filter(name => {{
        const r=boxes[name];
        return r && (
          r.left < viewport.left + resolvedSafeArea.left - 1
          || r.top < viewport.top + resolvedSafeArea.top - 1
          || r.right > viewport.right - resolvedSafeArea.right + 1
          || r.bottom > viewport.bottom - resolvedSafeArea.bottom + 1
        );
      }});
      if (boxes.sheet) {{
        const style=getComputedStyle(elements.sheet);
        const padding={{
          top:parseFloat(style.paddingTop) || 0,
          right:parseFloat(style.paddingRight) || 0,
          bottom:parseFloat(style.paddingBottom) || 0,
          left:parseFloat(style.paddingLeft) || 0,
        }};
        if (boxes.sheet.top < viewport.top + resolvedSafeArea.top - 1
            || padding.right < resolvedSafeArea.right
            || padding.bottom < resolvedSafeArea.bottom
            || padding.left < resolvedSafeArea.left) {{
          safeViolations.push('sheet');
        }}
      }}
      return {{
        state, boxes, collisions, outOfBounds, smallTargets, viewport,
        orientation:viewport.width >= viewport.height ? 'landscape' : 'portrait',
        pickerVisible:visible(elements.picker),
        sheetVisible:visible(elements.sheet),
        commandHidden, focusInside, sheetInBounds,
        safeArea:{{
          resolved:resolvedSafeArea,
          violations:safeViolations,
          leftGap:Math.min(...Object.values(boxes).map(r => r.left - viewport.left)),
          rightGap:Math.min(...Object.values(boxes).map(r => viewport.right - r.right)),
          topGap:Math.min(...Object.values(boxes).map(r => r.top - viewport.top)),
          bottomGap:Math.min(...Object.values(boxes).map(r => viewport.bottom - r.bottom)),
        }},
      }};
    """))


def geometry_failures(geometry: dict) -> list[str]:
    state = geometry.get("state", "unknown")
    failures = []
    if geometry.get("collisions"):
        failures.append(
            f"{state} collisions={geometry['collisions']} boxes={geometry.get('boxes')}"
        )
    if geometry.get("outOfBounds"):
        failures.append(f"{state} outOfBounds={geometry['outOfBounds']}")
    if geometry.get("smallTargets"):
        failures.append(f"{state} smallTargets={geometry['smallTargets']}")
    if not geometry.get("sheetInBounds"):
        failures.append(f"{state} sheet fuera del visual viewport")
    if state == "closed" and geometry.get("pickerVisible"):
        failures.append("closed picker visible")
    if state == "weapons" and not geometry.get("pickerVisible"):
        failures.append("weapons picker oculto")
    if state == "menu" and not all((
            geometry.get("sheetVisible"),
            geometry.get("commandHidden"),
            geometry.get("focusInside"),
    )):
        failures.append(
            "menu no ocultó command HUD/sticks o no tomó foco="
            f"{geometry.get('sheetVisible')}/"
            f"{geometry.get('commandHidden')}/"
            f"{geometry.get('focusInside')}"
        )
    return failures


def safe_area_failures(evidence: dict) -> list[str]:
    if not evidence.get("supported"):
        return [f"CDP safe-area override no soportado: {evidence.get('error', 'sin detalle')}"]
    resolved = evidence.get("resolved") or {}
    if not all((resolved.get(edge) or 0) > 0 for edge in ("top", "right", "bottom", "left")):
        return ["safe-area env no resolvió insets no-cero"]
    if evidence.get("violations"):
        return [f"controles/sheet invaden safe-area: {evidence['violations']}"]
    return []


def base_acceptance_failures(evidence: dict) -> list[str]:
    failures = []
    focus = evidence.get("focusTrap") or {}
    if not all(focus.get(edge) for edge in ("forward", "backward", "reentry")):
        failures.append("focus trap incompleto")
    inert = evidence.get("inert") or {}
    if not inert.get("canvas") or not inert.get("combat"):
        failures.append("canvas/combate no quedaron inert")
    if not evidence.get("heldMgCancelled"):
        failures.append("held MG no fue cancelado al abrir Menú")
    if not evidence.get("neutralWhileOpen"):
        failures.append("input de vuelo no quedó neutral bajo overlay")
    hotkeys = evidence.get("hotkeys") or {}
    if not hotkeys.get("blocked") or not hotkeys.get("restored"):
        failures.append("hotkeys no se bloquearon/restauraron")
    if not evidence.get("repressWorked"):
        failures.append("Fire no aceptó repress tras cerrar Menú")
    scrim = evidence.get("scrim") or {}
    if not scrim.get("visible") or not scrim.get("outsideDismissed"):
        failures.append("scrim/cierre exterior inválido")
    sheets = evidence.get("sheets") or {}
    if not sheets.get("actionsComplete") or not sheets.get("targetsLarge"):
        failures.append("acciones/tap targets de sheets incompletos")
    if not evidence.get("exclusiveOverlays"):
        failures.append("overlays no fueron exclusivos")
    if not evidence.get("cameraCycle"):
        failures.append("ciclo de cámara móvil inválido")
    chase = evidence.get("chaseHud") or {}
    if chase.get("collisions") or chase.get("outOfBounds"):
        failures.append("HUD chase solapado/fuera de bounds")
    return failures


def wait_weapon_ready(cdp, timeout: int = 5):
    return wait_for(
        cdp,
        js("""
          const w = window.__volar?.weaponState;
          return w && w.cool <= 0.01 ? w : null;
        """),
        timeout=timeout,
        label="cooldown de arma",
    )


def select_weapon_touch(cdp, key: str, pointer_id: int):
    toggle = element_center(cdp, "#vl-weapon-toggle")
    synthesize_tap(cdp, toggle["x"], toggle["y"])
    wait_for(
        cdp,
        js("""
          const picker=document.querySelector('#vl-weapon-picker');
          return picker && !picker.hidden && picker.getClientRects().length;
        """),
        timeout=4,
        label="selector de armas",
    )
    choice = element_center(cdp, f'#vl-weapon-picker [data-w="{key}"]')
    touch_tap(cdp, pointer_id, choice)
    selected = wait_for(
        cdp,
        js(f"return window.__volar?.weaponState?.weapon === {key!r}"),
        timeout=4,
        label=f"selección táctil {key}",
    )
    return bool(selected)


def run_mobile_base_acceptance(cdp, viewport: str) -> dict:
    """Retain the established mobile overlay, hotkey, sheet, and chase gates."""
    def key_event(code: str, key: str, down: bool, modifiers: int = 0):
        cdp.send("Input.dispatchKeyEvent", {
            "type": "rawKeyDown" if down else "keyUp",
            "code": code,
            "key": key,
            "windowsVirtualKeyCode": ord(key.upper()) if len(key) == 1 else 9,
            "modifiers": modifiers,
        })

    wait_weapon_ready(cdp)
    select_weapon_touch(cdp, "mg", 950)
    wait_weapon_ready(cdp)
    trigger = element_center(cdp, "#vl-trigger")
    held_point = touch_point(951, trigger["x"], trigger["y"])
    dispatch_touches(cdp, "touchStart", [held_point])
    cdp.pump(0.22)
    held_before_menu = cdp.eval(js("""
      return {
        fired:window.__volar.weapons.fired,
        trigger:window.__volar.weaponState.trigger,
      };
    """))
    opened = cdp.eval(js("""
      const menuFab=document.querySelector('#vl-fab');
      menuFab.focus();
      menuFab.click();
      const menu=document.querySelector('#vl-dock');
      const sample=window.__volar.controls?.lastInput || {};
      return {
        fired:window.__volar.weapons.fired,
        trigger:window.__volar.weaponState.trigger,
        rig:window.__volar.camera.rig,
        weapon:window.__volar.weaponState.weapon,
        recText:document.querySelector('#vl-rec').textContent,
        recOn:document.querySelector('#vl-rec').classList.contains('on'),
        overlay:window.__volar.controls?.overlay,
        focusInside:menu.contains(document.activeElement),
        role:menu.getAttribute('role'),
        modal:menu.getAttribute('aria-modal'),
        canvasInert:document.querySelector('.vl-canvas').inert,
        combatInert:document.querySelector('#vl-command-hud').inert,
        neutral:['fwd','strafe','yaw','lift','mouseDX','mouseDY']
          .every(key => (sample[key] || 0) === 0)
          && !sample.boost && !sample.brake,
      };
    """))
    # The overlay already cancelled runtime ownership. Cancel the physical CDP
    # set: touchEnd is retargeted to the newly focused close button and Chrome
    # synthesizes an unwanted click, while touchCancel cannot activate it.
    dispatch_touches(cdp, "touchCancel", [])
    cdp.pump(0.45)

    focus_edges = cdp.eval(js("""
      const menu=document.querySelector('#vl-dock');
      const focusable=[...menu.querySelectorAll(
        'button:not([disabled]),[href],input:not([disabled]),'
        + 'select:not([disabled]),textarea:not([disabled])'
      )].filter(node => !node.inert && node.getAttribute('aria-hidden') !== 'true');
      focusable.at(-1).focus();
      return { first:focusable[0].id, last:focusable.at(-1).id };
    """))
    key_event("Tab", "Tab", True)
    key_event("Tab", "Tab", False)
    tab_forward = cdp.eval(js("return document.activeElement.id"))
    cdp.eval(js(
        f"document.querySelector('#{focus_edges['first']}').focus(); return true"
    ))
    key_event("Tab", "Tab", True, modifiers=8)
    key_event("Tab", "Tab", False, modifiers=8)
    tab_backward = cdp.eval(js("return document.activeElement.id"))
    cdp.eval(js("document.querySelector('#vl-share').focus(); return true"))
    key_event("Tab", "Tab", True)
    key_event("Tab", "Tab", False)
    tab_reentry = cdp.eval(js("return document.activeElement.id"))

    blocked_codes = (
        ("KeyW", "w"), ("KeyX", "x"), ("KeyZ", "z"), ("KeyC", "c")
    )
    for code, key in blocked_codes:
        key_event(code, key, True)
    key_event("KeyV", "v", True)
    key_event("KeyV", "v", False)
    cdp.pump(0.55)
    blocked = cdp.eval(js("""
      const controls=window.__volar.controls || {};
      const sample=controls.lastInput || {};
      return {
        fired:window.__volar.weapons.fired,
        trigger:window.__volar.weaponState.trigger,
        rig:window.__volar.camera.rig,
        weapon:window.__volar.weaponState.weapon,
        recText:document.querySelector('#vl-rec').textContent,
        recOn:document.querySelector('#vl-rec').classList.contains('on'),
        controls,
        neutral:['fwd','strafe','yaw','lift','mouseDX','mouseDY']
          .every(key => (sample[key] || 0) === 0)
          && !sample.boost && !sample.brake,
      };
    """))
    for code, key in blocked_codes:
        key_event(code, key, False)

    menu_sheet = cdp.eval(js("""
      const visible=el => {
        if (!el || !el.getClientRects().length
            || el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
        for (let node=el; node && node.nodeType === 1; node=node.parentElement) {
          const style=getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden'
              || parseFloat(style.opacity || '1') <= .05) return false;
        }
        return true;
      };
      const targetData=panel => {
        const buttons=[...panel.querySelectorAll('button')].filter(visible);
        return {
          count:buttons.length,
          small:buttons.filter(button => {
            const r=button.getBoundingClientRect();
            return r.width < 44 || r.height < 44;
          }).map(button => button.id || button.textContent.trim()),
          overflow:panel.scrollWidth - panel.clientWidth,
        };
      };
      const menu=document.querySelector('#vl-dock');
      const scrim=document.querySelector('#vl-overlay-scrim');
      const menuTargets=targetData(menu);
      const scrimVisible=visible(scrim) && scrim.classList.contains('open')
        && scrim.getAttribute('aria-hidden') === 'false';
      document.querySelector('#vl-mode').click();
      const menuPersistent=visible(menu);
      const cameraBefore=window.__volar.camera.rig;
      document.querySelector('#vl-rig').click();
      const cameraAfter=window.__volar.camera.rig;
      const menuOnly=visible(menu)
        && !visible(document.querySelector('#vl-combat'))
        && !visible(document.querySelector('#vl-grade'));
      document.querySelector('#vl-armamento').click();
      return {
        menuTargets,scrimVisible,menuPersistent,
        cameraBefore,cameraAfter,menuOnly,
      };
    """))
    wait_for(
        cdp,
        js("""
          const panel=document.querySelector('#vl-combat');
          return panel.classList.contains('open')
            && parseFloat(getComputedStyle(panel).opacity || '1') > .05;
        """),
        timeout=4,
        label="sheet Combate estable",
    )
    combat_sheet = cdp.eval(js("""
      const visible=el => {
        if (!el || !el.getClientRects().length
            || el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
        for (let node=el; node && node.nodeType === 1; node=node.parentElement) {
          const style=getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden'
              || parseFloat(style.opacity || '1') <= .05) return false;
        }
        return true;
      };
      const combat=document.querySelector('#vl-combat');
      const menu=document.querySelector('#vl-dock');
      const grade=document.querySelector('#vl-grade');
      const buttons=[...combat.querySelectorAll('button')].filter(visible);
      const combatTargets={
        count:buttons.length,
        small:buttons.filter(button => {
          const r=button.getBoundingClientRect();
          return r.width < 44 || r.height < 44;
        }).map(button => button.id || button.textContent.trim()),
        overflow:combat.scrollWidth - combat.clientWidth,
      };
      const combatOnly=visible(combat) && !visible(menu) && !visible(grade);
      const combatSemantics={
        role:combat.getAttribute('role'),
        modal:combat.getAttribute('aria-modal'),
        canvasInert:document.querySelector('.vl-canvas').inert,
        commandInert:document.querySelector('#vl-command-hud').inert,
      };
      return {combatTargets,combatOnly,combatSemantics};
    """))
    cdp.eval(js("""
      document.querySelector('#vl-combat-close').click();
      document.querySelector('#vl-fab').click();
      return true;
    """))
    wait_for(
        cdp,
        js("""
          const panel=document.querySelector('#vl-dock');
          return panel.classList.contains('open')
            && parseFloat(getComputedStyle(panel).opacity || '1') > .05;
        """),
        timeout=4,
        label="Menú reabierto",
    )
    image_transition = cdp.eval(js("""
      const visible=el => !!el && el.getClientRects().length
        && getComputedStyle(el).display !== 'none'
        && getComputedStyle(el).visibility !== 'hidden'
        && parseFloat(getComputedStyle(el).opacity || '1') > .05;
      const menu=document.querySelector('#vl-dock');
      const combat=document.querySelector('#vl-combat');
      const grade=document.querySelector('#vl-grade');
      const menuOnlyAgain=visible(menu) && !visible(combat) && !visible(grade);
      document.querySelector('#vl-ajustes').click();
      return {menuOnlyAgain};
    """))
    wait_for(
        cdp,
        js("""
          const panel=document.querySelector('#vl-grade');
          return panel.classList.contains('show')
            && parseFloat(getComputedStyle(panel).opacity || '1') > .05;
        """),
        timeout=4,
        label="overlay Imagen estable",
    )
    image_only = cdp.eval(js("""
      const visible=el => !!el && el.getClientRects().length
        && getComputedStyle(el).display !== 'none'
        && getComputedStyle(el).visibility !== 'hidden'
        && parseFloat(getComputedStyle(el).opacity || '1') > .05;
      return visible(document.querySelector('#vl-grade'))
        && !visible(document.querySelector('#vl-dock'))
        && !visible(document.querySelector('#vl-combat'));
    """))
    sheets = {
        **menu_sheet,
        **combat_sheet,
        **image_transition,
        "imageOnly": image_only,
    }

    drag = cdp.eval(js("""
      const panel=document.querySelector('#vl-grade');
      const handle=panel.querySelector('.vl-grade-drag');
      const p=panel.getBoundingClientRect(), h=handle.getBoundingClientRect();
      return {
        x:h.left+h.width*.35,y:h.top+h.height/2,
        left:p.left,top:p.top,height:p.height,viewport:innerHeight,
      };
    """))
    drag_start = touch_point(952, drag["x"], drag["y"])
    drag_end = touch_point(952, drag["x"] + 42, drag["y"] - 54)
    dispatch_touches(cdp, "touchStart", [drag_start])
    dispatch_touches(cdp, "touchMove", [drag_end])
    release_touches(cdp, [drag_end])
    cdp.pump(0.15)
    image_drag = cdp.eval(js("""
      const panel=document.querySelector('#vl-grade');
      const r=panel.getBoundingClientRect(), vv=visualViewport;
      return {
        left:r.left,top:r.top,right:r.right,bottom:r.bottom,
        vl:vv?.offsetLeft||0,vt:vv?.offsetTop||0,
        vw:vv?.width||innerWidth,vh:vv?.height||innerHeight,
        visible:getComputedStyle(panel).display !== 'none',
      };
    """))
    image_drag["moved"] = (
        abs(image_drag["left"] - drag["left"]) >= 15
        or abs(image_drag["top"] - drag["top"]) >= 15
    )
    image_drag["compact"] = drag["height"] <= drag["viewport"] * 0.48
    image_drag["inBounds"] = (
        image_drag["visible"]
        and image_drag["left"] >= image_drag["vl"] - 2
        and image_drag["top"] >= image_drag["vt"] - 2
        and image_drag["right"] <= image_drag["vl"] + image_drag["vw"] + 2
        and image_drag["bottom"] <= image_drag["vt"] + image_drag["vh"] + 2
    )
    if not all((image_drag["moved"], image_drag["compact"], image_drag["inBounds"])):
        raise RuntimeError(
            f"Imagen no conservó drag compacto/bounded: before={drag} after={image_drag}"
        )
    cdp.eval(js("""
      document.querySelector('#gr-close').click();
      document.querySelector('#vl-fab').focus();
      document.querySelector('#vl-fab').click();
      return true;
    """))
    cdp.pump(0.08)
    outside_before = cdp.eval(js("""
      const scrim=document.querySelector('#vl-overlay-scrim');
      return {
        visible:scrim.classList.contains('open')
          && scrim.getAttribute('aria-hidden') === 'false',
        menuOpen:document.querySelector('#vl-dock').classList.contains('open'),
      };
    """))
    touch_tap(cdp, 953, {"x": 3, "y": 3})
    outside_after = cdp.eval(js("""
      return {
        dismissed:!document.querySelector('#vl-dock').classList.contains('open')
          && document.querySelector('#vl-overlay-scrim')
            .getAttribute('aria-hidden') === 'true',
        focusRestored:document.activeElement === document.querySelector('#vl-fab'),
      };
    """))

    restored_before = cdp.eval(js("""
      return {
        rig:window.__volar.camera.rig,
        weapon:window.__volar.weaponState.weapon,
        recText:document.querySelector('#vl-rec').textContent,
        recOn:document.querySelector('#vl-rec').classList.contains('on'),
      };
    """))
    key_event("KeyW", "w", True)
    for code, key in (("KeyZ", "z"), ("KeyC", "c"), ("KeyV", "v")):
        key_event(code, key, True)
        key_event(code, key, False)
    cdp.pump(0.2)
    restored_after = cdp.eval(js("""
      const sample=window.__volar.controls?.lastInput || {};
      return {
        rig:window.__volar.camera.rig,
        weapon:window.__volar.weaponState.weapon,
        recText:document.querySelector('#vl-rec').textContent,
        recOn:document.querySelector('#vl-rec').classList.contains('on'),
        flightActive:Math.abs(sample.fwd || 0) > 0,
      };
    """))
    key_event("KeyW", "w", False)
    if restored_after["recOn"]:
        key_event("KeyV", "v", True)
        key_event("KeyV", "v", False)
        cdp.pump(0.12)

    wait_weapon_ready(cdp)
    select_weapon_touch(cdp, "mg", 954)
    wait_weapon_ready(cdp)
    repress_before = cdp.eval(js("return window.__volar.weapons.fired"))
    touch_tap(cdp, 955, trigger)
    repress_after = cdp.eval(js("""
      return {
        fired:window.__volar.weapons.fired,
        held:window.__volar.weaponState.trigger.held,
      };
    """))

    chase_hud = cdp.eval(js("""
      const visible=el => !!el && getComputedStyle(el).display !== 'none'
        && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length;
      const rect=el => {
        const r=el.getBoundingClientRect();
        return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,
          width:r.width,height:r.height};
      };
      const hit=(a,b) => a.left < b.right - 1 && a.right > b.left + 1
        && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      const nodes=[
        ['back',document.querySelector('.vl-corner.tl .vl-back')],
        ['share',document.querySelector('#vl-share')],
        ['scene',document.querySelector('#vl-scene')],
        ['telemetry',document.querySelector('.vl-corner.tr')],
        ['compass',document.querySelector('.vl-compass')],
        ['challenge',document.querySelector('#vl-challenge')],
        ['goto',document.querySelector('#vl-goto')],
      ].filter(([,el]) => visible(el)
        && (el.matches('canvas,.vl-compass') || el.textContent.trim()));
      const collisions=[];
      for (let i=0;i<nodes.length;i+=1) for (let j=i+1;j<nodes.length;j+=1) {
        if (hit(rect(nodes[i][1]),rect(nodes[j][1])))
          collisions.push(`${nodes[i][0]}:${nodes[j][0]}`);
      }
      const outOfBounds=nodes.filter(([,el]) => {
        const r=rect(el), vv=visualViewport;
        const left=vv?.offsetLeft||0, top=vv?.offsetTop||0;
        const right=left+(vv?.width||innerWidth);
        const bottom=top+(vv?.height||innerHeight);
        return r.left < left-1 || r.top < top-1 || r.right > right+1
          || r.bottom > bottom+1;
      }).map(([name]) => name);
      return {
        rig:window.__volar.camera.rig,collisions,outOfBounds,
        rects:Object.fromEntries(nodes.map(([name,el]) => [name,rect(el)])),
      };
    """))

    focus_trap = {
        "forward": tab_forward == focus_edges["first"],
        "backward": tab_backward == focus_edges["last"],
        "reentry": tab_reentry == focus_edges["first"],
        "first": focus_edges["first"],
        "last": focus_edges["last"],
    }
    hotkeys_blocked = (
        blocked["rig"] == opened["rig"]
        and blocked["weapon"] == opened["weapon"]
        and blocked["recOn"] == opened["recOn"]
        and blocked["recText"] == opened["recText"]
        and blocked["fired"] == opened["fired"]
    )
    hotkeys_restored = (
        restored_after["rig"] != restored_before["rig"]
        and restored_after["weapon"] != restored_before["weapon"]
        and (
            restored_after["recOn"] != restored_before["recOn"]
            or restored_after["recText"] != restored_before["recText"]
        )
        and restored_after["flightActive"]
    )
    evidence = {
        "focusTrap": focus_trap,
        "inert": {
            "canvas": opened["canvasInert"],
            "combat": opened["combatInert"],
        },
        "heldMgCancelled": (
            held_before_menu["trigger"]["held"]
            and not blocked["trigger"]["held"]
            and blocked["fired"] == opened["fired"]
        ),
        "neutralWhileOpen": (
            opened["neutral"]
            and blocked["neutral"]
            and blocked.get("controls", {}).get("keyboardKeys") == 0
            and not blocked.get("controls", {}).get("inputEnabled", True)
        ),
        "hotkeys": {
            "blocked": hotkeys_blocked,
            "restored": hotkeys_restored,
            "opened": opened,
            "blockedState": blocked,
            "restoredBefore": restored_before,
            "restoredAfter": restored_after,
        },
        "repressWorked": (
            repress_after["fired"] > repress_before
            and not repress_after["held"]
        ),
        "repress": {
            "before": repress_before,
            "after": repress_after,
        },
        "scrim": {
            "visible": sheets["scrimVisible"] and outside_before["visible"],
            "outsideDismissed": (
                outside_before["menuOpen"]
                and outside_after["dismissed"]
                and outside_after["focusRestored"]
            ),
        },
        "sheets": {
            "menu": sheets["menuTargets"],
            "combat": sheets["combatTargets"],
            "menuPersistent": sheets["menuPersistent"],
            "actionsComplete": (
                sheets["menuTargets"]["count"] >= 10
                and sheets["combatTargets"]["count"] >= 6
                and sheets["menuTargets"]["overflow"] <= 2
                and sheets["combatTargets"]["overflow"] <= 2
                and sheets["menuPersistent"]
            ),
            "targetsLarge": (
                not sheets["menuTargets"]["small"]
                and not sheets["combatTargets"]["small"]
            ),
        },
        "exclusiveOverlays": all((
            sheets["menuOnly"],
            sheets["combatOnly"],
            sheets["menuOnlyAgain"],
            sheets["imageOnly"],
        )),
        "combatSemantics": sheets["combatSemantics"],
        "cameraCycle": (
            sheets["cameraBefore"] == "fpv"
            and sheets["cameraAfter"] != sheets["cameraBefore"]
        ),
        "imageDrag": image_drag,
        "chaseHud": chase_hud,
        "viewport": viewport,
    }
    failures = base_acceptance_failures(evidence)
    if not all((
        opened["focusInside"],
        opened["role"] == "dialog",
        opened["modal"] == "true",
        sheets["combatSemantics"]["role"] == "dialog",
        sheets["combatSemantics"]["modal"] == "true",
        sheets["combatSemantics"]["canvasInert"],
        sheets["combatSemantics"]["commandInert"],
    )):
        failures.append("semántica modal/inert incompleta")
    if failures:
        raise RuntimeError("aceptación móvil base inválida: " + "; ".join(failures)
                           + f" evidence={evidence}")
    return evidence


def run_touch_command_hud(cdp, viewport: str) -> dict:
    """Exercise Task 3's authoritative real-touch and geometry contracts."""
    safe_area = apply_safe_area_override(cdp)
    initial_safe_failures = safe_area_failures(safe_area)
    if initial_safe_failures:
        raise RuntimeError("; ".join(initial_safe_failures))
    cdp.eval(js("""
      window.__touchCommandGate = { selectstartCount:0 };
      document.addEventListener('selectstart', () => {
        window.__touchCommandGate.selectstartCount += 1;
      });
      getSelection()?.removeAllRanges();
      return true;
    """))
    gesture_target = element_center(cdp, "#vl-weapon-toggle")
    gesture_before = cdp.eval(js("""
      return {
        scale:window.visualViewport ? visualViewport.scale : 1,
        selectstartCount:window.__touchCommandGate.selectstartCount,
        selectionText:getSelection()?.toString() || '',
      };
    """))
    synthesize_tap(
        cdp,
        gesture_target["x"],
        gesture_target["y"],
        tap_count=2,
        duration_ms=55,
    )
    cdp.pump(0.25)
    long_press = [touch_point(801, gesture_target["x"], gesture_target["y"])]
    dispatch_touches(cdp, "touchStart", long_press)
    cdp.pump(0.65)
    dispatch_touches(cdp, "touchEnd", [])
    cdp.pump(0.2)
    gesture_after = cdp.eval(js("""
      const button=document.querySelector('#vl-weapon-toggle');
      const picker=document.querySelector('#vl-weapon-picker');
      if (picker && !picker.hidden) button.click();
      return {
        scale:window.visualViewport ? visualViewport.scale : 1,
        selectstartCount:window.__touchCommandGate.selectstartCount,
        selectionText:getSelection()?.toString() || '',
        tapHighlight:getComputedStyle(button).webkitTapHighlightColor,
      };
    """))
    gesture = {
        "scaleBefore": gesture_before["scale"],
        "scaleAfter": gesture_after["scale"],
        "selectstartCount": gesture_after["selectstartCount"],
        "selectionText": gesture_after["selectionText"],
        "tapHighlight": gesture_after["tapHighlight"],
    }
    if not (
        gesture["scaleBefore"] == 1
        and gesture["scaleAfter"] == 1
        and gesture["selectstartCount"] == 0
        and gesture["selectionText"] == ""
        and gesture["tapHighlight"] in ("rgba(0, 0, 0, 0)", "transparent")
    ):
        raise RuntimeError(f"zoom/selección/highlight táctil inválido: {gesture}")

    geometry_errors = []
    closed_geometry = touch_command_geometry(cdp, "closed")
    geometry_errors.extend(geometry_failures(closed_geometry))
    screenshot(cdp, command_hud_screenshot_path(viewport, "closed"))

    synthesize_tap(cdp, gesture_target["x"], gesture_target["y"])
    wait_for(
        cdp,
        js("return !document.querySelector('#vl-weapon-picker').hidden"),
        timeout=4,
        label="picker abierto para captura",
    )
    picker_geometry = touch_command_geometry(cdp, "weapons")
    geometry_errors.extend(geometry_failures(picker_geometry))
    screenshot(cdp, command_hud_screenshot_path(viewport, "weapons"))
    option_m = element_center(cdp, '#vl-weapon-picker [data-w="m"]')
    touch_tap(cdp, 802, option_m)
    wait_weapon_ready(cdp)

    trigger = element_center(cdp, "#vl-trigger")
    single_before = cdp.eval(js("""
      return {
        ammo:window.__volar.weaponState.ammo.m,
        fired:window.__volar.weapons.fired,
        trigger:window.__volar.weaponState.trigger,
      };
    """))
    touch_tap(cdp, 810, trigger)
    single_after = cdp.eval(js("""
      return {
        ammo:window.__volar.weaponState.ammo.m,
        fired:window.__volar.weapons.fired,
        trigger:window.__volar.weaponState.trigger,
      };
    """))
    single_shot = {
        "before": single_before,
        "after": single_after,
        "exactlyOnce": (
            single_after["ammo"] == single_before["ammo"] - 1
            and single_after["fired"] == single_before["fired"] + 1
            and single_after["trigger"]["presses"] == single_before["trigger"]["presses"] + 1
            and single_after["trigger"]["accepted"] == single_before["trigger"]["accepted"] + 1
            and not single_after["trigger"]["held"]
        ),
    }
    if not single_shot["exactlyOnce"]:
        raise RuntimeError(f"touch simple no disparó exactamente una vez: {single_shot}")

    wait_weapon_ready(cdp)
    select_weapon_touch(cdp, "mg", 811)
    wait_weapon_ready(cdp)
    mg_before = cdp.eval(js("return { fired:window.__volar.weapons.fired, trigger:window.__volar.weaponState.trigger }"))
    mg_point = touch_point(812, trigger["x"], trigger["y"])
    dispatch_touches(cdp, "touchStart", [mg_point])
    cdp.pump(0.45)
    mg_held = cdp.eval(js("""
      return { fired:window.__volar.weapons.fired,
        trigger:window.__volar.weaponState.trigger };
    """))
    dispatch_touches(cdp, "touchEnd", [])
    cdp.pump(0.15)
    mg_released = cdp.eval(js("return { trigger:window.__volar.weaponState.trigger }"))
    mg_hold = {
        "before": mg_before,
        "held": mg_held,
        "released": mg_released,
        "repeated": (
            mg_held["fired"] >= mg_before["fired"] + 3
            and mg_held["trigger"]["held"]
            and mg_held["trigger"]["mode"] == "auto"
            and not mg_released["trigger"]["held"]
        ),
    }
    if not mg_hold["repeated"]:
        raise RuntimeError(f"MG touch hold no repitió: {mg_hold}")

    wait_weapon_ready(cdp)
    cancel_before = cdp.eval(js("return window.__volar.weaponState.trigger"))
    cancel_point = touch_point(813, trigger["x"], trigger["y"])
    dispatch_touches(cdp, "touchStart", [cancel_point])
    cdp.pump(0.1)
    dispatch_touches(cdp, "touchCancel", [])
    cdp.pump(0.12)
    cancel_after = cdp.eval(js("return window.__volar.weaponState.trigger"))
    cancellation = {
        "before": cancel_before,
        "after": cancel_after,
        "released": not cancel_after["held"],
    }
    if not cancellation["released"]:
        raise RuntimeError(f"touchCancel dejó Fire sostenido: {cancellation}")

    wait_weapon_ready(cdp)
    cdp.eval(js("""
      window.__touchOwnerLog = [];
      for (const type of [
        'pointerdown','gotpointercapture','pointerup',
        'pointercancel','lostpointercapture'
      ]) {
        document.addEventListener(type, event => {
          if (event.target?.closest?.('#vl-trigger')) {
            window.__touchOwnerLog.push({
              type, pointerId:event.pointerId, isPrimary:event.isPrimary,
              buttons:event.buttons,
            });
          }
        }, true);
      }
      return true;
    """))
    owner = touch_point(814, trigger["x"], trigger["y"])
    secondary = touch_point(815, trigger["x"] - 4, trigger["y"] - 4)
    dispatch_touches(cdp, "touchStart", [owner])
    cdp.pump(0.06)
    owner_state = cdp.eval(js("""
      return {
        trigger:window.__volar.weaponState.trigger,
        events:window.__touchOwnerLog.slice(),
      };
    """))
    dispatch_touches(cdp, "touchStart", [owner, secondary])
    cdp.pump(0.06)
    secondary_down = cdp.eval(js("""
      return {
        trigger:window.__volar.weaponState.trigger,
        events:window.__touchOwnerLog.slice(),
      };
    """))
    release_touches(cdp, [secondary])
    cdp.pump(0.12)
    secondary_released = cdp.eval(js("""
      return {
        trigger:window.__volar.weaponState.trigger,
        events:window.__touchOwnerLog.slice(),
      };
    """))
    release_touches(cdp, [owner])
    cdp.pump(0.12)
    owner_released = cdp.eval(js("""
      return {
        trigger:window.__volar.weaponState.trigger,
        events:window.__touchOwnerLog,
      };
    """))
    pointer_downs = [
        event for event in secondary_down["events"]
        if event["type"] == "pointerdown"
    ]
    owner_pointer_id = owner_state["trigger"].get("pointerId")
    secondary_pointer_id = (
        pointer_downs[1]["pointerId"] if len(pointer_downs) > 1 else None
    )
    secondary_events = secondary_released["events"]
    owner_up_before_release = any(
        event["type"] in ("pointerup", "pointercancel")
        and event["pointerId"] == owner_pointer_id
        for event in secondary_events
    )
    secondary_up = any(
        event["type"] == "pointerup"
        and event["pointerId"] == secondary_pointer_id
        for event in secondary_events
    )
    final_events = owner_released["events"]
    owner_up_index = next((
        index for index, event in enumerate(final_events)
        if event["type"] == "pointerup" and event["pointerId"] == owner_pointer_id
    ), -1)
    secondary_up_index = next((
        index for index, event in enumerate(final_events)
        if event["type"] == "pointerup" and event["pointerId"] == secondary_pointer_id
    ), -1)
    ownership = {
        "ownerPointerId": owner_pointer_id,
        "secondaryPointerId": secondary_pointer_id,
        "owner": owner_state,
        "secondaryDown": secondary_down,
        "secondaryReleased": secondary_released,
        "ownerReleased": owner_released,
        "events": final_events,
        "passed": (
            owner_pointer_id is not None
            and secondary_pointer_id is not None
            and secondary_pointer_id != owner_pointer_id
            and secondary_released["trigger"]["held"]
            and secondary_released["trigger"]["pointerId"] == owner_pointer_id
            and secondary_released["trigger"]["presses"]
                == owner_state["trigger"]["presses"]
            and secondary_released["trigger"]["accepted"]
                == owner_state["trigger"]["accepted"]
            and not owner_up_before_release
            and secondary_up
            and not owner_released["trigger"]["held"]
            and secondary_up_index >= 0
            and owner_up_index > secondary_up_index
        ),
    }
    secondary_release_protected = ownership["passed"]
    if not ownership["passed"]:
        raise RuntimeError(
            "segundo pointer liberó owner de Fire: "
            f"{ownership}"
        )

    wait_weapon_ready(cdp)
    rapid_before = cdp.eval(js("return { fired:window.__volar.weapons.fired, trigger:window.__volar.weaponState.trigger }"))
    for pointer_id in (816, 817):
        dispatch_touches(
            cdp,
            "touchStart",
            [touch_point(pointer_id, trigger["x"], trigger["y"])],
        )
        dispatch_touches(cdp, "touchEnd", [])
        cdp.pump(0.1)
    cdp.pump(0.3)
    rapid_after = cdp.eval(js("return { fired:window.__volar.weapons.fired, trigger:window.__volar.weaponState.trigger }"))
    rapid_double_tap = {
        "before": rapid_before,
        "after": rapid_after,
        "exactlyTwo": (
            rapid_after["fired"] == rapid_before["fired"] + 2
            and rapid_after["trigger"]["presses"] == rapid_before["trigger"]["presses"] + 2
            and rapid_after["trigger"]["accepted"] == rapid_before["trigger"]["accepted"] + 2
            and not rapid_after["trigger"]["held"]
        ),
    }
    if not rapid_double_tap["exactlyTwo"]:
        raise RuntimeError(f"double tap produjo pérdida/ghost shot: {rapid_double_tap}")

    missile_holds = {}
    touch_id = 820
    for weapon, hold_s, rearm_s in (
        ("s", 0.7, 0.45),
        ("m", 1.2, 0.95),
        ("l", 2.5, 2.25),
    ):
        wait_weapon_ready(cdp)
        select_weapon_touch(cdp, weapon, touch_id)
        touch_id += 1
        wait_weapon_ready(cdp)
        before = cdp.eval(js("return { fired:window.__volar.weapons.fired, trigger:window.__volar.weaponState.trigger }"))
        point = touch_point(touch_id, trigger["x"], trigger["y"])
        touch_id += 1
        dispatch_touches(cdp, "touchStart", [point])
        cdp.pump(hold_s)
        held = cdp.eval(js("return { fired:window.__volar.weapons.fired, trigger:window.__volar.weaponState.trigger }"))
        dispatch_touches(cdp, "touchEnd", [])
        cdp.pump(rearm_s)
        released = cdp.eval(js("return { trigger:window.__volar.weaponState.trigger }"))
        point = touch_point(touch_id, trigger["x"], trigger["y"])
        touch_id += 1
        dispatch_touches(cdp, "touchStart", [point])
        cdp.pump(0.1)
        dispatch_touches(cdp, "touchEnd", [])
        cdp.pump(0.12)
        after = cdp.eval(js("return { fired:window.__volar.weapons.fired, trigger:window.__volar.weaponState.trigger }"))
        missile_holds[weapon] = {
            "before": before,
            "held": held,
            "released": released,
            "after": after,
        }
        if not (
            held["fired"] == before["fired"] + 1
            and held["trigger"]["held"]
            and held["trigger"]["locked"]
            and not released["trigger"]["held"]
            and not released["trigger"]["locked"]
            and after["fired"] == before["fired"] + 2
            and not after["trigger"]["held"]
        ):
            raise RuntimeError(
                f"misil {weapon} no respetó hold/release/repress touch: "
                f"{missile_holds[weapon]}"
            )

    wait_weapon_ready(cdp)
    select_weapon_touch(cdp, "mg", touch_id)
    touch_id += 1
    wait_weapon_ready(cdp)
    zones = cdp.eval(js("""
      const center = selector => {
        const r=document.querySelector(selector).getBoundingClientRect();
        return { x:r.left+r.width/2, y:r.top+r.height/2 };
      };
      return {
        left:center('.vl-stick.left'),
        right:center('.vl-stick.right'),
        fire:center('#vl-trigger'),
      };
    """))
    left_origin = touch_point(901, zones["left"]["x"], zones["left"]["y"])
    left_move = touch_point(901, zones["left"]["x"], zones["left"]["y"] - 46)
    right_origin = touch_point(902, zones["right"]["x"], zones["right"]["y"])
    right_move = touch_point(902, zones["right"]["x"], zones["right"]["y"] - 46)
    fire_point = touch_point(903, zones["fire"]["x"], zones["fire"]["y"])
    dispatch_touches(cdp, "touchStart", [left_origin])
    dispatch_touches(cdp, "touchMove", [left_move])
    dispatch_touches(cdp, "touchStart", [left_move, right_origin])
    dispatch_touches(cdp, "touchMove", [left_move, right_move])
    cdp.pump(0.12)
    three_before = cdp.eval(js("return window.__volar.weapons.fired"))
    dispatch_touches(cdp, "touchStart", [left_move, right_move, fire_point])
    cdp.pump(0.16)
    three_held = cdp.eval(js("""
      const raw=window.__volar.controls.lastInput;
      const sample={...raw,active:['lift','yaw','fwd','strafe'].some(axis => raw[axis] !== 0)};
      return {
        fired:window.__volar.weapons.fired,
        sample,
        trigger:window.__volar.weaponState.trigger,
      };
    """))
    cdp.eval(js("""
      window.__threeTouchLog=[];
      for (const type of [
        'pointerdown','pointermove','pointerup','pointercancel',
        'touchstart','touchmove','touchend','touchcancel'
      ]) {
        document.addEventListener(type, event => {
          window.__threeTouchLog.push({
            type,
            pointerId:event.pointerId ?? null,
            target:event.target?.id || event.target?.className || event.target?.tagName,
            touches:event.touches
              ? [...event.touches].map(touch => touch.identifier) : null,
            changed:event.changedTouches
              ? [...event.changedTouches].map(touch => touch.identifier) : null,
          });
        }, true);
      }
      return true;
    """))
    # For touchEnd CDP expects the contacts being lifted, not the survivors.
    # Lift only Fire; the omitted stick IDs remain active in Chrome.
    release_touches(cdp, [fire_point])
    continued_left = touch_point(
        901, left_move["x"] + 2, left_move["y"] - 2
    )
    continued_right = touch_point(
        902, right_move["x"] - 2, right_move["y"] - 2
    )
    dispatch_touches(cdp, "touchMove", [continued_left, continued_right])
    cdp.pump(0.12)
    flight_after_fire = cdp.eval(js("""
      const raw=window.__volar.controls.lastInput;
      const sample={...raw,active:['lift','yaw','fwd','strafe'].some(axis => raw[axis] !== 0)};
      return {
        sample,
        trigger:window.__volar.weaponState.trigger,
        events:window.__threeTouchLog.slice(),
      };
    """))
    release_touches(cdp, [continued_left, continued_right])
    cdp.pump(0.15)
    all_released = cdp.eval(js("""
      const raw=window.__volar.controls.lastInput;
      const sample={...raw,active:['lift','yaw','fwd','strafe'].some(axis => raw[axis] !== 0)};
      return {
        sample,
        trigger:window.__volar.weaponState.trigger,
      };
    """))
    axes = ("lift", "yaw", "fwd", "strafe")
    three_pointer = {
        "ids": [901, 902, 903],
        "cdpRestartedRemaining": False,
        "beforeFired": three_before,
        "held": three_held,
        "flightAfterFireRelease": flight_after_fire,
        "allReleased": all_released,
        "originalStickIdsPreserved": any(
            event.get("type") == "touchend"
            and event.get("changed") == [903]
            and event.get("touches") == [901, 902]
            for event in flight_after_fire["events"]
        ) and any(
            event.get("type") == "touchmove"
            and event.get("touches") == [901, 902]
            for event in flight_after_fire["events"]
        ),
        "passed": (
            three_held["sample"]["active"]
            and abs(three_held["sample"]["lift"]) + abs(three_held["sample"]["fwd"]) > 0
            and three_held["fired"] > three_before
            and three_held["trigger"]["held"]
            and flight_after_fire["sample"]["active"]
            and not flight_after_fire["trigger"]["held"]
            and any(
                event.get("type") == "touchend"
                and event.get("changed") == [903]
                and event.get("touches") == [901, 902]
                for event in flight_after_fire["events"]
            )
            and any(
                event.get("type") == "touchmove"
                and event.get("touches") == [901, 902]
                for event in flight_after_fire["events"]
            )
            and not all_released["sample"]["active"]
            and all(all_released["sample"][axis] == 0 for axis in axes)
            and not all_released["trigger"]["held"]
        ),
    }
    if not three_pointer["passed"]:
        raise RuntimeError(f"vuelo + Fire de tres pointers inválido: {three_pointer}")

    menu = element_center(cdp, "#vl-fab")
    synthesize_tap(cdp, menu["x"], menu["y"])
    wait_for(
        cdp,
        js("""
          const menu=document.querySelector('#vl-dock');
          return menu.classList.contains('open') && menu.contains(document.activeElement);
        """),
        timeout=4,
        label="sheet Menú con foco",
    )
    wait_for(
        cdp,
        js("""
          const hidden = selector => {
            const el=document.querySelector(selector);
            if (!el || !el.getClientRects().length
                || el.closest('[hidden],[inert],[aria-hidden="true"]')) return true;
            for (let node=el; node && node.nodeType === 1; node=node.parentElement) {
              const style=getComputedStyle(node);
              if (style.display === 'none' || style.visibility === 'hidden'
                  || parseFloat(style.opacity || '1') <= 0.05) return true;
            }
            return false;
          };
          return ['#vl-trigger','#vl-weapon-toggle','#vl-fab',
            '.vl-stick.left','.vl-stick.right'].every(hidden);
        """),
        timeout=4,
        label="command HUD oculto bajo Menú",
    )
    menu_geometry = touch_command_geometry(cdp, "menu")
    geometry_errors.extend(geometry_failures(menu_geometry))
    screenshot(cdp, command_hud_screenshot_path(viewport, "menu"))
    close = element_center(cdp, "#vl-dock-close")
    touch_tap(cdp, touch_id, close)
    menu_closed = cdp.eval(js("""
      return {
        hidden:!document.querySelector('#vl-dock').classList.contains('open'),
        focusRestored:document.activeElement === document.querySelector('#vl-fab'),
      };
    """))
    if not all(menu_closed.values()):
        raise RuntimeError(f"Menú touch no cerró/restauró foco: {menu_closed}")

    for geometry in (closed_geometry, picker_geometry, menu_geometry):
        for violation in (geometry.get("safeArea") or {}).get("violations") or []:
            safe_area["violations"].append(
                f"{geometry.get('state')}:{violation}"
            )
    resolved_states = {
        tuple(sorted(((geometry.get("safeArea") or {}).get("resolved") or {}).items()))
        for geometry in (closed_geometry, picker_geometry, menu_geometry)
    }
    if len(resolved_states) != 1:
        safe_area["violations"].append("resolved-insets-cambiaron-entre-estados")
    final_safe_failures = safe_area_failures(safe_area)
    if final_safe_failures:
        raise RuntimeError("; ".join(final_safe_failures))
    base_acceptance = run_mobile_base_acceptance(cdp, viewport)

    touch_command_hud = {
        "realTouch": True,
        "singleShot": single_shot,
        "mgHold": mg_hold,
        "missileHolds": missile_holds,
        "rapidDoubleTap": rapid_double_tap,
        "cancellation": cancellation,
        "secondaryReleaseProtected": secondary_release_protected,
        "ownership": ownership,
        "threePointer": three_pointer,
        "gestureGuard": gesture,
        "safeAreaOverride": safe_area,
        "baseAcceptance": base_acceptance,
        "selection": {
            "weapon": "mg",
            "sticksAvailable": not closed_geometry.get("commandHidden"),
        },
        "closedGeometry": closed_geometry,
        "pickerGeometry": picker_geometry,
        "menuGeometry": menu_geometry,
        "geometryFailures": geometry_errors,
        "screenshots": {
            state: str(command_hud_screenshot_path(viewport, state))
            for state in ("closed", "weapons", "menu")
        },
    }
    if geometry_errors:
        raise RuntimeError(
            "geometría Task 2 bloquea aceptación Task 3: "
            + "; ".join(geometry_errors)
        )
    return touch_command_hud


def run_desktop_fire_gate(cdp) -> dict:
    """Keep the pre-existing desktop mouse combat contract alongside touch."""
    wait_weapon_ready(cdp)
    fire = element_center(cdp, "#vl-fire")
    before = cdp.eval(js("return window.__volar.weapons.fired"))
    cdp.send("Input.dispatchMouseEvent", {
        "type": "mousePressed",
        "x": fire["x"],
        "y": fire["y"],
        "button": "left",
        "buttons": 1,
        "clickCount": 1,
    })
    cdp.pump(0.06)
    cdp.send("Input.dispatchMouseEvent", {
        "type": "mouseReleased",
        "x": fire["x"],
        "y": fire["y"],
        "button": "left",
        "buttons": 0,
        "clickCount": 1,
    })
    cdp.pump(0.15)
    after = cdp.eval(js("""
      return {
        fired:window.__volar.weapons.fired,
        held:window.__volar.weaponState.trigger.held,
      };
    """))
    if after["fired"] != before + 1 or after["held"]:
        raise RuntimeError(f"mouse Fire desktop inválido: {before} -> {after}")
    return {"mode": "mouse", "singleShot": True, "before": before, "after": after}


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
        touch_command_hud = run_touch_command_hud(cdp, viewport)
        hud["touchCommandHud"] = touch_command_hud
        hud["touchLayout"] = touch_command_hud
        screenshot(cdp, QA_DIR / f"matrix-volar-{viewport}.png")
        return {"surface": "volar", "viewport": viewport, "fps": rep.get("fps"),
                "visual": visual, **hud}

    hud["touchCommandHud"] = run_desktop_fire_gate(cdp)
    screenshot(cdp, QA_DIR / f"matrix-volar-{viewport}.png")
    return {"surface": "volar", "viewport": viewport, "fps": rep.get("fps"),
            "visual": visual, **hud}


def format_flightverse_result(result: dict) -> str:
    detail = (
        f"{result['fps']}fps"
        if result.get("fps")
        else f"{result['islas']} islas"
    )
    touch = result.get("touchCommandHud") or {}
    suffix = " · touch=real" if touch.get("realTouch") else ""
    return f"{result['surface']}/{result['viewport']}: ok · {detail}{suffix}"


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
            print(format_flightverse_result(r))
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
