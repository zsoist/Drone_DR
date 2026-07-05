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

from router import load_keys, gemini_vision

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


def analyze_clip(cid: str, keys: dict) -> dict | None:
    fdir = VAULT / "frames" / cid
    frames = sorted(fdir.glob("f_*.jpg"))
    if not frames:
        print(f"— {cid}: sin frames (tier skim), skip")
        return None
    step = max(1, len(frames) // 8)
    sample = frames[::step][:8]
    # frames are 1-every-2s → frame index i ≈ second i*2 in the video
    prompt = PROMPT.format(n=len(sample), cid=cid, step=step * 2)
    raw = gemini_vision(prompt, sample, keys)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    data = json.loads(m.group()) if m else {"summary": raw, "tags": []}
    data["clip_id"] = cid
    data["frames_analyzed"] = len(sample)
    out = VAULT / "ai" / f"{cid}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(f"🧠 {cid}: {data.get('scene_type', '?')} · score {data.get('travel_score', '?')}/10 · {len(data.get('tags', []))} tags")
    return data


def main():
    keys = load_keys()
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
