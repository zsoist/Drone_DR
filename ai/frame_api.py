"""One read-only frame policy for JSON responses and legacy image URLs."""
import re
from urllib.parse import unquote, urlsplit

from . import cover_quality, insights


def media_frame(url, vault, records=None):
    """Return None for non-frame URLs, and an assessed frame for known media URLs."""
    if not isinstance(url, str):
        return None
    path = unquote(urlsplit(url).path).lstrip('/')
    match = re.fullmatch(r'data/(?:frames/([A-Za-z0-9_-]{1,120})/(f_\d+\.jpg)|thumbs/([A-Za-z0-9_-]{1,120})\.jpg)', path, re.I)
    if not match:
        return None
    cid, name, thumb = match.groups()
    cid = cid or thumb
    records = records if records is not None else {}
    if cid not in records:
        records[cid] = insights.record(cid, vault)
    data = records[cid]
    if thumb:
        cover = next(insights.cover_candidates([cid], records, vault), None)
        if not cover:
            meta = insights.read(vault / 'models' / cid / 'meta.json', {})
            ids = [source for source in meta.get('sources', []) if insights.valid_id(source)]
            for source in ids:
                if source not in records:
                    records[source] = insights.record(source, vault)
            cover = next(insights.cover_candidates(ids, records, vault), None)
        if cover:
            return cover
    t = (int(name[2:-4]) - 1) * 2 if name else None
    frame = {'clip_id': cid, 'frame_time_s': t, 'time_s': t, 'frame_url': '/' + path}
    frame['quality'] = cover_quality.assess(data, frame, vault)
    if not frame['quality']['eligible']:
        frame['frame_url'] = None
    return frame


def project(payload, vault):
    """Recheck cached URLs. No writes, provider calls, or unfiltered fallback images."""
    records = {}

    def visit(value):
        if isinstance(value, list):
            rows = [visit(item) for item in value]
            return [item for original, item in zip(value, rows) if (item is not None or original is None) and not (
                isinstance(item, dict) and isinstance(item.get('quality'), dict)
                and item['quality'].get('status') == 'rejected'
                and 'frame_url' in item)]
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                frame = media_frame(item, vault, records)
                if frame is not None:
                    result[key] = frame['frame_url']
                    result['quality' if key == 'frame_url' else key + '_quality'] = frame['quality']
                elif key != 'quality' or 'quality' not in result:
                    result[key] = visit(item)
            # Mundo reads scene manifests directly, including those with no poster.
            if isinstance(value.get('assets'), dict) and insights.valid_id(value.get('clip_id')):
                frame = media_frame(f"/data/thumbs/{value['clip_id']}.jpg", vault, records)
                result['assets']['poster'] = frame['frame_url']
                result['assets']['poster_quality'] = frame['quality']
                result['cover'] = frame if frame['quality']['eligible'] else None
            return result
        frame = media_frame(value, vault, records)
        return frame['frame_url'] if frame else value

    return visit(payload)
