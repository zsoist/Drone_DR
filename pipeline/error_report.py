"""Reporte AI de errores de AeroBrain — DeepSeek SOLO ESCRIBE, nunca actúa.

Junta errores de los últimos N días (ops/errors.jsonl + jobs.db status=error +
logs del watchdog), los DEDUPLICA por firma (mismos errores con ids/números
distintos cuentan como uno), y pide a DeepSeek (v4-flash vía deepseek-chat,
~$0.001/reporte) un análisis: clusters, causa raíz sospechada, severidad y
próximos pasos SUGERIDOS.

El resultado va a vault/ops/reports/error-report-*.md con encabezado explícito:
es material de triage para que Codex/Claude revisen y VALIDEN — jamás se aplica
automáticamente. Sin API key o sin red, el reporte sale igual con el digest
crudo (sección AI marcada como no disponible).

Uso: python3 error_report.py [--days 7] [--dry]   (--dry: no llama a DeepSeek)
"""
import json
import re
import sqlite3
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
ERRLOG = VAULT / "ops" / "errors.jsonl"
WATCHLOG = Path("/tmp/aerobrain-watchdog.log")
JOBS_DB = VAULT / "manifest" / "jobs.db"
REPORTS = VAULT / "ops" / "reports"
KEYS_ENV = Path("/Volumes/SSD/_system/claude/.api-keys.env")


def signature(msg: str) -> str:
    """Firma estable: colapsa ids/números/paths para agrupar el mismo error."""
    s = re.sub(r"DJI_\w+", "<clip>", msg)
    s = re.sub(r"/[\w./-]{8,}", "<path>", s)
    s = re.sub(r"\b\d+(\.\d+)?\b", "<n>", s)
    return s.strip()[:160]


def collect(days: int) -> list[dict]:
    cutoff = time.time() - days * 86400
    items = []
    # 1) registro central
    if ERRLOG.exists():
        for line in ERRLOG.read_text().splitlines():
            try:
                r = json.loads(line)
                ts = time.mktime(time.strptime(r["ts"][:19], "%Y-%m-%dT%H:%M:%S"))
                if ts >= cutoff:
                    items.append({"ts": ts, "source": r.get("source", "?"),
                                  "msg": r.get("msg", ""), "ctx": r.get("ctx")})
            except (ValueError, KeyError):
                continue
    # 2) jobs en error
    try:
        c = sqlite3.connect(JOBS_DB, timeout=3)
        c.row_factory = sqlite3.Row
        for r in c.execute("SELECT kind,label,detail,finished FROM jobs "
                           "WHERE status='error' AND finished >= ?", (cutoff,)):
            items.append({"ts": r["finished"], "source": f"job:{r['kind']}",
                          "msg": r["detail"] or "error sin detalle",
                          "ctx": {"clip": r["label"]}})
        c.close()
    except sqlite3.Error:
        pass
    # 3) watchdog (probes fallidos / kickstarts)
    if WATCHLOG.exists():
        for line in WATCHLOG.read_text().splitlines()[-4000:]:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("event") == "kickstart" or r.get("ok") is False:
                ts = r.get("ts") or 0
                if isinstance(ts, str):
                    try:
                        ts = time.mktime(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
                    except ValueError:
                        ts = 0
                if ts >= cutoff:
                    items.append({"ts": ts, "source": "watchdog",
                                  "msg": f"{r.get('event')} {r.get('label', '')} {r.get('why') or r.get('detail', '')}"[:300]})
    return items


def digest(items: list[dict]) -> list[dict]:
    groups = defaultdict(list)
    for it in items:
        groups[(it["source"], signature(it["msg"]))].append(it)
    out = []
    for (source, sig), grp in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        grp.sort(key=lambda x: x["ts"])
        out.append({"source": source, "signature": sig, "count": len(grp),
                    "first": time.strftime("%m-%d %H:%M", time.localtime(grp[0]["ts"])),
                    "last": time.strftime("%m-%d %H:%M", time.localtime(grp[-1]["ts"])),
                    "sample": grp[-1]["msg"][:220]})
    return out


def deepseek(prompt: str) -> str:
    key = ""
    for line in KEYS_ENV.read_text().splitlines():
        if line.startswith("DEEPSEEK_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"')
    if not key:
        raise RuntimeError("DEEPSEEK_API_KEY no encontrada")
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        data=json.dumps({"model": "deepseek-chat", "temperature": 0.3,
                         "messages": [{"role": "user", "content": prompt}]}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]


def main():
    days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 7
    dry = "--dry" in sys.argv
    items = collect(days)
    d = digest(items)
    REPORTS.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M")
    out = REPORTS / f"error-report-{ts}.md"

    lines = [f"# AeroBrain — reporte de errores · {time.strftime('%Y-%m-%d %H:%M')}",
             "",
             "> ⚠️ GENERADO POR DEEPSEEK (triage automático). NO aplicar nada de aquí",
             "> sin validación de Codex o Claude. Es material de lectura, no de acción.",
             "",
             f"Ventana: últimos {days} días · {len(items)} eventos · {len(d)} firmas únicas",
             "",
             "## Digest (deduplicado)",
             ""]
    for g in d[:40]:
        lines.append(f"- **×{g['count']}** `[{g['source']}]` {g['signature']}")
        lines.append(f"  - primero {g['first']} · último {g['last']} · ej: {g['sample']}")
    if not d:
        lines.append("Sin errores en la ventana. 🎉")

    ai = None
    if d and not dry:
        prompt = ("Eres el analista de confiabilidad de AeroBrain, una plataforma de mapeo con "
                  "drones en un Mac Mini M4 (pipeline ODM + gaussian splatting + web). Analiza "
                  "este digest de errores deduplicados (fuente, firma, conteo, período, ejemplo). "
                  "Devuelve en español y en markdown: 1) clusters por causa raíz sospechada, "
                  "2) severidad de cada cluster (crítico/molesto/ruido), 3) qué investigar primero "
                  "y qué evidencia falta, 4) si algo parece regresión reciente. Sé concreto y "
                  "escéptico; si el dato no alcanza para concluir, dilo. NO propongas código.\n\n"
                  + json.dumps(d[:40], ensure_ascii=False, indent=1))
        try:
            ai = deepseek(prompt[:14000])
        except Exception as e:
            ai = f"_(análisis AI no disponible: {e})_"
    if ai:
        lines += ["", "## Análisis DeepSeek", "", ai]
    lines += ["", "---", "Estado: PENDIENTE DE REVISIÓN (Codex/Claude) · "
              f"fuente: error_report.py --days {days}"]
    out.write_text("\n".join(lines))
    (REPORTS / "latest.json").write_text(json.dumps(
        {"file": out.name, "ts": ts, "events": len(items), "signatures": len(d),
         "ai": bool(ai and not ai.startswith("_("))}))
    print(f"reporte: {out} · {len(items)} eventos · {len(d)} firmas · AI={'sí' if ai else 'no'}")


if __name__ == "__main__":
    main()
