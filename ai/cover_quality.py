"""Shared cover policy. Missing evidence or unreadable images fail closed."""
import math
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageStat

MIN_LUMINANCE = 45  # Display-referred mean luma, on a 0–255 scale.
TEXT = re.compile(r'\b(?:letreros?|cartel(?:es)?|textos?|numeros?|telefonos?|se vende|en venta|'
                  r'signs?|billboards?|phone|numbers?)\b')
# Clip-level evidence cannot localize a face. Exclude the entire candidate clip.
PEOPLE = re.compile(r'\b(?:personas?|hombres?|mujer(?:es)?|ninos?|ninas?|rostros?|caras?|'
                    r'parejas?|jovenes|adultos?|gente|amigos?|retratos?|selfie|people|person|man|woman|faces?|close.up)\b')


def evidence_reasons(data):
    ins = data.get('insight', {})
    parts = [ins.get('caption', data.get('summary', '')), ins.get('light_notes', ''),
             ins.get('caption_short', data.get('caption_short', '')),
             *ins.get('tags', data.get('tags', [])), *ins.get('subjects', data.get('subjects', [])),
             *[s.get('reason', '') for s in ins.get('highlight_segments', [])]]
    text = ' '.join(p for p in parts if isinstance(p, str))
    text = ''.join(c for c in unicodedata.normalize('NFKD', text.lower()) if not unicodedata.combining(c))
    reasons = []
    if not text.strip():
        reasons.append('missing_evidence')
    if TEXT.search(text):
        reasons.append('text_or_sign')
    if PEOPLE.search(text):
        reasons.append('person')
    if ins.get('quality_flags'):
        reasons.append('quality_flag')
    return reasons


@lru_cache(maxsize=4096)
def _luminance(path, mtime_ns, size):
    try:
        with Image.open(path) as image:
            image.thumbnail((64, 64))
            rgb = ImageStat.Stat(image.convert('RGB')).mean
            return round(.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2], 2)
    except (OSError, ValueError):
        return None


def assess(data, frame, vault):
    reasons = evidence_reasons(data)
    url = frame.get('frame_url', '')
    cid = frame['clip_id']
    prefix = f'/data/frames/{cid}/'
    name = url.removeprefix(prefix)
    path = Path(vault) / 'frames' / cid / name
    if not url.startswith(prefix) or not re.fullmatch(r'f_\d+\.jpg', name):
        return {'eligible': False, 'reasons': reasons + ['missing_frame'], 'mean_luminance': None}
    try:
        stat = path.stat()
    except OSError:
        return {'eligible': False, 'reasons': reasons + ['missing_frame'], 'mean_luminance': None}
    # Only frame-specific brightness is valid here; a clip average can hide a dark cover.
    stored = data.get('frame_luminance', {}).get(name)
    if (isinstance(stored, dict) and stored.get('mtime_ns') == stat.st_mtime_ns
            and stored.get('size') == stat.st_size
            and type(stored.get('mean')) in (float, int) and math.isfinite(stored['mean'])
            and 0 <= stored['mean'] <= 255):
        luma = stored['mean']
    else:
        luma = _luminance(str(path), stat.st_mtime_ns, stat.st_size)
    if luma is None:
        reasons.append('unreadable_frame')
    elif luma < MIN_LUMINANCE:
        reasons.append('dark_frame')
    return {'eligible': not reasons, 'reasons': reasons, 'mean_luminance': luma}
