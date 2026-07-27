# Task 4 — Release, deployment, and production canary

Status: DONE

## Candidate

- SHA: `0b0d798582a9bbb5d44367d3cfeb9c5f08d6f0d8`
- Branch: `codex/scene-ops-stability`
- Web fingerprint: v313
- Candidate web tree: `13e2a5208b4390ab305647d582999e4f49b80325`
- Independent complete-diff review: APPROVED.

## Complete release suite

- Python compilation: PASS.
- Focused Node suite: 51/51 PASS.
- Full smoke suite: PASS.
- World audit: 9/9 PASS.
- World runtime sweep: 9/9 at 60 fps; disk audit clean.
- Invasion runtime: 60 fps; preload 6/6; caps and console clean.
- Collision stress 100: 100/100 at 60 fps; 20 shots, 20 explosions, four
  reloads; no failures or console errors.
- Default Flightverse browser matrix: all ten Mundo/Volar cases PASS. The four
  mobile profiles used real touch at 60 fps; desktop held 60 fps.
- Branch diff check: PASS.

## Push and PR

The candidate was pushed to `origin/codex/scene-ops-stability`. Draft PR #1
was updated with a separate v313 evidence section while preserving the v312
mobile and v305 historical release context. It remained open, draft, and
unmerged.

## Deployment

`pipeline/safe_restart.sh server` completed every-world preflight, collision
stress 100, server restart, and mandatory post-health with no bypass.

## Production canary

- Loopback health: 200 with all checks true.
- Loopback whoami: `daniel`, `dev_mode:true`.
- Public health: 200 with private/no-store edge policy.
- Public Mundo without auth: exact 303 login redirect.
- Public whoami without auth: 401.
- Authenticated public manifest: 200 through `private-data-v1`.
- Production mobile portrait: nine islands, 60 fps, real touch PASS.
- Production desktop: nine islands, 60 fps PASS.
- Ephemeral session revoked and authoritative invalidity confirmed.

## Repository integrity

- 225 v313 references and zero stale v300-v312 references.
- 92 complete, byte-identical, fresh gzip pairs.
- Candidate web files remained unchanged after deployment.

The QA and canary reports are the only release-evidence changes. The
authoritative evidence SHA is reported in the final handoff because a commit
cannot contain its own SHA.
