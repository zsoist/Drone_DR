"""Splat history retention and training quality gate.

Extracted from aerobrain_server so the worker can use them without importing the HTTP
server module. aerobrain_server re-exports all three names.
"""
from __future__ import annotations

import re
from pathlib import Path


def clip_history_files(hist_dir: Path, cid: str) -> list:
    """Archivos de historial que pertenecen EXACTAMENTE a este clip.
    Formato de archivado: '{cid}-{YYYYMMDD}-{HHMMSS}.{clean.sog|splat|ksplat|ply}'.
    cruzaría el guion y capturaría el historial de un clip VECINO '{cid}-<suf>' (p.ej. el clip
    'A' se comería el de 'A-2') — pérdida de datos entre clips. El regex ancla los 8+6 dígitos
    del timestamp, así 'A-2-...' nunca cae en el conjunto de 'A'."""
    if not hist_dir.is_dir():
        return []
    pat = re.compile(rf"{re.escape(cid)}-\d{{8}}-\d{{6}}\.(clean\.sog|spz|raw\.splat|splat|ksplat|ply|meta\.json|cameras\.json)$", re.IGNORECASE)
    return [p for p in hist_dir.iterdir() if p.is_file() and pat.fullmatch(p.name)]


def prune_splat_history(hist_dir: Path, cid: str, keep: int = 6):
    """Keep the latest N version groups, not merely N files.

    A version can have .splat + .ksplat + .meta.json + .cameras.json. Pruning by file count
    breaks old versions into unusable partial sets.
    """
    groups = {}
    pat = re.compile(rf"({re.escape(cid)}-\d{{8}}-\d{{6}})\.(clean\.sog|spz|raw\.splat|splat|ksplat|ply|meta\.json|cameras\.json)$",
                     re.IGNORECASE)
    for p in clip_history_files(hist_dir, cid):
        m = pat.fullmatch(p.name)
        if m:
            groups.setdefault(m.group(1), []).append(p)
    stale = sorted(groups.items(), key=lambda kv: max(p.stat().st_mtime for p in kv[1]), reverse=True)[keep:]
    for _, files in stale:
        for p in files:
            p.unlink(missing_ok=True)


def splat_quality(out: Path, log: str, n_cams: int, iters: int) -> dict:
    """Quality gate del splat: tamaño + cámaras + convergencia de loss."""
    size = out.stat().st_size if out.exists() else 0
    step_rows = re.findall(
        r"Step\s+(\d+):\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|nan|inf)",
        log or "", flags=re.I)
    losses = [v.lower() for _, v in step_rows]
    final_loss = next((float(x) for x in reversed(losses) if x not in ("nan", "inf")), None)
    last_step = max((int(s) for s, _ in step_rows), default=0)
    reasons = []
    if losses and losses[-1] in ("nan", "inf"):
        reasons.append("el entrenamiento divergió (loss=nan) — reintenta o baja las iteraciones")
    if iters and last_step and last_step < int(iters * 0.95):
        reasons.append(f"entrenamiento incompleto ({last_step}/{iters} pasos)")
    if size < 200_000:
        reasons.append(f"archivo muy pequeño ({size} bytes) — escena insuficiente")
    if n_cams < 8:
        reasons.append(f"solo {n_cams} cámaras — vuela una órbita con más solape (>=8)")
    if final_loss is not None and final_loss > 0.5:
        reasons.append(f"loss final alto ({final_loss}) — captura ruidosa")
    return {"passed": not reasons, "reason": " · ".join(reasons) or "ok",
            "bytes": size, "cameras": n_cams, "final_loss": final_loss,
            "last_step": last_step, "steps_logged": len(step_rows), "target_iters": iters}
