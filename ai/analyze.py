"""AI scene analysis per clip: keyframes → Gemini vision → structured intel.

Output: drone-vault/ai/<clip_id>.json
  { summary, tags[], scene_type, highlights[{t, reason}], travel_score }

Cost control:
  - only clips with extracted frames (tier full/standard)
  - max 8 frames per clip, evenly sampled, in ONE vision call
  - Gemini Flash ≈ $0.002/clip → los 40 clips ≈ $0.08

Usage:
    python3 analyze.py <clip_id>      # one clip
    python3 analyze.py --all          # every clip with frames, skip analyzed
"""
import json
import math
import os
import tempfile
import re
import subprocess
import sys
from pathlib import Path

from router import load_keys, deepseek_text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
from paths import VAULT  # noqa: E402


def extract_frames_from_proxy(cid: str, fdir) -> list:
    """Los clips skim no traían frames (el tier solo los extraía para full/standard).
    Hoy TODOS tienen proxy 1080p — extraemos el mismo formato que process.py
    (1 frame cada 2s, 960px) para habilitar análisis on-demand y filmstrip."""
    proxy = VAULT / "proxies" / f"{cid}.mp4"
    if not proxy.exists():
        return []
    fdir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".frames-", dir=fdir.parent) as td:
        stage = Path(td) / "images"
        stage.mkdir()
        result = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(proxy),
                         "-vf", "fps=1/2,scale=960:-2", "-q:v", "4", str(stage / "f_%04d.jpg")],
                         capture_output=True, timeout=300)
        if result.returncode or not list(stage.glob("f_*.jpg")):
            raise RuntimeError("no se pudieron extraer todos los frames")
        if fdir.exists():
            fdir.rmdir()  # Only an empty destination can be replaced.
        os.replace(stage, fdir)
    return sorted(fdir.glob("f_*.jpg"))


def sample_frames(frames: list, n_sample: int) -> tuple[list, int]:
    """n_sample frames equiespaciados sobre TODO el clip (frames[::step][:n] solo cubría el
    inicio cuando len(frames) no era múltiplo de n_sample). Devuelve (muestra, segundos entre
    frames muestreados); los frames de origen están a 1 cada 2 s."""
    n = len(frames)
    if n <= n_sample:
        return list(frames), 2
    idxs = sorted({round(i * (n - 1) / (n_sample - 1)) for i in range(n_sample)})
    sample = [frames[i] for i in idxs]
    spacing = 2 * (n - 1) / (len(sample) - 1) if len(sample) > 1 else 2
    return sample, max(2, round(spacing))


def validate_analysis(data: dict) -> dict:
    """Reject unsafe field types before any stored analysis can change."""
    if not isinstance(data, dict):
        raise ValueError("el análisis debe ser un objeto JSON")
    for key in ("summary", "scene_type", "camera_motion", "story_arc"):
        if key in data and not isinstance(data[key], str):
            raise ValueError(f"{key}: se esperaba texto")
    for key in ("tags", "subjects", "edit_suggestions", "hashtags", "director_notes", "uses"):
        value = data.get(key, [])
        if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
            raise ValueError(f"{key}: se esperaba una lista de textos")
    def number(value, low, high):
        return type(value) in (int, float) and math.isfinite(value) and low <= value <= high
    if "travel_score" in data and not number(data["travel_score"], 0, 10):
        raise ValueError("travel_score fuera de rango")
    if "best_thumbnail_t" in data and not number(data["best_thumbnail_t"], 0, 86400):
        raise ValueError("best_thumbnail_t fuera de rango")
    highlights = data.get("highlights", [])
    if not isinstance(highlights, list):
        raise ValueError("highlights debe ser una lista")
    for row in highlights:
        if (not isinstance(row, dict) or not number(row.get("t"), 0, 86400)
                or not isinstance(row.get("reason"), str)
                or ("type" in row and not isinstance(row["type"], str))):
            raise ValueError("highlight inválido")
    if "quality" in data:
        quality = data["quality"]
        if not isinstance(quality, dict):
            raise ValueError("quality debe ser un objeto")
        for key in ("exposure", "stability", "light"):
            if key in quality and not isinstance(quality[key], str):
                raise ValueError(f"quality.{key} debe ser texto")
        issues = quality.get("issues", [])
        if not isinstance(issues, list) or any(not isinstance(v, str) for v in issues):
            raise ValueError("quality.issues debe ser una lista de textos")
    return data


def analyze_clip(cid: str, keys: dict, deep: bool = False) -> dict | None:
    import insights
    data = insights.build_record(cid, keys, VAULT)
    data['deep'] = deep
    if deep:
        report = validate_analysis(director_report(cid, data, keys))
        if not report.get('director_notes'):
            raise ValueError('informe del director incompleto')
        data.update({key: report[key] for key in ('director_notes', 'story_arc', 'uses') if key in report})
    insights.save_record(data, VAULT)
    print(f"AI {cid}: {data['scene_type']} · score {data['travel_score']}/10")
    return data


def director_report(cid: str, vision: dict, keys: dict) -> dict:
    """Etapa 2: DeepSeek sintetiza el analisis visual + la telemetria real en un
    informe de director accionable — narrativa, momentos y usos concretos."""
    tele = ""
    tf = VAULT / "tracks" / f"{cid}.flight.json"
    if tf.exists():
        t = json.loads(tf.read_text())
        st = t.get("stats", {})
        alts = [p.get("rel_alt", 0) for p in t.get("points", [])]
        tele = (f"duración {st.get('duration_s', '?')}s, distancia {st.get('distance_m', '?')}m, "
                f"altura máx {st.get('max_rel_alt_m', '?')}m, "
                f"perfil de altura (m, cada ~10%): {[round(a) for a in alts[::max(1, len(alts)//10)]]}")
    resumen = {k: vision.get(k) for k in ("summary", "scene_type", "subjects", "camera_motion",
                                          "quality", "highlights", "travel_score") if vision.get(k)}
    prompt = f"""Analizaste footage de dron DJI. Datos del análisis visual (Gemini):
{json.dumps(resumen, ensure_ascii=False)}
Telemetría real del vuelo: {tele or 'no disponible'}

Escribe el informe del director. Responde SOLO JSON válido (sin markdown):
{{
 "director_notes": ["3 párrafos CORTOS (2-3 frases c/u) en español: 1) qué historia cuenta este vuelo,
   2) qué funciona cinematográficamente y por qué, 3) qué haría un pro distinto la próxima vez"],
 "story_arc": "el arco del vuelo en UNA línea (ej: 'de la intimidad del patio a la escala de la ciudad')",
 "uses": ["3 usos concretos para este footage: tipo de video/post/entrega y qué segmento usar"]
}}
Sé específico con lo que VES en los datos (alturas, momentos, escena) — nada genérico."""
    raw = deepseek_text(prompt, keys,
                        system="Eres un director de fotografía de drones. Español conciso, específico, cero relleno.")
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    return json.loads(m.group()) if m else {}


def main():
    keys = load_keys()
    deep = "--deep" in sys.argv
    if deep:
        for cid in [a for a in sys.argv[1:] if not a.startswith("--")]:
            analyze_clip(cid, keys, deep=True)
        return
    if "--all" in sys.argv:
        # TODOS los análisis previos (DJI_* y UP_*), salvo el índice trips.json; con solo DJI_*
        # los uploads se re-analizaban (y cobraban) en cada corrida
        done = ({p.stem for p in (VAULT / "ai").glob("*.json") if p.name != "trips.json"}
                if (VAULT / "ai").exists() else set())
        cids = sorted(d.name for d in (VAULT / "frames").iterdir()
                      if d.is_dir() and d.name not in done)
    else:
        cids = sys.argv[1:]
    for cid in cids:
        try:
            analyze_clip(cid, keys)
        except Exception as e:
            print(f"✗ {cid}: {e}")


if __name__ == "__main__":
    main()
