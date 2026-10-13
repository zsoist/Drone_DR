"""Repair stored AI output with bounded writes, backups, and an API cost report."""
import argparse
import json
from pathlib import Path

import insights
import property_copy
from fsutil import atomic_write_json


def stored_shape(data):
    result = {**data}
    if data.get('insight'):
        result['insight'] = dict(data['insight'])
        result['caption_short'] = result['insight'].pop('caption_short')
    return result


def backfill(limit, property_ids, backup, dry_run=False, vault=insights.VAULT, keys=None):
    if not 1 <= limit <= 1000 or len(property_ids) > limit:
        raise ValueError('limit must be 1–1000 and must include all property IDs')
    if any(not insights.valid_id(slug) for slug in property_ids):
        raise ValueError('invalid property ID')
    backup = Path(backup)
    rows = insights.flights(vault)
    selected = []
    for flight in rows:
        cid = flight['clip_id']
        target = vault / 'ai' / f'{cid}.json'
        raw = insights.read(target, {})
        data = insights.public_record(cid, vault)
        if raw and raw != stored_shape(data):
            selected.append((cid, target, raw, data))
    selected = selected[:limit]
    properties = []
    for slug in dict.fromkeys(property_ids):
        target = vault / 'properties' / f'{slug}.json'
        prop = insights.read(target, {})
        if not prop:
            raise ValueError(f'unknown property: {slug}')
        if not property_copy.validate_copy(prop.get('descripcion')):
            properties.append((target, prop))
    candidates = [('flight', f['clip_id']) for f in rows]
    candidates += [('trip', g['id']) for g in insights.trip_groups(rows)]
    summaries = [(kind, identity) for kind, identity in candidates
                 if insights.summary_path(kind, identity, vault).is_file()
                 and insights.get_summary(kind, identity, vault)['status'] != 'ready'][:limit]
    report = {'dry_run': dry_run, 'limit': limit, 'clips_selected': len(selected),
              'properties_selected': len(properties), 'clips_written': 0, 'properties_written': 0,
              'summaries_selected': len(summaries), 'summaries_written': 0,
              'embedding_calls': 0, 'vision_calls': 0, 'text_calls': 0,
              'estimated_embedding_usd': 0, 'failures': [], 'clip_ids': [x[0] for x in selected],
              'note': 'Embedding cost uses estimated tokens and the configured rate. Failed calls have unknown cost.'}
    if dry_run:
        return report

    def preserve(target):
        dest = backup / target.relative_to(vault)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            dest.write_bytes(target.read_bytes())

    for cid, target, raw, data in selected:
        try:
            if raw.get('insight') and not data.get('insight'):
                raise ValueError('invalid insight needs review')
            if data.get('insight') and not insights.has_embedding(data):
                report['embedding_calls'] += 1
                data = insights.refresh_embedding(data, keys if keys is not None else insights.load_keys())
                report['estimated_embedding_usd'] += data['embedding']['estimated_usd']
            # Do not overwrite a concurrent ingest or an owner edit.
            if insights.read(target) != raw:
                raise ValueError('source changed during repair')
            preserve(target)
            if data.get('insight'):
                insights.save_record(data, vault)
            else:
                atomic_write_json(target, data, allow_nan=False)
            report['clips_written'] += 1
        except Exception as exc:
            report['failures'].append({'clip_id': cid, 'error': type(exc).__name__})
    for target, prop in properties:
        if insights.read(target) != prop:
            report['failures'].append({'property_id': target.stem, 'error': 'source changed'})
            continue
        preserve(target)
        atomic_write_json(target, {**prop, 'descripcion': property_copy.template(prop),
                                   'descripcion_source': 'ai_template'}, ensure_ascii=False)
        report['properties_written'] += 1
    for kind, identity in summaries:
        target = insights.summary_path(kind, identity, vault)
        if target.is_file() and insights.get_summary(kind, identity, vault)['status'] != 'ready':
            preserve(target)
            insights.cache_summary(kind, identity, {}, vault, deterministic=True)
            report['summaries_written'] += 1
    report['estimated_embedding_usd'] = round(report['estimated_embedding_usd'], 8)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, required=True)
    parser.add_argument('--property-id', action='append', default=[])
    parser.add_argument('--backup-dir', type=Path, required=True)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    result = backfill(args.limit, args.property_id, args.backup_dir, args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(bool(result['failures']))
