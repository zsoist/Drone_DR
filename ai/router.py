"""Multi-provider LLM router — cost-aware lanes (stdlib only, no deps).

Lanes (por qué cada uno):
  vision  → Gemini Flash: el más barato con vision de calidad; frames JPG
  text    → DeepSeek: síntesis/redacción 10-18x más barato que GPT
  fallback→ OpenAI: si un lane falla

Keys: /Volumes/SSD/_system/claude/.api-keys.env (nunca hardcodear).
"""
import base64
import json
import os
import urllib.request
from pathlib import Path

KEYS_FILE = Path("/Volumes/SSD/_system/claude/.api-keys.env")

GEMINI_MODELS = ["gemini-2.5-flash", "gemini-flash-latest"]  # try in order
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")


def load_keys() -> dict:
    keys = {}
    for line in KEYS_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            keys[k.strip()] = v.strip().strip('"')
    return keys


def _post(url: str, payload: dict, headers: dict, timeout=120) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def gemini_vision(prompt: str, image_paths: list[Path], keys: dict) -> str:
    """Describe/analyze a batch of images in ONE call (cheaper than per-frame)."""
    parts = [{"text": prompt}]
    for p in image_paths:
        parts.append({"inline_data": {
            "mime_type": "image/jpeg",
            "data": base64.b64encode(p.read_bytes()).decode(),
        }})
    last_err = None
    for model in GEMINI_MODELS:
        url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
               f"{model}:generateContent?key={keys['GEMINI_API_KEY']}")
        try:
            out = _post(url, {"contents": [{"parts": parts}]}, {})
            return out["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:  # try next model on 404/version drift
            last_err = e
    raise RuntimeError(f"gemini failed: {last_err}")


def deepseek_text(prompt: str, keys: dict, system: str = "") -> str:
    msgs = ([{"role": "system", "content": system}] if system else [])
    msgs.append({"role": "user", "content": prompt})
    out = _post("https://api.deepseek.com/chat/completions",
                {"model": DEEPSEEK_MODEL, "messages": msgs, "temperature": 0.4},
                {"Authorization": f"Bearer {keys['DEEPSEEK_API_KEY']}"})
    return out["choices"][0]["message"]["content"]


def openai_text(prompt: str, keys: dict) -> str:
    out = _post("https://api.openai.com/v1/chat/completions",
                {"model": "gpt-5-mini", "messages": [{"role": "user", "content": prompt}]},
                {"Authorization": f"Bearer {keys['OPENAI_API_KEY']}"})
    return out["choices"][0]["message"]["content"]
