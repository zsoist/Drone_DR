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
import re
import sys
from pathlib import Path

from router import load_keys, gemini_vision, deepseek_text

VAULT = Path("/Volumes/SSD/drone-vault")

# Daniel: este prompt es la personalidad del analista — edítalo a tu gusto.
PROMPT = """Eres el analista de vuelos de un dron DJI (footage aéreo, Bogotá/viajes).
Estas son {n} imágenes muestreadas cronológicamente del clip {cid}; hay un frame cada {step}s.
Responde SOLO JSON válido (sin markdown) con este shape:
{{
 "summary": "1-2 frases en español describiendo la escena y el movimiento del vuelo",
 "scene_type": "urbano|naturaleza|costa|montaña|atardecer|interior|mixto",
 "tags": ["5-10 tags en español: objetos, lugares, texturas visibles"],
 "highlights": [{{"t": <segundos aprox del mejor momento>, "reason": "por qué"}}],
 "travel_score": <0-10: qué tan memorable/compartible es este footage>
}}"""

DEEP_PROMPT = """Eres un director de fotografía y editor senior analizando footage de dron DJI.
Estas son {n} imágenes muestreadas cronológicamente del clip {cid}; hay un frame cada {step}s.
Analiza a fondo y responde SOLO JSON válido (sin markdown) con este shape exacto:
{{
 "summary": "2-3 frases en español: escena, movimiento de cámara, narrativa del vuelo",
 "scene_type": "urbano|naturaleza|costa|montaña|atardecer|interior|mixto",
 "tags": ["10-15 tags en español: objetos, lugares, personas, texturas, colores"],
 "subjects": ["sujetos principales y qué hacen"],
 "camera_motion": "describe el movimiento: picado, órbita, dolly, revelación, seguimiento…",
 "quality": {{"exposure": "sub|ok|sobre", "stability": "estable|leve vibración|inestable",
             "light": "dura|suave|dorada|nublada", "issues": ["problemas visibles o []"]}},
 "highlights": [{{"t": <seg>, "reason": "por qué es el mejor momento", "type": "revelación|acción|paisaje|detalle"}}],
 "edit_suggestions": ["3-4 sugerencias concretas de edición: qué cortar, dónde slow-mo, qué look"],
 "best_thumbnail_t": <segundo del frame más fotogénico>,
 "hashtags": ["5 hashtags para redes"],
 "travel_score": <0-10>
}}"""


def analyze_clip(cid: str, keys: dict, deep: bool = False) -> dict | None:
    fdir = VAULT / "frames" / cid
    frames = sorted(fdir.glob("f_*.jpg"))
    if not frames:
        print(f"— {cid}: sin frames (tier skim), skip")
        return None
    n_sample = 16 if deep else 8
    step = max(1, len(frames) // n_sample)
    sample = frames[::step][:n_sample]
    # frames are 1-every-2s → frame index i ≈ second i*2 in the video
    tpl = DEEP_PROMPT if deep else PROMPT
    prompt = tpl.format(n=len(sample), cid=cid, step=step * 2)
    raw = gemini_vision(prompt, sample, keys)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    data = json.loads(m.group()) if m else {"summary": raw, "tags": []}
    data["clip_id"] = cid
    data["frames_analyzed"] = len(sample)
    data["deep"] = deep
    if deep:
        try:
            data.update(director_report(cid, data, keys))
        except Exception as e:
            print(f"  (informe del director falló, sigo sin él: {e})")
    out = VAULT / "ai" / f"{cid}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(f"🧠 {cid}: {data.get('scene_type', '?')} · score {data.get('travel_score', '?')}/10 · {len(data.get('tags', []))} tags")
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
        done = {p.stem for p in (VAULT / "ai").glob("DJI_*.json")} if (VAULT / "ai").exists() else set()
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
