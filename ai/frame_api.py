"""One read-only frame policy for JSON responses and legacy image URLs."""
import re
from urllib.parse import unquote, urlsplit

from . import cover_quality, insights


def media_frame(url, vault, records=None, *, featured=True):
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
    if featured and not frame['quality']['eligible']:
        frame['frame_url'] = None
    return frame


def thumbnail_url(cid, vault, records=None):
    """Prefer an approved frame of this clip, then its private archive thumbnail."""
    records = records if records is not None else {}
    if cid not in records:
        records[cid] = insights.record(cid, vault)
    data = records[cid]
    cover = next(insights.cover_candidates([cid], records, vault), None)
    if cover:
        return cover['frame_url']
    normal = f'/data/thumbs/{cid}.jpg'
    frames = sorted(p for p in (vault / 'frames' / cid).glob('f_*.jpg')
                    if re.fullmatch(r'f_\d+\.jpg', p.name))
    if not frames:
        return normal
    # Ingest takes the normal thumbnail at 25% of the clip. Clip-level text
    # evidence cannot locate the sign; use a different sampled time when possible.
    meta = insights.read(vault / 'manifest' / f'{cid}.json', {})
    t = (meta.get('duration_s') or data.get('duration_s') or 0) * .25
    original = min(frames, key=lambda p: abs((int(p.stem[2:]) - 1) * 2 - t))
    privacy = {'text_or_sign', 'text', 'sign', 'phone'}
    if privacy.intersection(cover_quality.evidence_reasons(data)):
        alternate = next((p for p in frames if p != original), None)
        if alternate:
            return f'/data/frames/{cid}/{alternate.name}'
    return normal if (vault / 'thumbs' / f'{cid}.jpg').is_file() else f'/data/frames/{cid}/{original.name}'


def project(payload, vault):
    """Recheck cached URLs. Featured fields stay strict; archive thumbnails keep their own policy."""
    records, thumbnails = {}, {}

    def visit(value, *, archive=False):
        if isinstance(value, list):
            rows = [visit(item, archive=archive) for item in value]
            return [item for original, item in zip(value, rows) if (item is not None or original is None) and not (
                not archive and isinstance(item, dict) and isinstance(item.get('quality'), dict)
                and item['quality'].get('status') == 'rejected'
                and 'frame_url' in item)]
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                if key in ('thumbnail_url', 'thumb_url') and insights.valid_id(value.get('clip_id')):
                    continue
                frame = media_frame(item, vault, records, featured=not archive)
                if frame is not None:
                    result[key] = frame['frame_url']
                    result['quality' if key == 'frame_url' else key + '_quality'] = frame['quality']
                elif key != 'quality' or 'quality' not in result:
                    result[key] = visit(item, archive=key == 'frames')
            if insights.valid_id(value.get('clip_id')):
                cid = value['clip_id']
                if cid not in thumbnails:
                    thumbnails[cid] = thumbnail_url(cid, vault, records)
                result['thumbnail_url'] = thumbnails[cid]
                if archive and result.get('frame_url') and not {'text_or_sign', 'text', 'sign', 'phone'}.intersection(
                        result.get('quality', {}).get('reasons', [])):
                    result['thumbnail_url'] = result['frame_url']
                if 'thumb_url' in value:
                    result['thumb_url'] = result['thumbnail_url']
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
