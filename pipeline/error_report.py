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
EXPECTED_BASELINES = (
    "ODM alta medido~12-25min para 30-77 cámaras (datasets grandes pueden tardar más); "
    "ODM Alta de 238 cámaras medido en 98min con dense high→medium y producto 25D; "
    "splat Metal/MPS medium~2-3min; Cinematic medido 59min/30 cámaras y puede agotar memoria; "
    "Ultra medido~2h/127 cámaras y también puede agotar memoria según la escena"
)
AI_ANALYSIS_RULES = (
    "Calcula la confiabilidad operativa EXCLUSIVAMENTE con latest_by_workload. "
    "Está PROHIBIDO presentar la proporción de attempts como tasa de fallo de producción: "
    "attempts incluye reintentos de tuning sobre el mismo clip. Si mencionas esa proporción, "
    "llámala tasa de intentos de tuning y sepárala de workloads. Un workload pesado se identifica "
    "por kind+escena+preset solicitado: Medium terminado NO resuelve un Ultra estricto fallido. "
    "Con muestras pequeñas, da el conteo absoluto y evita conclusiones sistémicas. Medium es la "
    "línea base medida y de menor memoria: jamás recomiendes Cinematic o Ultra como mitigación de "
    "OOM. No compares duraciones ODM sin igualar preset, número de cámaras y producto final; una "
    "corrida de 238 cámaras con fallback 25D no es comparable con la línea base de 30-77 cámaras. "
    "Los conteos del digest se solapan (job, evento OOM e hipótesis pueden describir el mismo intento): "
    "PROHIBIDO sumarlos como fallos independientes. Mantén el error histórico separado de cualquier "
    "resolution_note y no presentes un error resuelto como incidente activo. Un browser gate es una "
    "validación posterior a publicación, no evidencia por sí sola de fallo de descarga. Copia siempre "
    "el label completo: dos vuelos distintos pueden compartir el sufijo 0101_D y no deben fusionarse. "
    "Cada latest_workload trae una referencia Wxx: usa esa referencia exacta y el label completo; "
    "PROHIBIDO inventar claves abreviadas como splat|0101_D o decir 'mismo clip' si las Wxx difieren. "
    "No infieras un umbral por número de cámaras si hay éxitos con más cámaras: esos OOM son "
    "dependientes de contenido/condición, no prueba de que ≥N cámaras sea imposible. Nunca infieras "
    "preset o cámaras desde el label; si facts lo marca unknown, di unknown. Un job done con "
    "fallback cuenta como completado operativo, pero NO demuestra que el preset solicitado terminó: "
    "di siempre solicitado→efectivo (por ejemplo Ultra→Medium), no 'Ultra exitoso'. Si ese job "
    "terminó done, los OOM intermedios son una RECUPERACIÓN EXITOSA con degradación de calidad: "
    "PROHIBIDO llamarlo fallo terminal, incidente activo, scheduler fallido o regresión. Solo hay "
    "regresión operativa si el resultado terminal comparable empeora, no porque el fallback se active."
)
CURRENT_POLICY_FACTS = (
    "Corte de software 2026-07-13: (1) el orden de inicialización splatChk ya está corregido; "
    "(2) threading del browser gate y, por separado, el import top-level urllib del servidor ya "
    "están corregidos; (3) el nuevo "
    "scheduler splat inicia Ultra grande en -d2 y, con best_available, baja Ultra→Cinematic→Medium "
    "solo después de OOM; (4) no ha habido aún suficientes workloads posteriores para validar la "
    "nueva política. Los eventos anteriores al corte son evidencia histórica, no incidentes activos, "
    "salvo que exista recurrencia posterior explícita."
)


def synthetic_job(label: str | None) -> bool:
    """Return true for deliberate smoke/diagnostic jobs, not user workloads."""
    value = (label or "").strip()
    return value == "timeout-test" or value.startswith("TEST_")


def signature(msg: str) -> str:
    """Firma estable: colapsa ids/números/paths para agrupar el mismo error."""
    s = re.sub(r"DJI_\w+", "<clip>", msg)
    s = re.sub(r"/[\w./-]{8,}", "<path>", s)
    s = re.sub(r"\b\d+(\.\d+)?\b", "<n>", s)
    return s.strip().rstrip(" .,:;!?")[:160]


def split_resolution(detail: str | None) -> tuple[str, str]:
    """Keep the immutable historical failure separate from a later correction note."""
    value = str(detail or "").strip()
    match = re.search(r"\s*[·—-]?\s*CORRECCI[ÓO]N\s+", value, flags=re.IGNORECASE)
    if not match:
        return value, ""
    original = value[:match.start()].strip().rstrip(" ·—-")
    resolution = value[match.end():].strip()
    return original, resolution


def _json_dict(value) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def requested_preset(spec: dict) -> str | None:
    explicit = spec.get("preset")
    if explicit:
        return str(explicit)
    try:
        return {1000: "fast", 2000: "medium", 7000: "cinematic", 15000: "ultra"}.get(
            int(spec.get("iters")))
    except (TypeError, ValueError):
        return None


def workload_identity(row: dict, spec: dict | None = None) -> tuple:
    """A requested quality is a deliverable, not a tuning attempt of another quality."""
    spec = spec or _json_dict(row.get("spec"))
    base = (str(row.get("kind") or ""), str(row.get("label") or ""))
    if row.get("kind") in ("3d", "splat"):
        return (*base, str(requested_preset(spec) or "unknown"))
    return base


def label_suffix(label: str) -> str:
    match = re.search(r"(_\d{4}_D)$", str(label or ""))
    return match.group(1) if match else str(label or "")


def _model_facts(row: dict, spec: dict, trust_legacy_meta: bool = False) -> dict:
    """Bounded factual provenance for DeepSeek; absence remains explicit, never inferred."""
    facts = {
        "requested_preset": requested_preset(spec),
        "source_count": len(spec.get("sources") or ([spec.get("clip_id")] if spec.get("clip_id") else [])),
        "photo_count": len(spec.get("photos") or []),
    }
    model = VAULT / "models" / str(row.get("label") or "") / "meta.json"
    try:
        if not model.is_file() or model.stat().st_size > 8_000_000:
            return facts
        meta = _json_dict(model.read_text())
    except OSError:
        return facts
    recon = meta.get("reconstruction") or {}
    if row.get("kind") == "3d":
        meta_job_id = recon.get("job_id") or meta.get("job_id")
        if not (meta_job_id == row.get("id") or (not meta_job_id and trust_legacy_meta)):
            return facts
        qa = meta.get("qa") or {}
        facts.update({
            "requested_preset": recon.get("requested_preset") or spec.get("preset"),
            "effective_preset": recon.get("effective_preset") or meta.get("preset"),
            "dense_quality_requested": meta.get("dense_quality_requested"),
            "dense_quality_effective": meta.get("dense_quality"),
            "product_mode": meta.get("pipeline_mode") or qa.get("status"),
            "cameras_registered": qa.get("cameras_reconstructed"),
            "cameras_total": qa.get("cameras_total"),
            "fallback": bool(meta.get("dense_fallback") or
                             (meta.get("pipeline_mode") == "ortho_25d_fallback")),
        })
    elif row.get("kind") == "splat":
        runs = recon.get("splat_runs") or []
        run = next((x for x in reversed(runs) if x.get("job_id") == row.get("id")), {})
        if run:
            facts.update({key: run.get(key) for key in
                          ("requested_preset", "effective_preset", "input_scale", "fallback",
                           "attempts", "target_iters", "duration_s", "peak_mib", "backend")})
    return {key: value for key, value in facts.items() if value is not None}


def collect(days: int) -> list[dict]:
    cutoff = time.time() - days * 86400
    items = []
    logged_job_ids = set()
    # 1) registro central
    if ERRLOG.exists():
        for line in ERRLOG.read_text().splitlines():
            try:
                r = json.loads(line)
                ts = time.mktime(time.strptime(r["ts"][:19], "%Y-%m-%dT%H:%M:%S"))
                if ts >= cutoff:
                    ctx = r.get("ctx") or {}
                    if synthetic_job(ctx.get("label")):
                        continue
                    if ctx.get("job"):
                        logged_job_ids.add(ctx["job"])
                    items.append({"ts": ts, "source": r.get("source", "?"),
                                  "msg": r.get("msg", ""), "ctx": r.get("ctx")})
            except (ValueError, KeyError):
                continue
    # 2) jobs en error
    try:
        c = sqlite3.connect(JOBS_DB, timeout=3)
        c.row_factory = sqlite3.Row
        for r in c.execute("SELECT id,kind,label,detail,finished FROM jobs "
                           "WHERE status='error' AND finished >= ?", (cutoff,)):
            if r["id"] in logged_job_ids or synthetic_job(r["label"]):
                continue
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


def jobs_summary(days: int) -> dict:
    """Salud de la operación (no solo errores): conteos, duraciones y tasa de éxito por kind.
    Le da a DeepSeek contexto para juzgar EFICIENCIA (¿los ultra tardan lo esperado?)."""
    cutoff = time.time() - days * 86400
    out = {"by_kind": {}, "latest_by_workload": {}, "latest_workloads": [],
           "recent_done": [], "resolved_historical_errors": []}
    try:
        c = sqlite3.connect(JOBS_DB, timeout=3)
        c.row_factory = sqlite3.Row
        for r in c.execute("SELECT kind, status, COUNT(*) n, AVG(finished-started) avg_s "
                           "FROM jobs WHERE finished >= ? "
                           "AND label != 'timeout-test' AND label NOT LIKE 'TEST\\_%' ESCAPE '\\' "
                           "GROUP BY kind, status", (cutoff,)):
            k = out["by_kind"].setdefault(r["kind"], {})
            k[r["status"]] = {"n": r["n"], "avg_min": round((r["avg_s"] or 0) / 60)}
        resolution_events = {}
        latest_done_3d = {}
        for done in c.execute("SELECT id,label FROM jobs WHERE kind='3d' AND status='done' "
                              "ORDER BY finished DESC"):
            latest_done_3d.setdefault(done["label"], done["id"])
        try:
            for event in c.execute("SELECT job_id, event, message FROM job_events "
                                   "WHERE event IN ('resolved','resolution','correction') "
                                   "ORDER BY ts"):
                resolution_events[event["job_id"]] = event["message"] or event["event"]
        except sqlite3.Error:
            pass
        seen = set()
        for r in c.execute("SELECT id,kind,label,status,detail,started,finished,spec,artifact FROM jobs "
                           "WHERE finished >= ? AND status IN ('done','error','cancelled') "
                           "ORDER BY finished DESC", (cutoff,)):
            row = dict(r)
            spec = _json_dict(row.get("spec"))
            key = workload_identity(row, spec)
            if key in seen or synthetic_job(row.get("label")):
                continue
            seen.add(key)
            historical, legacy_resolution = split_resolution(row.get("detail"))
            resolution = resolution_events.get(row["id"]) or legacy_resolution
            operational_status = ("resolved" if row["status"] == "error" and resolution
                                  else row["status"])
            bucket = out["latest_by_workload"].setdefault(row["kind"], {})
            bucket[operational_status] = bucket.get(operational_status, 0) + 1
            workload = {
                "job_id": row["id"], "kind": row["kind"], "label": row["label"],
                "workload_key": "|".join(key),
                "status": row["status"],
                "dur_min": round(((row.get("finished") or 0) - (row.get("started") or 0)) / 60, 1),
                "historical_detail": historical[:240],
                "resolved": bool(resolution),
                "resolution_note": resolution[:300] if resolution else "",
                "facts": _model_facts(
                    row, spec,
                    trust_legacy_meta=(row["status"] == "done" and
                                       latest_done_3d.get(row["label"]) == row["id"])),
            }
            out["latest_workloads"].append(workload)
            if row["status"] == "error" and resolution:
                out["resolved_historical_errors"].append(workload)
        for r in c.execute("SELECT kind, label, detail, finished-started dur FROM jobs "
                           "WHERE status='done' AND kind IN ('3d','splat') AND finished >= ? "
                           "AND label != 'timeout-test' AND label NOT LIKE 'TEST\\_%' ESCAPE '\\' "
                           "ORDER BY finished DESC LIMIT 8", (cutoff,)):
            out["recent_done"].append({"kind": r["kind"], "clip": r["label"],
                                       "dur_min": round(r["dur"] / 60),
                                       "detail": (r["detail"] or "")[:80]})
        c.close()
    except sqlite3.Error:
        pass
    for index, workload in enumerate(out["latest_workloads"], 1):
        workload["workload_ref"] = f"W{index:02d}"
    suffixes = defaultdict(set)
    for workload in out["latest_workloads"]:
        suffixes[label_suffix(workload["label"])].add(workload["label"])
    out["label_suffix_collisions"] = {
        suffix: sorted(labels) for suffix, labels in suffixes.items() if len(labels) > 1
    }
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


def collision_context(summary: dict) -> str:
    warnings = []
    for suffix, labels in summary.get("label_suffix_collisions", {}).items():
        parts = []
        for label in labels:
            refs = [row["workload_ref"] for row in summary.get("latest_workloads", [])
                    if row["label"] == label]
            parts.append(f"{label}={','.join(refs) or 'sin refs'}")
        warnings.append(f"COLISIÓN {suffix}: " + " ; ".join(parts))
    return " | ".join(warnings) or "sin colisiones de label"


def recovered_fallback_context(summary: dict) -> str:
    rows = []
    for workload in summary.get("latest_workloads", []):
        facts = workload.get("facts") or {}
        if workload.get("status") == "done" and facts.get("fallback"):
            attempts = ",".join(f"{a.get('preset')} rc={a.get('rc')}" for a in facts.get("attempts") or [])
            rows.append(
                f"{workload.get('workload_ref')} TERMINAL=done; "
                f"{facts.get('requested_preset')}→{facts.get('effective_preset')}; "
                f"RECUPERACIÓN EXITOSA; intentos=[{attempts}]"
            )
    return " | ".join(rows) or "sin fallbacks recuperados"


def validate_ai_analysis(ai: str, summary: dict) -> list[str]:
    """Reject known high-impact contradictions before presenting AI prose as usable triage."""
    text = str(ai or "")
    warnings = []
    collision_labels = {
        label for labels in summary.get("label_suffix_collisions", {}).values() for label in labels
    }
    collision_scan = text
    # A truthful phrase such as "same full label DJI_<date>_0101_D" is not a collision.
    # Mask full identities before looking for a bare ambiguous suffix.
    for label in sorted(collision_labels, key=len, reverse=True):
        collision_scan = collision_scan.replace(label, "<FULL_LABEL>")
    for suffix in summary.get("label_suffix_collisions", {}):
        escaped = re.escape(suffix)
        conflation = (
            rf"mism[oa]s?\s+(?:clip|label|vuelo)[^.\n]{{0,100}}{escaped}",
            rf"{escaped}[^.\n]{{0,100}}mism[oa]s?\s+(?:clip|label|vuelo)",
        )
        if any(re.search(pattern, collision_scan, flags=re.IGNORECASE) for pattern in conflation):
            warnings.append(f"colisión de identidad {suffix}: el análisis fusionó vuelos distintos")
    ref_to_label = {
        str(row.get("workload_ref") or ""): str(row.get("label") or "")
        for row in summary.get("latest_workloads", []) if row.get("workload_ref") and row.get("label")
    }
    known_labels = set(ref_to_label.values())
    for line in text.splitlines():
        refs = set(re.findall(r"\bW\d{2}\b", line)) & set(ref_to_label)
        labels = {label for label in known_labels if label in line}
        if len(refs) > 1 and re.search(r"mism[oa]s?\s+(?:clip|label|vuelo)", line, re.IGNORECASE):
            if len({ref_to_label[ref] for ref in refs}) > 1:
                warnings.append(
                    "referencias de vuelos distintos fueron descritas como el mismo clip/label")
        if refs and labels:
            for ref in refs:
                expected = ref_to_label[ref]
                if expected in labels:
                    continue
                warnings.append(
                    f"{ref} tiene label incorrecto: esperado {expected}; hallado {', '.join(sorted(labels))}")
    for workload in summary.get("latest_workloads", []):
        facts = workload.get("facts") or {}
        if workload.get("status") != "done" or not facts.get("fallback"):
            continue
        ref = re.escape(str(workload.get("workload_ref") or ""))
        if not ref:
            continue
        relevant_lines = "\n".join(line for line in text.splitlines() if re.search(rf"\b{ref}\b", line))
        # Explicitly truthful negations ("no es regresión", "no fue fallo terminal")
        # must never be interpreted as affirmative incident claims.
        relevant_lines = re.sub(
            r"\b(?:no|tampoco)\s+(?:es|son|fue|fueron|representa|representan|"
            r"constituye|constituyen)\b[^\n]{0,45}"
            r"(?:incidente activo|fallo terminal|scheduler fallido|recurrencia activa|regresi[oó]n)",
            "<NEGATED_TRUTH>", relevant_lines, flags=re.IGNORECASE)
        bad = re.search(
            rf"{ref}[^.,;:\n]{{0,80}}\b(?:es|son|fue|fueron|representa|representan|"
            rf"constituye|constituyen)\b[^.,;:\n]{{0,20}}"
            rf"(?:incidente activo|fallo terminal|scheduler fallido|recurrencia activa|regresi[oó]n)",
            relevant_lines, flags=re.IGNORECASE)
        if bad:
            warnings.append(f"workload recuperado {workload.get('workload_ref')} fue descrito como fallo/regresión")
    return warnings


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
             f"Contexto del build actual: {CURRENT_POLICY_FACTS}",
             "",
             "## Digest (deduplicado)",
             ""]
    for g in d[:40]:
        lines.append(f"- **×{g['count']}** `[{g['source']}]` {g['signature']}")
        lines.append(f"  - primero {g['first']} · último {g['last']} · ej: {g['sample']}")
    if not d:
        lines.append("Sin errores en la ventana. 🎉")

    ai = None
    ai_validation = []
    jsum = jobs_summary(days)
    if (d or jsum["by_kind"]) and not dry:
        collisions = collision_context(jsum)
        recovered = recovered_fallback_context(jsum)
        prompt = ("Eres el analista de confiabilidad de AeroBrain, una plataforma de mapeo con "
                  "drones en un Mac Mini M4 (pipeline ODM + gaussian splatting + web). Tienes: "
                  "(A) digest de errores deduplicados y (B) resumen de salud de jobs (conteos, "
                  f"duración media, últimos completados — referencias actuales: {EXPECTED_BASELINES}). "
                  "by_kind cuenta INTENTOS (incluidos reintentos de tuning); latest_by_workload "
                  f"cuenta el resultado terminal más reciente por kind+label+preset solicitado. {AI_ANALYSIS_RULES} "
                  f"Hechos del build actual que no puedes contradecir: {CURRENT_POLICY_FACTS} "
                  f"ADVERTENCIA CONCRETA DE IDENTIDAD (debe aparecer correcta en tu análisis): {collisions}. "
                  f"RESULTADOS RECUPERADOS QUE NO SON INCIDENTES NI REGRESIONES: {recovered}. "
                  "W05 browser gate fue exclusivamente el threading import; urllib fue otro error server-500 "
                  "separado. "
                  "Devuelve en español, markdown: 1) clusters de errores por causa raíz, "
                  "2) severidad (crítico/molesto/ruido), 3) EFICIENCIA: ¿alguna duración anómala "
                  "vs lo esperado? ¿tasa de error por kind preocupante?, 4) qué investigar primero, "
                  "5) si algo parece regresión reciente. Sé concreto y escéptico; si el dato no "
                  "alcanza, dilo. NO propongas código.\n\n(A) ERRORES:\n"
                  + json.dumps(d[:40], ensure_ascii=False, indent=1)
                  + "\n\n(B) SALUD DE JOBS:\n" + json.dumps(jsum, ensure_ascii=False, indent=1))
        try:
            ai = deepseek(prompt[:40000])
            ai_validation = validate_ai_analysis(ai, jsum)
            repair_round = 0
            while ai_validation and repair_round < 2:
                repair_round += 1
                repair_prompt = (
                    "Reescribe por completo el siguiente análisis de confiabilidad en español. "
                    "Debes corregir estas contradicciones detectadas automáticamente:\n- "
                    + "\n- ".join(ai_validation)
                    + f"\nReglas obligatorias: {AI_ANALYSIS_RULES}\n"
                    + f"Identidades: {collisions}\nRecuperaciones: {recovered}\n"
                    + "Tabla autoritativa de workloads (workload_ref, label, estado y facts); "
                    + "copia estas identidades literalmente y no las reconstruyas de memoria:\n"
                    + json.dumps(jsum["latest_workloads"], ensure_ascii=False, indent=1)
                    + "\n"
                    + "Conserva los hechos útiles, pero no inventes. Responde solo el markdown corregido.\n\n"
                    + ai
                )
                ai = deepseek(repair_prompt[:40000])
                ai_validation = validate_ai_analysis(ai, jsum)
        except Exception as e:
            ai = f"_(análisis AI no disponible: {e})_"
    if jsum["by_kind"]:
        lines += ["", "## Salud de jobs (ventana)", "",
                  "```json", json.dumps({"attempts": jsum["by_kind"],
                                          "latest_by_workload": jsum["latest_by_workload"],
                                          "latest_workloads": jsum["latest_workloads"],
                                          "resolved_historical_errors": jsum["resolved_historical_errors"],
                                          "label_suffix_collisions": jsum["label_suffix_collisions"]},
                                         ensure_ascii=False, indent=1), "```"]
    if ai:
        validation_text = ("APROBADA por guardrails automáticos (identidad y recuperación)"
                           if not ai_validation else "RECHAZADA: " + "; ".join(ai_validation))
        lines += ["", "## Validación automática del texto", "", validation_text]
        if ai_validation:
            rejected_out = out.with_suffix(".rejected.md")
            rejected_out.write_text(ai)
            lines += ["", "El análisis fue omitido de este reporte porque contradijo los hechos "
                      f"estructurados. Copia de auditoría: `{rejected_out.name}`."]
        else:
            lines += ["", "## Análisis DeepSeek", "", ai]
    lines += ["", "---", "Estado: PENDIENTE DE REVISIÓN (Codex/Claude) · "
              f"fuente: error_report.py --days {days} · AI guardrails="
              f"{'REJECTED' if ai_validation else 'PASS'}"]
    out.write_text("\n".join(lines))
    (REPORTS / "latest.json").write_text(json.dumps(
        {"file": out.name, "ts": ts, "events": len(items), "signatures": len(d),
         "ai": bool(ai and not ai.startswith("_(")), "ai_valid": not ai_validation,
         "ai_validation": ai_validation}))
    print(f"reporte: {out} · {len(items)} eventos · {len(d)} firmas · AI={'sí' if ai else 'no'}")


if __name__ == "__main__":
    main()
