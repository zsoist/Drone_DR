"""Stored visual suggestions, local cosine search, collections and summary caches."""
import hashlib
import json
import math
import re
import threading
import unicodedata
from collections import OrderedDict
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'pipeline'))
from fsutil import atomic_write_json
from keys import load_keys
from paths import VAULT
try:
    from . import router, cover_quality, highlight_peaks
    from .insight_schema import (INSIGHT_SCHEMA, PRAISE, validate_insight, neutral_caption,
                                 trim_caption, valid_short, normalize_tags, repair_short)
except ImportError:
    import router
    import cover_quality
    import highlight_peaks
    from insight_schema import (INSIGHT_SCHEMA, PRAISE, validate_insight, neutral_caption,
                                trim_caption, valid_short, normalize_tags, repair_short)


def read(path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False,
                                    allow_nan=False).encode()).hexdigest()


def valid_id(cid):
    return isinstance(cid, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,120}', cid)


def flights(vault=VAULT):
    return [f for f in read(vault / 'manifest/flights.json', {}).get('flights', [])
            if valid_id(f.get('clip_id')) and not f.get('archived')]


def record(cid, vault=VAULT):
    if not valid_id(cid):
        raise ValueError('invalid clip id')
    value = read(vault / 'ai' / f'{cid}.json', {})
    if not isinstance(value, dict):
        return {}
    if not isinstance(value.get('embedding'), dict):
        value.pop('embedding', None)
    for key in ('summary',):
        if not isinstance(value.get(key, ''), str):
            value.pop(key, None)
    for key in ('tags',):
        if not isinstance(value.get(key, []), list):
            value.pop(key, None)
    for key in ('travel_score', 'best_thumbnail_t'):
        number = value.get(key, 0)
        if type(number) not in (int, float) or not math.isfinite(number) or number < 0:
            value.pop(key, None)
    if 'insight' in value:
        try:
            # Read v1 without writes or paid calls. The backfill persists the upgrade.
            if not valid_short(value['insight'].get('caption_short')):
                value['insight']['caption_short'] = repair_short(
                    value.get('caption_short') if valid_short(value.get('caption_short'))
                    else value['insight']['caption'],
                    value['insight'].get('subjects', []))
            if isinstance(value['insight'].get('tags'), list):
                value['insight']['tags'] = normalize_tags(value['insight']['tags'])
            validate_insight(value['insight'], value['duration_s'], value['sampled_frame_times'])
        except (KeyError, TypeError, ValueError):
            value.pop('insight', None)
            value.pop('embedding', None)
    if 'tags' in value:
        value['tags'] = normalize_tags(value['tags'])
    return value


def embedding_text(insight):
    return insight['caption'] + '\n' + ', '.join(insight['tags'])


def unit_vector(value, size=None):
    if (not isinstance(value, list) or not value or (size and len(value) != size)
            or any(type(n) not in (int, float) or not math.isfinite(n) for n in value)):
        raise ValueError('invalid embedding')
    norm = math.sqrt(sum(n * n for n in value))
    if not math.isfinite(norm) or norm == 0:
        raise ValueError('invalid embedding norm')
    return [n / norm for n in value]


def build_record(cid, keys, vault=VAULT):
    """Reuse extracted JPEG files. Publish only after all clip fields pass validation."""
    if not valid_id(cid):
        raise ValueError('invalid clip id')
    frames = sorted((vault / 'frames' / cid).glob('f_*.jpg'))
    if not frames:
        raise ValueError('no extracted frames')
    meta = read(vault / 'manifest' / f'{cid}.json', {})
    duration = meta.get('duration_s')
    if type(duration) not in (int, float) or not math.isfinite(duration) or duration <= 0:
        raise ValueError('missing clip duration')
    timed = [(p, (int(p.stem[2:]) - 1) * 2) for p in frames if re.fullmatch(r'f_\d+', p.stem)]
    timed = [(p, t) for p, t in timed if 0 <= t < duration]
    if not timed:
        raise ValueError('no frames inside duration')
    indexes = sorted({round(i * (len(timed) - 1) / 7) for i in range(8)})
    sample = [timed[i][0] for i in indexes]
    times = [timed[i][1] for i in indexes]
    prompt = (f'Analiza este clip de dron de {duration}s. Los frames están en estos segundos exactos: {times}. '
              'Devuelve el esquema JSON en español. Usa best_frame_times solo de esta lista. '
              'Los segmentos deben estar dentro del clip; score mide interés visual de 0 a 1. '
              'Devuelve highlight_segments vacío cuando no haya evidencia de un momento destacado. '
              'No repartas segmentos a intervalos fijos ni inventes movimiento entre imágenes aisladas. '
              'reason es una etiqueta distinta de hasta 40 caracteres: sujeto y acción observados en ese segmento. '
              'No uses frases genéricas como Cambio de escena en el recorrido. '
              'Describe solo evidencia visible. No inventes lugares. Son sugerencias, no decisiones del dueño. '
              'caption y caption_short describen sujetos y acciones concretos, sin elogios: '
              'no uses excelente, impresionante, majestuoso, espectacular, hermoso ni similares. '
              'caption_short tiene de 4 a 9 palabras y hasta 100 caracteres: sujeto concreto más entorno o luz. '
              'Nunca empieces con Dron muestra, Dron o Vista aérea de. Etiquetas solo en español, '
              'sin duplicados ni etiquetas genéricas como dron o vista aérea. '
              'Con frames aislados no puedes confirmar estabilidad entre frames: marca solo problemas visibles. '
              'sobreexpuesto significa altas luces blancas quemadas, nunca una escena oscura. '
              'horizonte requiere un horizonte visible inclinado; no aplica a una toma cenital sin horizonte. '
              'Si ninguna bandera tiene evidencia clara, devuelve quality_flags vacío. '
              'Sugiere un preset existente y exposición EV conservadora.')
    raw, usage = router.gemini_insight(prompt, sample, keys, INSIGHT_SCHEMA)
    insight = json.loads(raw)
    if isinstance(insight, dict) and isinstance(insight.get('caption'), str):
        insight['caption'] = neutral_caption(insight['caption'])
        if not valid_short(insight.get('caption_short')):
            insight['caption_short'] = repair_short(insight['caption'],
                                                    insight.get('subjects', []))
        if isinstance(insight.get('tags'), list):
            insight['tags'] = normalize_tags(insight['tags'])
    insight = validate_insight(insight, duration, times)
    content = embedding_text(insight)
    vector = unit_vector(router.embed_text(content, keys), router.EMBEDDING_DIMENSIONS)
    usage['estimated_usd'] = round((usage['input_tokens'] * .30 + usage['output_tokens'] * 2.50) / 1e6, 8)
    # embedContent does not return usage; this is an explicit estimate, not measured tokens.
    embedding = {'model': router.EMBEDDING_MODEL, 'dimensions': len(vector), 'vector': vector,
                 'source_hash': digest(content), 'estimated_tokens': math.ceil(len(content) / 3)}
    embedding['estimated_usd'] = round(embedding['estimated_tokens'] * .15 / 1e6, 8)
    segments = insight['highlight_segments']
    result = {'schema_version': 2, 'clip_id': cid, 'suggested': True, 'insight': insight,
              'duration_s': duration, 'sampled_frame_times': times, 'frames_analyzed': len(sample),
              'embedding': embedding, 'usage': usage,
              # Legacy fields keep cards, Studio and build_index compatible.
              'summary': insight['caption'], 'tags': insight['tags'], 'subjects': insight['subjects'],
              'scene_type': insight['scene_type'], 'camera_motion': insight['shot_type'],
              'highlights': segment_highlights(insight),
              'best_thumbnail_t': insight['best_frame_times'][0],
              'travel_score': round(max((s['score'] for s in segments), default=0) * 10, 1)}
    evidence = highlight_peaks.derive(result, vault)
    result['highlight_evidence'] = evidence
    result['highlights'] = segment_highlights({**insight, 'highlight_segments': evidence['segments']})
    result['synthetic'] = not bool(result['highlights'])
    return result


def upgrade_caption(data, keys):
    """Use stored text only. A failed text call falls back to a deterministic trim."""
    result = {**data, 'insight': dict(data['insight']), 'schema_version': 2}
    try:
        raw, _ = router.short_caption(data['insight']['caption'], keys)
        short = json.loads(raw)['caption_short']
        if isinstance(short, str):
            short = short.rstrip('.')
        if not valid_short(short):
            raise ValueError('invalid short caption')
        result['caption_short_source'] = 'deepseek'
    except Exception:
        short = repair_short(neutral_caption(data['insight']['caption']), data['insight']['subjects'])
        result['caption_short_source'] = 'trim'
    result['insight']['caption_short'] = short
    return result


def has_embedding(data):
    try:
        e = data['embedding']
        if (e['model'] != router.EMBEDDING_MODEL or e['dimensions'] != router.EMBEDDING_DIMENSIONS
                or e['source_hash'] != digest(embedding_text(data['insight']))):
            return False
        unit_vector(e['vector'], router.EMBEDDING_DIMENSIONS)
        return True
    except (KeyError, TypeError, ValueError):
        return False


def refresh_embedding(data, keys):
    content = embedding_text(data['insight'])
    vector = unit_vector(router.embed_text(content, keys), router.EMBEDDING_DIMENSIONS)
    result = dict(data)
    result['embedding'] = {'model': router.EMBEDDING_MODEL, 'dimensions': len(vector),
                           'vector': vector, 'source_hash': digest(content),
                           'estimated_tokens': math.ceil(len(content) / 3),
                           'estimated_usd': round(math.ceil(len(content) / 3) * .15 / 1e6, 8)}
    return result


def save_record(data, vault=VAULT):
    cid = data['clip_id']
    if not valid_id(cid):
        raise ValueError('invalid clip id')
    validate_insight(data['insight'], data['duration_s'], data['sampled_frame_times'])
    if not has_embedding(data):
        raise ValueError('embedding does not match insight')
    target = vault / 'ai' / f'{cid}.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    # Keep the stored v1 insight shape readable by the running server during rollout.
    stored = {**data, 'insight': dict(data['insight'])}
    stored['caption_short'] = stored['insight'].pop('caption_short')
    atomic_write_json(target, stored, allow_nan=False)


def segment_highlights(insight):
    return [{'t': s['start'], 'time_s': s['start'],
             **({'label': s['reason']} if s['reason'] else {}),
             'start': s['start'], 'end': s['end'], 'score': s['score'],
             'reason': s['reason'], 'type': insight['shot_type'], 'synthetic': False,
             **({'evidence': s['evidence']} if 'evidence' in s else {})}
            for s in insight.get('highlight_segments', [])
            if s.get('evidence', {}).get('method') == 'keyframe_difference']


def evidence_record(data, vault):
    """Do not present provider sampling intervals as measured highlight peaks."""
    if not data.get('insight'):
        return data
    evidence = highlight_peaks.derive(data, vault)
    return {**data, 'highlight_evidence': evidence,
            'frame_rejection_reasons': cover_quality.evidence_reasons(data),
            'insight': {**data['insight'], 'highlight_segments': evidence['segments']}}


def public_record(cid, vault=VAULT):
    """Adapt stored evidence for legacy clients without making writes or provider calls."""
    data = evidence_record(record(cid, vault), vault)
    if not data:
        return {'clip_id': cid, 'highlights': [], 'owner_highlights': [], 'synthetic': True, 'cover': None}
    insight = data.get('insight', {})
    manual = [h for key in ('owner_highlights', 'highlights')
              for h in (data[key] if isinstance(data.get(key), list) else [])
              if isinstance(h, dict) and h.get('type') == 'manual']
    try:
        summary = get_summary('flight', cid, vault)['summary']
    except KeyError:
        summary = ' '.join(data.get('summary', '').split()).rstrip('.!?')
        summary = summary + '.' if summary else ''
    return {**data, 'tags': insight.get('tags', data.get('tags', [])),
            'summary': summary,
            'caption': insight.get('caption', data.get('summary', '')),
            'caption_short': insight.get('caption_short') or trim_caption(data.get('summary', '')),
            'highlights': segment_highlights(insight), 'owner_highlights': manual,
            'synthetic': not bool(insight.get('highlight_segments')),
            'cover': next(cover_candidates([cid], {cid: data}, vault), None)}


def get_insight(cid, vault=VAULT):
    data = record(cid, vault)
    insight = data.get('insight', {})
    frames = [{'clip_id': cid, 'frame_url': f'/data/frames/{cid}/{p.name}',
               'frame_time_s': (int(p.stem[2:]) - 1) * 2,
               'caption': insight.get('caption', data.get('summary', '')),
               'caption_short': insight.get('caption_short', data.get('caption_short', ''))}
              for p in sorted((vault / 'frames' / cid).glob('f_*.jpg'))
              if re.fullmatch(r'f_\d+', p.stem)]
    try:
        validate_insight(data['insight'], data['duration_s'], data['sampled_frame_times'])
    except (KeyError, TypeError, ValueError):
        return {'clip_id': cid, 'status': 'pending', 'suggested': True, 'insight': None, 'synthetic': True, 'frames': frames}
    data = evidence_record(data, vault)
    return {'clip_id': cid, 'status': 'ready', 'suggested': True, 'insight': data['insight'], 'frames': frames,
            'synthetic': not bool(data['insight']['highlight_segments']),
            'cover': next(cover_candidates([cid], {cid: data}, vault), None)}


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c))


def tokens(text):
    return set(re.findall(r'\w+', normalized(text)))


def moment(cid, data, query='', vault=VAULT, *, highlight=False):
    insight = data.get('insight', {})
    segments = insight.get('highlight_segments', [])
    selected = max(segments, key=lambda s: (len(tokens(query) & tokens(s['reason'])), s['score'],
                                          s['start'] >= 1, -s['start']), default=None)
    best_times = insight.get('best_frame_times') or [data.get('best_thumbnail_t', 0)]
    t = (selected.get('evidence', {}).get('peak_time_s', selected['start'])
         if selected and (query or highlight) else best_times[0])
    if selected and (query or highlight) and t == 0:
        t = next((time for time in best_times if 1 <= time < selected['end']), 0)
    available = []
    for p in (vault / 'frames' / cid).glob('f_*.jpg'):
        if re.fullmatch(r'f_\d+', p.stem):
            available.append(((int(p.stem[2:]) - 1) * 2, p.name))
    frame_time, name = min(available, key=lambda row: abs(row[0] - t)) if available else (None, None)
    frame = {'clip_id': cid, 'time_s': t, 'frame_time_s': frame_time,
            'frame_url': f'/data/frames/{cid}/{name}' if name else f'/data/thumbs/{cid}.jpg',
            'caption': insight.get('caption', data.get('summary', '')),
            'caption_short': insight.get('caption_short', data.get('caption_short', '')),
            'score': selected['score'] if selected else (data.get('travel_score') or 0) / 10,
            'selection': 'ai' if insight or data.get('travel_score') else 'sample',
            'synthetic': not bool(selected) if highlight or query else not bool(insight)}
    label = (selected['reason'] if selected and (query or highlight)
             else frame['caption_short'])
    if label:
        frame['label'] = label
    frame['quality'] = cover_quality.assess(data, frame, vault)
    if not frame['quality']['eligible']:
        frame['frame_url'] = None
    return frame


_QUERY_CACHE = OrderedDict()
_QUERY_LOCK = threading.Lock()


def query_vector(q, keys):
    # Bounded RAM cache. No query or provider result is written by a GET.
    with _QUERY_LOCK:
        if q not in _QUERY_CACHE:
            value = unit_vector(router.embed_text(q, keys, 'RETRIEVAL_QUERY'), router.EMBEDDING_DIMENSIONS)
            _QUERY_CACHE[q] = value
            if len(_QUERY_CACHE) > 128:
                _QUERY_CACHE.popitem(last=False)
        return _QUERY_CACHE[q]


def search(q, limit=12, vault=VAULT, embed=None):
    q = q.strip()
    if not q or len(q) > 400 or not 1 <= limit <= 50:
        raise ValueError('q must contain 1–400 characters; limit must be 1–50')
    rows = [(f, evidence_record(record(f['clip_id'], vault), vault)) for f in flights(vault)]
    vec = None
    if any(d.get('embedding') for _, d in rows):
        try:
            vec = unit_vector(embed(q) if embed else query_vector(q, load_keys()))
        except Exception:
            pass  # A provider outage leaves lexical search available.
    results = []
    qt = tokens(q)
    for f, data in rows:
        ins = data.get('insight', {})
        caption = ins.get('caption', data.get('summary', ''))
        tags = ins.get('tags', data.get('tags', []))
        if not isinstance(caption, str) or not isinstance(tags, list):
            continue
        words = tokens(' '.join([caption, *[t for t in tags if isinstance(t, str)]]))
        lexical = len(qt & words) / max(1, len(qt))
        score, mode = lexical, 'tags'
        e = data.get('embedding', {})
        if vec and ins and e.get('model') == router.EMBEDDING_MODEL and e.get('source_hash') == digest(embedding_text(ins)):
            try:
                v = unit_vector(e['vector'], len(vec))
                cosine = sum(a * b for a, b in zip(vec, v))
                score, mode = max(lexical, max(0, cosine)), 'semantic'
            except (KeyError, ValueError):
                pass
        if score > 0:
            matched = moment(f['clip_id'], data, q, vault)
            results.append({'clip_id': f['clip_id'], 'score': round(score, 6), 'mode': mode,
                            'caption': caption, 'caption_short': ins.get('caption_short') or trim_caption(caption),
                            'tags': tags,
                            'matched_moment': matched})
    results.sort(key=lambda r: (-r['score'], r['clip_id']))
    return {'q': q, 'mode': 'hybrid' if vec else 'tags', 'results': results[:limit]}


def hav_km(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, [*a, *b])
    x = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 12742 * math.asin(math.sqrt(min(1, max(0, x))))


def trip_groups(rows):
    groups = []
    for f in rows:  # Same newest-first anchor and 30 km rule as trips.js.
        home = f.get('stats', {}).get('home')
        if (not isinstance(home, list) or len(home) != 2
                or any(type(v) not in (int, float) or not math.isfinite(v) for v in home)
                or not -180 <= home[0] <= 180 or not -90 <= home[1] <= 90):
            continue
        group = next((g for g in groups if hav_km(g['home'], home) < 30), None)
        if group is None:
            group = {'id': f'{home[1]:.2f},{home[0]:.2f}', 'home': home, 'flights': []}
            groups.append(group)
        group['flights'].append(f)
    return groups


MONTHS = ('Enero Febrero Marzo Abril Mayo Junio Julio Agosto Septiembre Octubre Noviembre Diciembre').split()
SHOT_TITLES = dict(zip(
    ['órbita', 'revelación', 'cenital', 'FPV', 'travelling', 'paneo', 'ascenso',
     'descenso', 'estático', 'seguimiento', 'mixto'],
    ['Órbitas', 'Revelaciones', 'Tomas cenitales', 'Vuelos FPV', 'Travellings', 'Paneos',
     'Ascensos', 'Descensos', 'Tomas estáticas', 'Seguimientos', 'Tomas mixtas']))
# Same known labels and coordinates as Viajes (trips.js).
CITIES = [
    ('Bogotá', 4.711, -74.072), ('Medellín', 6.244, -75.581), ('Cali', 3.452, -76.532),
    ('Cartagena', 10.391, -75.479), ('Barranquilla', 10.964, -74.797), ('Santa Marta', 11.241, -74.199),
    ('Bucaramanga', 7.119, -73.123), ('Pereira', 4.813, -75.696), ('Manizales', 5.070, -75.518),
    ('Armenia', 4.535, -75.676), ('Ibagué', 4.439, -75.232), ('Villavicencio', 4.142, -73.627),
    ('Tunja', 5.535, -73.368), ('Popayán', 2.444, -76.615), ('Neiva', 2.928, -75.288),
    ('Girardot', 4.303, -74.804), ('Melgar', 4.204, -74.641), ('La Mesa', 4.631, -74.463),
    ('Villeta', 5.013, -74.472), ('Anapoima', 4.548, -74.536), ('Fusagasugá', 4.337, -74.364),
    ('Honda', 5.209, -74.737), ('Mariquita', 5.199, -74.893), ('La Vega', 4.999, -74.339),
]


def place_metadata(groups, meta):
    """Resolve shifted trip anchors without modifying owner metadata on GET."""
    used = {g['id'] for g in groups if g['id'] in meta}
    resolved = {}
    for g in groups:
        saved = meta.get(g['id'])
        if saved is None:
            candidates = []
            for key, value in meta.items():
                if key in used or not re.fullmatch(r'-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?', key):
                    continue
                lat, lon = map(float, key.split(','))
                distance = hav_km(g['home'], [lon, lat])
                if distance < 30:
                    candidates.append((distance, key, value))
            if candidates:
                _, key, saved = min(candidates)
                used.add(key)
        resolved[g['id']] = saved or {}
    return resolved


def place_title(group, saved, meta):
    if saved.get('name'):
        return saved['name']
    known = [(hav_km(group['home'], [lon, lat]), name) for name, lat, lon in CITIES]
    for key, value in meta.items():
        if value.get('name') and re.fullmatch(r'-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?', key):
            lat, lon = map(float, key.split(','))
            known.append((hav_km(group['home'], [lon, lat]), value['name']))
    distance, label = min(known)
    return label if distance < 30 else f'Cerca de {label}'


def cover_candidates(ids, records, vault):
    candidates = []
    for cid in ids:
        data = records[cid]
        if cover_quality.evidence_reasons(data):
            continue
        ins = data.get('insight', {})
        times = list(dict.fromkeys([*ins.get('best_frame_times', []),
                                   *data.get('sampled_frame_times', []), data.get('best_thumbnail_t', 0)]))
        seen = set()
        for t in times:
            frame = moment(cid, {**data, 'insight': {**ins, 'best_frame_times': [t]}}, vault=vault)
            if frame['frame_url'] in seen:
                continue
            seen.add(frame['frame_url'])
            quality = cover_quality.assess(data, frame, vault)
            if quality['eligible']:
                candidates.append({**frame, 'label': ins.get('caption_short', ''), 'quality': quality,
                                   'is_best_frame': t in ins.get('best_frame_times', [])})
    # Brightest eligible frame within each clip; visual interest ranks clips.
    candidates.sort(key=lambda m: (not m['is_best_frame'], -m['score'], -m['quality']['mean_luminance'], m['clip_id']))
    # Give each clip one cover before reusing another frame from the same clip.
    ranks = {}
    ordered = []
    for frame in candidates:
        cid = frame['clip_id']
        rank = ranks.get(cid, 0)
        ordered.append((rank, frame))
        ranks[cid] = rank + 1
    ordered.sort(key=lambda row: row[0])
    yield from (frame for _, frame in ordered)


def collections(vault=VAULT, all_items=False):
    rows = flights(vault)
    meta = read(vault / 'manifest/trips_meta.json', {})
    records = {f['clip_id']: record(f['clip_id'], vault) for f in rows}
    groups = {}
    places = trip_groups(rows)
    saved_places = place_metadata(places, meta)
    for g in places:
        groups['place', g['id']] = (place_title(g, saved_places[g['id']], meta), g['flights'])
    for f in rows:
        ins = records[f['clip_id']].get('insight', {})
        month = str(f.get('date', ''))[:7]
        labels = [('month', month)] if re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month) else []
        labels += [('subject', s) for s in ins.get('subjects', [])]
        labels += [('shot', ins['shot_type'])] if ins.get('shot_type') else []
        for kind, label in labels:
            if label:
                key = (kind, normalized(label))
                title = (f'{MONTHS[int(label[5:7]) - 1]} {label[:4]}' if kind == 'month'
                         else SHOT_TITLES[label] if kind == 'shot' else label[:1].upper() + label[1:])
                groups.setdefault(key, (title, []))[1].append(f)
    result = []
    for (kind, key), (label, members) in sorted(groups.items()):
        ids = sorted({f['clip_id'] for f in members})
        covers = list(cover_candidates(ids, records, vault))
        if not covers:
            continue
        cover = covers[0]
        owner_cover = saved_places.get(key, {}).get('cover') if kind == 'place' else None
        owner = next((m for m in covers if m['clip_id'] == owner_cover), None)
        if owner:
            cover = {**owner, 'selection': 'owner'}
        members = {f['clip_id']: f for f in members}.values()
        duration = sum(f.get('duration_s', 0) or 0 for f in members)
        latest = max((str(f.get('date') or '') for f in members), default='')
        data = records[cover['clip_id']]
        short = data.get('insight', {}).get('caption_short') or trim_caption(data.get('summary', ''))
        result.append({'id': f'{kind}:{key}', 'kind': kind, 'label': label,
                       'subtitle': f"{len(ids)} {'clip' if len(ids) == 1 else 'clips'} · {int(duration) // 60} min {int(duration) % 60:02d} s",
                       'duration_s': duration, 'latest_date': latest, 'caption_short': short,
                       'clip_ids': ids, 'count': len(ids), 'cover': {**cover, 'caption_short': short}})
    # Stable size ranking, then recency. Reserve up to three slots per kind.
    result.sort(key=lambda c: c['latest_date'], reverse=True)
    result.sort(key=lambda c: -c['count'])
    if not all_items:
        eligible = [c for c in result if c['count'] >= 3]
        chosen = {c['id'] for kind in ('place', 'month', 'subject', 'shot')
                  for c in [c for c in eligible if c['kind'] == kind][:3]}
        for c in eligible:
            if len(chosen) >= 12:
                break
            chosen.add(c['id'])
        result = [c for c in eligible if c['id'] in chosen]
    # Reserve owner choices first. Keep the returned ranking unchanged.
    used, exhausted = set(), set()
    priority = sorted(result, key=lambda c: (c['cover']['selection'] != 'owner', c['kind'] != 'place'))
    for c in priority:
        candidates = cover_candidates(c['clip_ids'], records, vault)
        if c['cover']['selection'] == 'owner':
            candidates = iter([c['cover'], *candidates])
        cover = next((m for m in candidates if m['frame_url'] not in used), None)
        if cover is None:
            exhausted.add(c['id'])
            continue
        used.add(cover['frame_url'])
        data = records[cover['clip_id']]
        short = data.get('insight', {}).get('caption_short') or trim_caption(data.get('summary', ''))
        c.update(cover={**cover, 'caption_short': short}, caption_short=short)
    result = [c for c in result if c['id'] not in exhausted]
    result.sort(key=lambda c: ('place', 'month', 'subject', 'shot').index(c['kind']))
    for rank, item in enumerate(result, 1):
        item['rank'] = rank
    return {'collections': result}


def distinct_frames(frames, limit=6):
    frames = list(frames)
    seen, first, remaining = set(), [], []
    for frame in frames:
        if frame['clip_id'] in seen:
            remaining.append(frame)
        else:
            first.append(frame)
            seen.add(frame['clip_id'])
    selected = []
    for frame in first + remaining:
        if not frame.get('quality', {}).get('eligible'):
            continue
        if any(frame['clip_id'] == other['clip_id']
               and abs(frame['frame_time_s'] - other['frame_time_s']) < 20 for other in selected):
            continue
        selected.append(frame)
        if len(selected) == limit:
            break
    return selected


def property_media(prop, vault=VAULT):
    """Only linked clips can supply a property gallery. Recheck stored selections."""
    linked = prop.get('clips') if isinstance(prop.get('clips'), list) else []
    ids = list(dict.fromkeys(cid for cid in [prop.get('clip'), *linked] if valid_id(cid)))
    records = {cid: record(cid, vault) for cid in ids}
    gallery = distinct_frames(cover_candidates(ids, records, vault))
    from ai.owner_frames import property_cover
    return {**prop, 'gallery': gallery, 'gallery_n': len(gallery),
            'cover': property_cover(prop, records, vault)}


def summary_source(kind, identity, vault=VAULT):
    rows = flights(vault)
    groups = trip_groups(rows)
    group = next((g for g in groups if (g['id'] == identity if kind == 'trip'
                 else any(f['clip_id'] == identity for f in g['flights']))), None)
    meta = read(vault / 'manifest/trips_meta.json', {})
    place = place_title(group, place_metadata(groups, meta)[group['id']], meta) if group else ''
    if kind == 'flight':
        rows = [f for f in rows if f['clip_id'] == identity]
    else:
        rows = next((g['flights'] for g in trip_groups(rows) if g['id'] == identity), [])
    if not rows:
        raise KeyError(identity)
    moments, routes, evidence, highlights, segments = [], [], [], [], []
    for f in rows:
        cid = f['clip_id']
        data = evidence_record(record(cid, vault), vault)
        insight = data.get('insight', {})
        segments.extend({'clip_id': cid, **h} for h in segment_highlights(insight))
        if insight.get('highlight_segments'):
            frame = moment(cid, data, vault=vault, highlight=True)
            if frame['quality']['eligible']:
                highlights.append(frame)
        moments.extend(cover_candidates([cid], {cid: data}, vault))
        track = read(vault / 'tracks' / f'{cid}.flight.json', {})
        line = [[p['lon'], p['lat']] for p in track.get('points', [])[::4]
                if type(p.get('lon')) in (int, float) and type(p.get('lat')) in (int, float)
                and math.isfinite(p['lon']) and math.isfinite(p['lat'])]
        if line:
            routes.append({'clip_id': cid, 'coordinates': line})
        evidence.append({'caption': insight.get('caption', data.get('summary', '')),
                         'tags': insight.get('tags', data.get('tags', [])),
                         'subjects': insight.get('subjects', []), 'light': insight.get('light_notes', '')})
    moments.sort(key=lambda m: (not m['is_best_frame'], -m['score'], -m['quality']['mean_luminance'], m['clip_id']))
    unique = list({(m['clip_id'], m['frame_time_s']): m for m in reversed(moments)}.values())[::-1]
    stats = [f.get('stats', {}) for f in rows]
    distance = [s['distance_m'] for s in stats if type(s.get('distance_m')) in (int, float) and math.isfinite(s['distance_m'])]
    alt = [s['max_rel_alt_m'] for s in stats if type(s.get('max_rel_alt_m')) in (int, float) and math.isfinite(s['max_rel_alt_m'])]
    result = {'id': identity, 'kind': kind, 'suggested': True,
              'clip_ids': [f['clip_id'] for f in rows],
              'distance_m': round(sum(distance), 1) if distance else None,
              'max_altitude_m': max(alt) if alt else None,
              'highlights': segments, 'synthetic': not bool(segments), 'cover': unique[0] if unique else None,
              'best_moment': max(highlights, key=lambda m: (m['score'], m['time_s'] >= 1), default=None)}
    if kind == 'trip':
        result.update(route=routes, best_frames=distinct_frames(unique))
    return result, {'version': 3, 'data': result, 'place': place,
                    'distance': format_distance(result['distance_m']), 'evidence': evidence}


def format_distance(meters):
    if meters is None or meters < 0:
        return ''
    return f'{meters / 1000:.1f} km'.replace('.', ',') if meters >= 1000 else f'{meters:.0f} m'


SUMMARY_INTERNALS = re.compile(
    r'\b(?:DJI\w*|(?:clip|recon|scene)[_-]\w+|score|scores|puntuaci[oó]n|puntaje|'
    r'sugerid[oa]s?|selecci[oó]n|IA|inteligencia artificial|clip(?:s)?|frame(?:s)?)\b|\w+_\w+', re.I)


def safe_summary_text(text, source):
    return (not SUMMARY_INTERNALS.search(text) and not PRAISE.search(text)
            and not any(cid.casefold() in text.casefold() for cid in source['data']['clip_ids']))


def valid_summary(text, source):
    if not isinstance(text, str) or not safe_summary_text(text, source):
        return False
    if re.search(r'\bse observa[n]?\b', text, re.I):
        return False
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    if len(sentences) != 2 or any(not s.endswith('.') or not 2 <= len(s.split()) <= 28 for s in sentences):
        return False
    distance = source['distance']
    # The only allowed number is the known distance, already formatted for Spanish.
    return ((not distance or text.count(distance) == 1)
            and (not distance or any(distance in s and re.search(r'\b(recorr\w*|ruta|distancia)\b', s, re.I)
                                     for s in sentences))
            and not re.search(r'\d', text.replace(distance, '') if distance else text))


def template_summary(source):
    def fragment(value):
        return (isinstance(value, str) and 0 < len(value.split()) <= 5
                and not re.search(r'[\d.!?\n_]', value) and safe_summary_text(value, source))

    subjects = []
    for evidence in source['evidence']:
        for subject in evidence['subjects'] or evidence['tags']:
            if fragment(subject) and subject.casefold() not in subjects:
                subjects.append(subject.casefold())
    subject = ' y '.join(subjects[:2]) or 'el paisaje'
    place = source['place'] if fragment(source['place']) else ''
    location = f' en {place}' if place else ''
    distance = source['distance']
    first = f'El recorrido{location} suma {distance}.' if distance else f'El vuelo muestra {subject}{location}.'
    notes = normalized(' '.join(e['light'] for e in source['evidence']))
    light = next((label for pattern, label in [
        (r'atardecer', 'la luz del atardecer'), (r'amanecer', 'la luz del amanecer'),
        (r'dorada|calida', 'luz cálida'), (r'suave|difusa|nublado', 'luz suave'),
        (r'sol directo|luz directa', 'luz directa'), (r'natural|diurna', 'luz natural')]
        if re.search(pattern, notes)), '')
    second = f'Las tomas muestran {subject}' + (f' con {light}.' if light else ' desde el aire.')
    if not distance:
        second = f'La escena se ve con {light}.' if light else 'Las tomas reúnen distintas vistas del recorrido.'
    return first + ' ' + second


def summary_path(kind, identity, vault):
    return vault / 'ai' / 'summaries' / f'{kind}-{digest(identity)[:24]}.json'


def legacy_summary_hash(result, vault):
    """Keep the running server's cache key valid during the worktree rollout."""
    rows = {f['clip_id']: f for f in flights(vault)}
    evidence = [{'clip_id': cid, 'caption': record(cid, vault).get('summary', ''),
                 'stats': rows[cid].get('stats', {})} for cid in result['clip_ids']]
    return digest({'data': result, 'evidence': evidence})


def get_summary(kind, identity, vault=VAULT):
    result, source = summary_source(kind, identity, vault)
    cached = read(summary_path(kind, identity, vault), {})
    ready = cached.get('summary_hash', cached.get('source_hash')) == digest(source) and valid_summary(cached.get('summary'), source)
    return {**result, 'status': 'ready' if ready else 'pending',
            'summary': cached['summary'] if ready else template_summary(source)}


def cache_summary(kind, identity, keys, vault=VAULT, *, deterministic=False):
    result, source = summary_source(kind, identity, vault)
    target = summary_path(kind, identity, vault)
    cached = read(target, {})
    fingerprint = digest(source)
    if cached.get('summary_hash', cached.get('source_hash')) == fingerprint and valid_summary(cached.get('summary'), source):
        if 'summary_hash' not in cached:
            atomic_write_json(target, {**cached, 'summary_hash': fingerprint,
                                      'source_hash': legacy_summary_hash(result, vault)}, allow_nan=False)
        return {'cached': True, 'usage': {}}
    summary, usage, origin = template_summary(source), {}, 'template'
    if not deterministic:
        try:
            raw, usage = router.summary_text(source, keys)
            sentences = json.loads(raw)['sentences']
            if (isinstance(sentences, list) and len(sentences) == 2
                    and all(isinstance(s, str) for s in sentences)
                    and valid_summary(' '.join(sentences), source)):
                summary, origin = ' '.join(sentences), 'deepseek'
        except Exception:
            pass  # Invalid JSON and provider failures use the same local fallback.
    if not valid_summary(summary, source):
        raise ValueError('invalid summary template')
    target.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(target, {'source_hash': legacy_summary_hash(result, vault), 'summary_hash': fingerprint,
                              'summary': summary, 'origin': origin,
                              'usage': usage}, allow_nan=False)
    return {'cached': False, 'usage': usage, 'origin': origin}
