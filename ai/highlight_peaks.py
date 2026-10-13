"""Local highlight evidence from stored keyframes. No video decoding or paid calls."""
import json
import math
import re
import statistics
from functools import lru_cache

from PIL import Image, ImageChops, ImageStat

try:
    from .insight_schema import DANGLING, PRAISE
except ImportError:
    from insight_schema import DANGLING, PRAISE

VERSION = 2
MAX_FRAMES = 600


def peak_label(insight, time_s):
    """Use only text observed in the segment that contains this peak."""
    segments = sorted((s for s in insight['highlight_segments']
                       if s['start'] <= time_s < s['end']), key=lambda s: -s['score'])
    for segment in segments:
        label = ' '.join(segment['reason'].split()).strip(' .;,:!?…')
        # A scene change is measured evidence, but it does not name a subject.
        if (PRAISE.search(label) or re.search(
                r'\b(?:cambio de escena|momento destacado|escena del vuelo|recorrido|interés visual)\b', label, re.I)):
            continue
        label = re.split(r'[.;!?]', label, maxsplit=1)[0]
        if len(label) > 40:
            label = label[:41].rsplit(' ', 1)[0]
        while label and (DANGLING.search(label) or re.search(r'\b(?:junto|frente)$', label, re.I)):
            label = label.rsplit(' ', 1)[0] if ' ' in label else ''
        words = {word.casefold().rstrip('s') for word in re.findall(r'\w+', label)}
        subjects = {word.casefold().rstrip('s') for subject in insight.get('subjects', [])
                    for word in re.findall(r'\w+', subject) if len(word) > 2}
        subjects -= {'paisaje', 'escena', 'vista', 'vuelo', 'momento', 'recorrido',
                     'con', 'del', 'lo', 'la', 'una', 'por', 'sin', 'que'}
        if not words.intersection(subjects):
            continue
        # Do not invent motion from a static subject description.
        if len(label.split()) >= 3 and re.search(
                r'\b(?:paso|giro|ascenso|descenso|acercamiento|alejamiento|seguimiento|'
                r'paneo|órbita|revelación|cruce|avance|vuelo|sobrevuelo|'
                r'pasa|gira|asciende|desciende|cruza|avanza|sobrevuela|revela|'
                r'aparece|emerge|bordea|rodea|recorre|sigue|entra|sale|acerca|aleja)\b', label, re.I):
            return label[:1].upper() + label[1:]
    return ''


def derive(data, vault):
    cid = data.get('clip_id', '')
    duration = data.get('duration_s', 0)
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', cid) or not data.get('insight') or duration < 3:
        return {'version': VERSION, 'segments': [], 'frames_scored': []}
    frames = sorted((vault / 'frames' / cid).glob('f_*.jpg'))
    frames = [p for p in frames if re.fullmatch(r'f_\d+', p.stem)
              and 0 <= (int(p.stem[2:]) - 1) * 2 < duration]
    if len(frames) > MAX_FRAMES:
        frames = [frames[round(i * (len(frames) - 1) / (MAX_FRAMES - 1))] for i in range(MAX_FRAMES)]
    signature = []
    for path in frames:
        try:
            stat = path.stat()
            signature.append((str(path), stat.st_mtime_ns, stat.st_size))
        except OSError:
            continue
    return json.loads(_derive(json.dumps(data['insight'], sort_keys=True), duration, tuple(signature)))


@lru_cache(maxsize=256)
def _derive(insight_json, duration, signature):
    ins = json.loads(insight_json)
    rows, previous = [], None
    for path, _, _ in signature:
        t = (int(path.rsplit('f_', 1)[1][:-4]) - 1) * 2
        try:
            with Image.open(path) as image:
                small = image.convert('RGB').resize((48, 27))
        except (OSError, ValueError):
            previous = None
            continue
        difference = (sum(ImageStat.Stat(ImageChops.difference(small, previous[1])).mean) / (3 * 255)
                      if previous else 0)
        vision = max((s['score'] for s in ins['highlight_segments'] if s['start'] <= t < s['end']), default=0)
        if t in ins['best_frame_times']:
            vision = max(vision, .7)
        rows.append({'time_s': t, 'difference': round(difference, 6), 'vision_score': vision,
                     'previous_time_s': previous[0] if previous else None})
        previous = (t, small)
    changes = [r['difference'] for r in rows if r['previous_time_s'] is not None]
    background = sorted(changes)[:max(1, math.ceil(len(changes) / 2))]
    baseline = statistics.median(background) if background else 0
    deviations = [abs(d - baseline) for d in background]
    threshold = max(.025, baseline + max(.015, 2 * statistics.median(deviations))) if changes else 1
    peaks = []
    for i, row in enumerate(rows):
        d, t = row['difference'], row['time_s']
        # A flat sampling grid or constant camera motion is not a distinct peak.
        if (d <= threshold or row['vision_score'] <= 0 or i == 0
                or d <= rows[i - 1]['difference']
                or (i + 1 < len(rows) and d < rows[i + 1]['difference'])):
            continue
        score = round(min(1, .65 * row['vision_score'] + .35 * min(1, d / max(.1, threshold))), 4)
        peaks.append((score, i))
    segments = []
    for score, i in sorted(peaks, key=lambda p: (-p[0], rows[p[1]]['time_s'])):
        row = rows[i]
        t = row['time_s']
        if any(abs(t - s['evidence']['peak_time_s']) < 20 for s in segments):
            continue
        # Measure the connected peak at half its height above the background.
        level = max(threshold, baseline + (row['difference'] - baseline) / 2)
        left = right = i
        while left > 1 and rows[left - 1]['difference'] >= level:
            left -= 1
        while right + 1 < len(rows) and rows[right + 1]['difference'] >= level:
            right += 1
        onset, offset = rows[left]['previous_time_s'], rows[right]['time_s']
        length = min(12, duration, max(3, offset - onset))
        start = (onset + offset - length) / 2
        # Keep the peak inside the segment when clipping a wide or asymmetric peak.
        start = max(t - length + .5, min(t - .5, start))
        start = round(max(0, min(start, duration - length)), 3)
        segments.append({'start': start, 'end': round(start + length, 3), 'score': score,
                         'reason': peak_label(ins, t),
                         'evidence': {'method': 'keyframe_difference', 'peak_time_s': t,
                                      'onset_s': onset, 'offset_s': offset,
                                      'previous_time_s': row['previous_time_s'],
                                      'difference': row['difference'], 'vision_score': row['vision_score'],
                                      'threshold': round(threshold, 6)}})
        if len(segments) == 4:
            break
    segments.sort(key=lambda s: s['start'])
    seen = set()
    for segment in segments:
        key = segment['reason'].casefold()
        if key in seen:
            segment['reason'] = ''
        seen.add(key)
    return json.dumps({'version': VERSION, 'segments': segments,
                       'frames_scored': rows}, allow_nan=False)
