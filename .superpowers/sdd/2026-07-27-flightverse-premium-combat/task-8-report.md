# Task 8 report — production deployment and canary

Status: PASS

Candidate `b6e2623122bc78e963bfe346e284ae176f414687` was pushed to draft
PR #1 and deployed with the fail-closed restart path. The deployed web tree is
unchanged at `9eaa368db2a309757d264a3f3f41909830d77bc2`.

Production passed the public auth boundary, authenticated manifests and five
runtime weapon GLBs, all five device profiles, four real-touch profiles,
FPV/Cenital/Orbit, gimbal, collision, nine weapons, VFX budgets, and session
revocation.

The first authenticated canary exposed a test-classification defect: the
selected real world has no authored item props and weapon impacts were landing
on DSM terrain, while the fallback gate accepted only photogrammetric
`structure`. A live diagnostic measured 12 terrain impacts and 5,102 world
contacts. The gate now accepts either real world-collider half when props are
absent and remains strict about actual item contact when props exist.

Final evidence:

- `.gstack/canary-reports/2026-07-28-canary.md`
- `.gstack/canary-reports/2026-07-28-canary.json`
- `.gstack/qa-reports/qa-report-world-mobile-2026-07-27.md`

No merge was performed. PR #1 remains draft for operator review.
