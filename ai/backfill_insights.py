"""Bounded visual AI backfill. Dry run performs no API calls or writes."""
import argparse
import json
import sys
import insights
from router import load_keys


def backfill(limit, dry_run=False, vault=insights.VAULT, keys=None):
    rows = insights.flights(vault)
    pending_trips = {f['clip_id'] for g in insights.trip_groups(rows)
                     if insights.get_summary('trip', g['id'], vault)['status'] != 'ready'
                     for f in g['flights']}
    selected = [f for f in rows if list((vault / 'frames' / f['clip_id']).glob('f_*.jpg'))
                and (insights.get_insight(f['clip_id'], vault)['status'] != 'ready'
                     or insights.get_summary('flight', f['clip_id'], vault)['status'] != 'ready'
                     or f['clip_id'] in pending_trips
                     or not insights.has_embedding(insights.record(f['clip_id'], vault)))][:limit]
    ids = [f['clip_id'] for f in selected]
    trips = [g['id'] for g in insights.trip_groups(rows) if any(f['clip_id'] in ids for f in g['flights'])]
    print(json.dumps({'dry_run': dry_run, 'clip_ids': ids, 'trip_ids': trips,
                      'estimated_usd': round(len(ids) * .005 + len(trips) * .002, 4),
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
        try:
            if insights.get_insight(cid, vault)['status'] != 'ready':
                data = insights.build_record(cid, keys, vault)
                insights.save_record(data, vault)
                cost += data['usage']['estimated_usd'] + data['embedding']['estimated_usd']
                print(json.dumps({'clip_id': cid, 'vision_usage': data['usage'],
                                  'embedding_estimated_usd': data['embedding']['estimated_usd']}))
            elif not insights.has_embedding(insights.record(cid, vault)):
                data = insights.refresh_embedding(insights.record(cid, vault), keys)
                insights.save_record(data, vault)
                cost += data['embedding']['estimated_usd']
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
    args = parser.parse_args()
    if not 1 <= args.limit <= 1000:
        parser.error('--limit must be 1–1000')
    return backfill(args.limit, args.dry_run)


if __name__ == '__main__':
    sys.exit(main())
