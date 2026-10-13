"""Select readable frames from the owner's clips without a public-feature filter."""
import re
from functools import lru_cache

from PIL import Image

from . import cover_quality


@lru_cache(maxsize=8192)
def frame_stats(path, mtime_ns, size):
    try:
        with Image.open(path) as image:
            width, height = image.size
        return width, height, cover_quality._luminance(path, mtime_ns, size)
    except (OSError, ValueError):
        return 0, 0, None


def frames(cid, vault, min_width=0):
    if not re.fullmatch(r'[\w-]{1,120}', cid or '', re.ASCII):
        return
    for path in sorted((vault / 'frames' / cid).glob('f_*.jpg')):
        if not re.fullmatch(r'f_\d+\.jpg', path.name):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        width, height, luma = frame_stats(str(path), stat.st_mtime_ns, stat.st_size)
        if width < min_width or luma is None:
            continue
        yield {'clip_id': cid, 'frame_url': f'/data/frames/{cid}/{path.name}',
               'frame_time_s': (int(path.stem[2:]) - 1) * 2,
               'width': width, 'height': height, 'mean_luminance': luma}


def property_cover(prop, records, vault):
    # A saved selection belongs to the owner, including one that predates this default.
    linked = [prop.get('clip'), *(prop.get('clips') or [])]
    cover = prop.get('cover')
    if isinstance(cover, dict) and cover.get('clip_id') in linked:
        for frame in frames(cover['clip_id'], vault, 1600):
            if frame['frame_url'].lstrip('/') == str(cover.get('frame_url', '')).lstrip('/'):
                return {**cover, **frame}
    if cover:
        return None  # A missing or small owner cover needs an explicit replacement.
    candidates = []
    landscape = re.compile(r'valle|monta[ñn]a|panor[aá]mic|plano (?:general|amplio)|wide|panorama', re.I)
    for cid, data in records.items():
        ins = data.get('insight', {})
        for frame in frames(cid, vault, 1600):
            if frame['mean_luminance'] < cover_quality.MIN_LUMINANCE:
                continue
            t = frame['frame_time_s']
            notes = [s for s in ins.get('highlight_segments', []) if s['start'] <= t < s['end']]
            local = max((len(landscape.findall(s['reason'])) for s in notes), default=0)
            wide = int(ins.get('shot_type') in ('wide', 'panorama', 'panorámica'))
            context = int(bool(landscape.search(ins.get('caption', ''))))
            candidates.append(((local, wide, context, frame['mean_luminance']), frame))
    if not candidates:
        return None
    frame = max(candidates, key=lambda item: item[0])[1]
    return {**frame, 'source': 'automatic', 'selection': 'suggested'}
