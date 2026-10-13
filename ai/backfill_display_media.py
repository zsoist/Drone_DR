"""Regenerate local moment labels and missing property covers with backups. No API calls."""
import argparse
import json
import subprocess
from pathlib import Path

from ai import highlight_peaks, insights
from pipeline.fsutil import atomic_write_bytes, atomic_write_json


def repair(vault, backup, property_id=None, frame_time=None):
    report = {'clips_written': 0, 'properties_written': 0, 'cost_usd': 0, 'labels': 0}

    def preserve(path):
        dest = backup / path.relative_to(vault)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and not dest.exists():
            dest.write_bytes(path.read_bytes())

    if property_id:
        if not insights.valid_id(property_id):
            raise ValueError('invalid property ID')
        target = vault / 'properties' / f'{property_id}.json'
        prop = insights.read(target)
        if not prop:
            raise ValueError('unknown property')
        # Any existing owner selection takes precedence over a generated default.
        if not prop.get('cover'):
            if frame_time is not None:
                cid = prop['clip']
                flight = next(f for f in insights.flights(vault) if f['clip_id'] == cid)
                if frame_time < 0 or frame_time >= flight['duration_s'] or frame_time % 2:
                    raise ValueError('frame time must match the stored two-second grid')
                raw = (vault / 'raw' / flight['raw_rel']).resolve()
                if not raw.is_relative_to((vault / 'raw').resolve()):
                    raise ValueError('invalid original path')
                width = int(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                    '-show_entries', 'stream=width', '-of', 'csv=p=0', str(raw)], text=True).strip())
                if width < 1600:
                    raise ValueError('original is below the required cover resolution')
                frame = vault / 'frames' / cid / f'f_{frame_time // 2 + 1:04d}.jpg'
                preserve(frame)
                staged = backup / 'selected-cover.jpg'
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(frame_time), '-i', str(raw),
                    '-frames:v', '1', '-vf', f'scale={min(width, 1920)}:-2', '-q:v', '2', str(staged)], check=True)
                atomic_write_bytes(frame, staged.read_bytes())
            cover = insights.property_media(prop, vault)['cover']
            if not cover:
                raise ValueError('no readable full-resolution property cover')
            if insights.read(target) != prop:
                raise ValueError('property changed during repair')
            preserve(target)
            atomic_write_json(target, {**prop, 'cover': cover}, ensure_ascii=False)
            report['properties_written'] += 1
            report['cover'] = cover
    for flight in insights.flights(vault):
        cid = flight['clip_id']
        target = vault / 'ai' / f'{cid}.json'
        original = insights.read(target)
        data = insights.record(cid, vault)
        if not data.get('insight'):
            continue
        evidence = highlight_peaks.derive(data, vault)
        labels = [s['reason'] for s in evidence['segments']]
        if len(labels) != len(set(s.casefold() for s in labels)) or any(len(s) > 40 for s in labels):
            raise ValueError(f'invalid labels: {cid}')
        updated = {**original, 'highlight_evidence': evidence,
                   'highlights': [h for h in original.get('highlights', []) if h.get('type') == 'manual']
                   + insights.segment_highlights({**data['insight'], 'highlight_segments': evidence['segments']})}
        if original != updated:
            if insights.read(target) != original:
                raise ValueError(f'clip changed during repair: {cid}')
            preserve(target)
            atomic_write_json(target, updated, ensure_ascii=False)
            report['clips_written'] += 1
        report['labels'] += len(labels)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault', type=Path, required=True)
    parser.add_argument('--backup-dir', type=Path, required=True)
    parser.add_argument('--property-id')
    parser.add_argument('--frame-time', type=int)
    args = parser.parse_args()
    print(json.dumps(repair(args.vault, args.backup_dir, args.property_id, args.frame_time), ensure_ascii=False, indent=2))
