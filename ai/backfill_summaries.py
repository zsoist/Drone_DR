"""Refresh existing summary caches with a bounded, text-only pass."""
import argparse
import json
import insights
from router import load_keys


def backfill(limit, dry_run=False, vault=insights.VAULT, keys=None, deterministic=False):
    if not 1 <= limit <= 1000:
        raise ValueError('limit must be 1–1000')
    rows = insights.flights(vault)
    candidates = [('trip', g['id']) for g in insights.trip_groups(rows)]
    candidates += [('flight', f['clip_id']) for f in rows]
    targets = [(kind, identity) for kind, identity in candidates
               if insights.summary_path(kind, identity, vault).is_file()
               and ('summary_hash' not in insights.read(insights.summary_path(kind, identity, vault), {})
                    or insights.get_summary(kind, identity, vault)['status'] != 'ready')][:limit]
    report = {'dry_run': dry_run, 'selected': len(targets), 'limit': limit,
              'calls': 0, 'templates': 0, 'prompt_tokens': 0, 'completion_tokens': 0,
              'calls_without_usage': 0,
              'estimated_usd_at_peak_rates': 0.0}
    if not dry_run:
        keys = keys if keys is not None else {} if deterministic else load_keys()
        for kind, identity in targets:
            result = insights.cache_summary(kind, identity, keys, vault, deterministic=deterministic)
            usage = result['usage']
            report['calls'] += int(not deterministic and not result['cached'])
            report['calls_without_usage'] += int(not deterministic and not result['cached'] and not usage)
            report['templates'] += int(result.get('origin') == 'template')
            report['prompt_tokens'] += usage.get('prompt_tokens', 0)
            report['completion_tokens'] += usage.get('completion_tokens', 0)
            # Conservative estimate: all input tokens use the cache-miss rate.
            report['estimated_usd_at_peak_rates'] += (usage.get('prompt_tokens', 0) * .30
                                                     + usage.get('completion_tokens', 0) * 1.20) / 1e6
        report['estimated_usd_at_peak_rates'] = round(report['estimated_usd_at_peak_rates'], 8)
    print(json.dumps(report))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, required=True)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--deterministic', action='store_true', help='use templates with no API calls')
    args = parser.parse_args()
    backfill(args.limit, args.dry_run, deterministic=args.deterministic)
