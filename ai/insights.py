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
    from . import router
    from .insight_schema import INSIGHT_SCHEMA, validate_insight
except ImportError:
    import router
    from insight_schema import INSIGHT_SCHEMA, validate_insight


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
            validate_insight(value['insight'], value['duration_s'], value['sampled_frame_times'])
        except (KeyError, TypeError, ValueError):
            value.pop('insight', None)
            value.pop('embedding', None)
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
              'Describe solo evidencia visible. No inventes lugares. Son sugerencias, no decisiones del dueño. '
              'Con frames aislados no puedes confirmar estabilidad entre frames: marca solo problemas visibles. '
              'sobreexpuesto significa altas luces blancas quemadas, nunca una escena oscura. '
              'horizonte requiere un horizonte visible inclinado; no aplica a una toma cenital sin horizonte. '
              'Si ninguna bandera tiene evidencia clara, devuelve quality_flags vacío. '
              'Sugiere un preset existente y exposición EV conservadora.')
    raw, usage = router.gemini_insight(prompt, sample, keys, INSIGHT_SCHEMA)
    insight = validate_insight(json.loads(raw), duration, times)
    content = embedding_text(insight)
    vector = unit_vector(router.embed_text(content, keys), router.EMBEDDING_DIMENSIONS)
    usage['estimated_usd'] = round((usage['input_tokens'] * .30 + usage['output_tokens'] * 2.50) / 1e6, 8)
    # embedContent does not return usage; this is an explicit estimate, not measured tokens.
    embedding = {'model': router.EMBEDDING_MODEL, 'dimensions': len(vector), 'vector': vector,
                 'source_hash': digest(content), 'estimated_tokens': math.ceil(len(content) / 3)}
    embedding['estimated_usd'] = round(embedding['estimated_tokens'] * .15 / 1e6, 8)
    segments = insight['highlight_segments']
    result = {'schema_version': 1, 'clip_id': cid, 'suggested': True, 'insight': insight,
              'duration_s': duration, 'sampled_frame_times': times, 'frames_analyzed': len(sample),
              'embedding': embedding, 'usage': usage,
              # Legacy fields keep cards, Studio and build_index compatible.
              'summary': insight['caption'], 'tags': insight['tags'], 'subjects': insight['subjects'],
              'scene_type': insight['scene_type'], 'camera_motion': insight['shot_type'],
              'highlights': [{'t': s['start'], 'reason': s['reason'], 'type': insight['shot_type']} for s in segments],
              'best_thumbnail_t': insight['best_frame_times'][0],
              'travel_score': round(max(s['score'] for s in segments) * 10, 1)}
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
    atomic_write_json(target, data, allow_nan=False)


def get_insight(cid, vault=VAULT):
    data = record(cid, vault)
    try:
        validate_insight(data['insight'], data['duration_s'], data['sampled_frame_times'])
    except (KeyError, TypeError, ValueError):
        return {'clip_id': cid, 'status': 'pending', 'suggested': True, 'insight': None}
    return {'clip_id': cid, 'status': 'ready', 'suggested': True, 'insight': data['insight']}


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c))


def tokens(text):
    return set(re.findall(r'\w+', normalized(text)))


def moment(cid, data, query='', vault=VAULT):
    insight = data.get('insight', {})
    segments = insight.get('highlight_segments', [])
    selected = max(segments, key=lambda s: (len(tokens(query) & tokens(s['reason'])), s['score']), default=None)
    best_times = insight.get('best_frame_times') or [data.get('best_thumbnail_t', 0)]
    t = selected['start'] if selected and query else best_times[0]
    available = []
    for p in (vault / 'frames' / cid).glob('f_*.jpg'):
        if re.fullmatch(r'f_\d+', p.stem):
            available.append(((int(p.stem[2:]) - 1) * 2, p.name))
    frame_time, name = min(available, key=lambda row: abs(row[0] - t)) if available else (None, None)
    return {'clip_id': cid, 'time_s': t, 'frame_time_s': frame_time,
            'frame_url': f'/data/frames/{cid}/{name}' if name else f'/data/thumbs/{cid}.jpg',
            'score': selected['score'] if selected else (data.get('travel_score') or 0) / 10,
            'selection': 'ai' if insight or data.get('travel_score') else 'sample'}


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
    rows = [(f, record(f['clip_id'], vault)) for f in flights(vault)]
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
            results.append({'clip_id': f['clip_id'], 'score': round(score, 6), 'mode': mode,
                            'caption': caption, 'tags': tags,
                            'matched_moment': moment(f['clip_id'], data, q, vault)})
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


def collections(vault=VAULT):
    rows = flights(vault)
    meta = read(vault / 'manifest/trips_meta.json', {})
    records = {f['clip_id']: record(f['clip_id'], vault) for f in rows}
    groups = {}
    for g in trip_groups(rows):
        groups['place', g['id']] = (meta.get(g['id'], {}).get('name') or f"Zona {g['id']}", g['flights'])
    for f in rows:
        ins = records[f['clip_id']].get('insight', {})
        labels = [('month', str(f.get('date', ''))[:7])]
        labels += [('subject', s) for s in ins.get('subjects', [])]
        labels += [('shot_type', ins['shot_type'])] if ins.get('shot_type') else []
        for kind, label in labels:
            if label:
                key = (kind, normalized(label))
                groups.setdefault(key, (label, []))[1].append(f)
    result = []
    for (kind, key), (label, members) in sorted(groups.items()):
        ids = sorted({f['clip_id'] for f in members})
        covers = [moment(cid, records[cid], vault=vault) for cid in ids]
        cover = max(covers, key=lambda m: (m['score'], m['clip_id']))
        owner_cover = meta.get(key, {}).get('cover') if kind == 'place' else None
        if owner_cover in ids:
            cover = {**next(m for m in covers if m['clip_id'] == owner_cover), 'selection': 'owner'}
        result.append({'id': f'{kind}:{key}', 'kind': kind, 'label': label,
                       'clip_ids': ids, 'count': len(ids), 'cover': cover})
    return {'collections': result}


def summary_source(kind, identity, vault=VAULT):
    rows = flights(vault)
    if kind == 'flight':
        rows = [f for f in rows if f['clip_id'] == identity]
    else:
        rows = next((g['flights'] for g in trip_groups(rows) if g['id'] == identity), [])
    if not rows:
        raise KeyError(identity)
    moments, routes, evidence = [], [], []
    for f in rows:
        cid = f['clip_id']
        data = record(cid, vault)
        insight = data.get('insight', {})
        moments.append(moment(cid, data, vault=vault))
        for t in insight.get('best_frame_times', []):
            moments.append(moment(cid, {'best_thumbnail_t': t, 'travel_score': data.get('travel_score', 0)}, vault=vault))
        if kind == 'trip':
            chosen = set(insight.get('best_frame_times', []))
            for t in data.get('sampled_frame_times', []):
                if t not in chosen:
                    extra = moment(cid, {'best_thumbnail_t': t}, vault=vault)
                    extra['selection'] = 'sample'
                    moments.append(extra)
        track = read(vault / 'tracks' / f'{cid}.flight.json', {})
        line = [[p['lon'], p['lat']] for p in track.get('points', [])[::4]
                if type(p.get('lon')) in (int, float) and type(p.get('lat')) in (int, float)
                and math.isfinite(p['lon']) and math.isfinite(p['lat'])]
        if line:
            routes.append({'clip_id': cid, 'coordinates': line})
        evidence.append({'clip_id': cid, 'caption': data.get('summary', ''), 'stats': f.get('stats', {})})
    moments.sort(key=lambda m: (-m['score'], m['clip_id'], m['time_s']))
    unique = list({(m['clip_id'], m['frame_time_s']): m for m in reversed(moments)}.values())[::-1]
    stats = [f.get('stats', {}) for f in rows]
    distance = [s['distance_m'] for s in stats if type(s.get('distance_m')) in (int, float) and math.isfinite(s['distance_m'])]
    alt = [s['max_rel_alt_m'] for s in stats if type(s.get('max_rel_alt_m')) in (int, float) and math.isfinite(s['max_rel_alt_m'])]
    result = {'id': identity, 'kind': kind, 'suggested': True,
              'clip_ids': [f['clip_id'] for f in rows],
              'distance_m': round(sum(distance), 1) if distance else None,
              'max_altitude_m': max(alt) if alt else None,
              'best_moment': unique[0] if unique else None}
    if kind == 'trip':
        result.update(route=routes, best_frames=unique[:6])
    return result, {'data': result, 'evidence': evidence}


def summary_path(kind, identity, vault):
    return vault / 'ai' / 'summaries' / f'{kind}-{digest(identity)[:24]}.json'


def get_summary(kind, identity, vault=VAULT):
    result, source = summary_source(kind, identity, vault)
    cached = read(summary_path(kind, identity, vault), {})
    ready = cached.get('source_hash') == digest(source) and isinstance(cached.get('summary'), str)
    return {**result, 'status': 'ready' if ready else 'pending',
            'summary': cached['summary'] if ready else None}


def cache_summary(kind, identity, keys, vault=VAULT):
    result, source = summary_source(kind, identity, vault)
    target = summary_path(kind, identity, vault)
    cached = read(target, {})
    fingerprint = digest(source)
    if cached.get('source_hash') == fingerprint and isinstance(cached.get('summary'), str):
        return {'cached': True, 'usage': {}}
    raw, usage = router.summary_text(source, keys)
    value = json.loads(raw)
    sentences = value.get('sentences') if isinstance(value, dict) else None
    if (not isinstance(sentences, list) or not 1 <= len(sentences) <= 6
            or any(not isinstance(s, str) or not 1 <= len(s.strip()) <= 500 for s in sentences)):
        raise ValueError('summary must have two sentences')
    # Normalize packed or extra sentences without splitting decimal measurements.
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÜÑ¿¡])', ' '.join(sentences))
    if len(sentences) < 2:
        raise ValueError('summary must have two sentences')
    sentences = sentences[:2]
    target.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(target, {'source_hash': fingerprint, 'summary': ' '.join(sentences),
                              'usage': usage}, allow_nan=False)
    return {'cached': False, 'usage': usage}
