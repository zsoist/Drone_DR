"""Rebuild frame selections and local highlights with bounded writes and backups."""
import argparse
import json
from pathlib import Path

import insights
import property_copy
from fsutil import atomic_write_json


def backfill(limit, backup, vault=insights.VAULT, dry_run=False, *, highlights_only=False):
    if not 1 <= limit <= 1000:
        raise ValueError('limit must be 1–1000')
    backup = Path(backup)
    report = {'dry_run': dry_run, 'limit': limit, 'clips_written': 0, 'properties_written': 0,
              'summaries_written': 0, 'frames_scored': 0, 'highlights': 0,
              'provider_calls': 0, 'estimated_usd': 0, 'galleries': {}, 'failures': []}

    def write(target, original, updated):
        if updated == original or dry_run:
            return False
        if insights.read(target, {}) != original:
            raise ValueError('source changed during repair')
        saved = backup / target.relative_to(vault)
        saved.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not saved.exists():
            saved.write_bytes(target.read_bytes())
        target.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_json(target, updated, ensure_ascii=False, allow_nan=False)
        return True

    rows = insights.flights(vault)[:limit]
    for flight in rows:
        cid = flight['clip_id']
        target = vault / 'ai' / f'{cid}.json'
        original = insights.read(target, {})
        if not original:
            continue
        try:
            data = insights.public_record(cid, vault)
            # The provider insight remains immutable input for future local repairs.
            fields = {k: data.get(k) for k in ('highlights', 'synthetic', 'owner_highlights',
                                             'cover', 'highlight_evidence')}
            if highlights_only:
                fields.pop('cover', None)
            report['frames_scored'] += len((data.get('highlight_evidence') or {}).get('frames_scored', []))
            report['highlights'] += len(data['highlights'])
            report['clips_written'] += write(target, original, {**original, **fields})
        except (OSError, ValueError, TypeError) as exc:
            report['failures'].append({'clip_id': cid, 'error': type(exc).__name__})
    if highlights_only:
        return report
    for target in sorted((vault / 'properties').glob('*.json'))[:limit]:
        original = insights.read(target, {})
        prop = insights.property_media(original, vault)
        if prop.get('descripcion_source', '').startswith('ai'):
            prop['descripcion'] = property_copy.template(prop, property_copy.visual_evidence(prop, vault))
        report['galleries'][target.stem] = {'frames': len(prop['gallery']),
                                          'insufficient_frames': len(prop['gallery']) < 4}
        report['properties_written'] += write(target, original, prop)
    candidates = [('flight', row['clip_id']) for row in rows]
    candidates += [('trip', group['id']) for group in insights.trip_groups(insights.flights(vault))]
    for kind, identity in candidates[:limit]:
        result, source = insights.summary_source(kind, identity, vault)
        target = insights.summary_path(kind, identity, vault)
        original = insights.read(target, {})
        updated = {'source_hash': insights.digest(source), 'summary_hash': insights.digest(source),
                   'summary': insights.template_summary(source), 'origin': 'template', 'usage': {}}
        report['summaries_written'] += write(target, original, updated)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', required=True, type=int)
    parser.add_argument('--backup-dir', required=True, type=Path)
    parser.add_argument('--highlights-only', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    report = backfill(args.limit, args.backup_dir, dry_run=args.dry_run, highlights_only=args.highlights_only)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(bool(report['failures']))
