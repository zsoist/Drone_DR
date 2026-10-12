"""Bounded visual AI backfill. Dry run performs no API calls or writes."""
import argparse
import json
import sys
import insights
from router import load_keys


def backfill(limit, dry_run=False, vault=insights.VAULT, keys=None, force=False,
             clip_ids=None, attempts=1):
    if not 1 <= limit <= 1000 or not 1 <= attempts <= 2:
        raise ValueError('limit must be 1–1000; attempts must be 1–2')
    rows = insights.flights(vault)
    if clip_ids and (set(clip_ids) - {f['clip_id'] for f in rows}):
        raise ValueError('unknown clip id')
    selected = []
    for f in rows:
        cid = f['clip_id']
        if clip_ids and cid not in clip_ids:
            continue
        data = insights.record(cid, vault)
        complete = (insights.has_embedding(data) and insights.valid_short(data.get('caption_short')))
        if not force and complete:
            continue
        if data.get('insight') or list((vault / 'frames' / cid).glob('f_*.jpg')):
            selected.append(f)
    selected = selected[:limit]
    ids = [f['clip_id'] for f in selected]
    trips = [g['id'] for g in insights.trip_groups(rows) if any(f['clip_id'] in ids for f in g['flights'])]
    print(json.dumps({'dry_run': dry_run, 'clip_ids': ids, 'trip_ids': trips,
                      'attempts': attempts, 'force': force,
                      'estimated_usd': round(len(ids) * .005 * attempts + len(trips) * .002, 4),
                      'note': 'Planning estimate, not a billing quote. No raw video reads.'}))
    if dry_run:
        return 0
    keys = keys if keys is not None else load_keys()
    ledger = []
    usage_token = insights.router.USAGE.set(ledger)
    failures = 0
    cost = 0
    for f in selected:
        cid = f['clip_id']
        for attempt in range(1, attempts + 1):
            try:
                data = insights.record(cid, vault)
                if force or not data.get('insight'):
                    data = insights.build_record(cid, keys, vault)
                    cost += data['usage']['estimated_usd'] + data['embedding']['estimated_usd']
                    print(json.dumps({'clip_id': cid, 'attempt': attempt, 'vision_usage': data['usage'],
                                      'embedding_estimated_usd': data['embedding']['estimated_usd']}))
                else:
                    if not insights.valid_short(data.get('caption_short')):
                        data = insights.upgrade_caption(data, keys)
                        print(json.dumps({'clip_id': cid, 'caption_short_source': data['caption_short_source']}))
                    if not insights.has_embedding(data):
                        data = insights.refresh_embedding(data, keys)
                        cost += data['embedding']['estimated_usd']
                insights.save_record(data, vault)
                break
            except Exception as exc:
                # Provider errors can contain credentials. Only report the class.
                print(json.dumps({'clip_id': cid, 'attempt': attempt, 'error': type(exc).__name__}))
        else:
            failures += 1
            continue
        try:
            outcome = insights.cache_summary('flight', cid, keys, vault)
            print(json.dumps({'flight_id': cid, **outcome}))
        except Exception as exc:
            # Provider exceptions can contain credentials. Report only the error class.
            failures += 1
            print(json.dumps({'clip_id': cid, 'error': type(exc).__name__}))
    for tid in trips:
        try:
            print(json.dumps({'trip_id': tid, **insights.cache_summary('trip', tid, keys, vault)}))
        except Exception as exc:
            failures += 1
            print(json.dumps({'trip_id': tid, 'error': type(exc).__name__}))
    insights.router.USAGE.reset(usage_token)
    priced = 0
    for entry in ledger:
        if entry.get('model') == 'gemini-2.5-flash':
            priced += (entry['input_tokens'] * .30 + entry['output_tokens'] * 2.50) / 1e6
        elif entry.get('model') == insights.router.EMBEDDING_MODEL:
            priced += entry['estimated_tokens'] * .15 / 1e6
        else:
            priced += (entry.get('prompt_cache_hit_tokens', 0) * .006
                       + entry.get('prompt_cache_miss_tokens', entry.get('prompt_tokens', 0)) * .30
                       + entry.get('completion_tokens', 0) * 1.20) / 1e6
    print(json.dumps({'api_usage': ledger, 'estimated_usd_at_peak_rates': round(priced, 8)}))
    print(json.dumps({'vision_and_embedding_estimated_usd': round(cost, 8), 'failures': failures,
                      'note': 'Vision uses measured tokens; embedding uses estimated tokens. Summary usage is listed above.'}))
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, required=True)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--force', action='store_true', help='regenerate valid visual records')
    parser.add_argument('--clip-id', action='append', help='restrict work to these clip IDs')
    parser.add_argument('--attempts', type=int, choices=(1, 2), default=1)
    args = parser.parse_args()
    if not 1 <= args.limit <= 1000:
        parser.error('--limit must be 1–1000')
    return backfill(args.limit, args.dry_run, force=args.force, clip_ids=args.clip_id, attempts=args.attempts)


if __name__ == '__main__':
    sys.exit(main())
