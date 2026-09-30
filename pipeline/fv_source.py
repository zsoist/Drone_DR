"""Fuente completa del runtime /volar tras el refactor A0 (volar.js + módulos por workstream).

Los contratos estáticos que antes hacían grep en web/volar.js leen ahora este conjunto: el
contrato sigue siendo el mismo, solo cambió en qué archivo vive cada pieza.
"""
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
FV = WEB / "flightverse"
MODULE_DIRS = ("ui", "fx", "input", "modes", "tour")


def module_path(rel: str) -> Path:
    return FV / rel


def module_source(rel: str) -> str:
    return module_path(rel).read_text()


def volar_source() -> str:
    parts = [(WEB / "volar.js").read_text()]
    parts.append((FV / "bus.js").read_text())
    for d in MODULE_DIRS:
        for p in sorted((FV / d).glob("*.js")):
            parts.append(p.read_text())
    return "\n".join(parts)
