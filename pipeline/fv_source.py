"""Fuente completa del runtime /volar tras el refactor A0 (volar.js + módulos por workstream).

Los contratos estáticos que antes hacían grep en web/volar.js leen ahora este conjunto: el
contrato sigue siendo el mismo, solo cambió en qué archivo vive cada pieza.
"""
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
FV = WEB / "flightverse"
MODULE_DIRS = ("ui", "fx", "input", "modes", "tour")
# HUD v2 (?fv=2, WS A): camino paralelo con su propio contrato (test_fv2_hud_contract.py). Los contratos
# del HUD LEGADO (un solo coordinador de overlays, un solo keydown global…) no cuentan estos archivos.
V2_UI_FILES = frozenset({"hud2.js", "weapons2.js", "menu2.js", "screens2.js", "onboarding.js", "v2.js",
                         "reticle.js", "prefs.js", "records.js", "icons2.js"})


def module_path(rel: str) -> Path:
    return FV / rel


def module_source(rel: str) -> str:
    return module_path(rel).read_text()


def volar_source() -> str:
    parts = [(WEB / "volar.js").read_text()]
    parts.append((FV / "bus.js").read_text())
    for d in MODULE_DIRS:
        for p in sorted((FV / d).glob("*.js")):
            if d == "ui" and p.name in V2_UI_FILES:
                continue
            parts.append(p.read_text())
    return "\n".join(parts)
