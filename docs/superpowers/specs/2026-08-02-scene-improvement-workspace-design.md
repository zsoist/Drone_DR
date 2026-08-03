# Scene Improvement Workspace — Approved Design

**Date:** 2026-08-02  
**Status:** Approved through the operator's standing full-access/no-questions authorization  
**Product objective:** Let an operator improve an existing 3D and Gaussian scene with new captures while preserving the active version, showing why every source is useful, and enforcing the real processing budget before a job is queued.

## Evidence that constrains the design

- `Dialectica 14 Julio` already has a valid 221-camera reconstruction and five splat artifacts. The active result must remain available while a new version is processed.
- The July 24 capture set mixes useful orbits/obliques with short or stationary clips. Geographic proximity alone does not establish reconstruction value.
- The server accepts at most 16 videos and 1,200 seconds per scene version, while the current UI advertises 24 sources. The server contract is authoritative.
- The existing improvement modal shows up to 101 candidates, nests scroll regions, puts advanced settings in the primary path, and leaves the submit action below the fold.
- Existing scene infrastructure already provides immutable versions, source evidence, 500 m same-site enforcement, FULL/PARTIAL registration truth, CUDA processing, and promotion gates.

## Product principles

1. Improving creates a candidate version; it never overwrites or auto-promotes over the active version.
2. A source recommendation must explain its contribution: orbit/oblique coverage, roof/detail, or overview/context.
3. The default plan is useful and conservative. Weak short clips remain available under “Other captures” but are not preselected.
4. Processing limits, selected duration, and selected source count stay visible before submission.
5. Advanced ODM and Gaussian controls are available without dominating the primary workflow.
6. No quality gain is promised before measurement. The UI describes expected coverage contribution and keeps effective quality/fallback reporting truthful.

## Chosen interaction model

Replace the long modal with a dedicated authenticated workspace at:

```text
/scene-improve.html?id=<model_id>
```

The workspace uses the existing AeroBrain shell, typography, color tokens, buttons, and light/dark themes. It has a compact four-step narrative rather than four wizard screens:

1. **Base scene** — selected model, current camera count, active version status, and an explicit “will remain intact” guarantee.
2. **Recommended captures** — selected recommendations first; every row shows thumbnail, date/time, duration, distance, altitude, contribution role, quality signal, and recommendation reason. Current sources are locked. Other same-site captures are collapsed.
3. **Reconstruction** — defaults to High ODM on CUDA plus Frontier 30K Gaussian; advanced controls are collapsed.
4. **Review and launch** — a sticky desktop summary and sticky mobile action show selected videos, combined duration, limits, expected coverage contributions, and the primary CTA.

After submission, the same page shows the queued reconstruction ID and job ID, explains that the active version is still live, and links to Processing.

## Recommendation policy

The recommendation engine is deterministic, testable, and client-side because the inputs already come from authenticated APIs. It must:

- include current sources as locked;
- reject unknown or cross-site sources from selection;
- enforce the server-provided limits: 16 videos, 1,200 seconds, 500 m site radius, and 80 photos;
- score same-site captures using real capture-report evidence when available;
- prefer complementary roles instead of filling the budget with similar clips;
- prefer long, multi-heading orbit/oblique clips for mesh and splat reconstruction;
- use roof/detail clips only when they add strong close or top coverage;
- de-prioritize clips below 20 seconds, negative relative altitude, or mesh/splat suitability below 6;
- never remove a locked current source to make a recommendation fit.

For the real Dialectica July 24 data, the expected default additions are:

- 12:19 — long orbit/oblique coverage;
- 12:21 — complementary orbit/oblique coverage;
- 12:24 — high roof/detail coverage;
- 16:24 long — overview/context coverage.

Together with the July 14 base source this is five videos and about 13 minutes 25 seconds, within the real server budget. The short 12:25–12:27 clips and 16:24 ten-second clip remain optional.

## API contract

`GET /api/scenes` returns the existing `scenes` array plus:

```json
{
  "limits": {
    "max_sources": 16,
    "max_duration_s": 1200,
    "max_distance_m": 500,
    "max_photos": 80
  }
}
```

Old consumers remain compatible because `scenes` is unchanged. The workspace fetches candidate capture reports lazily and uses these authoritative limits for selection and review. `POST /api/scene_improve` remains the final authority and retains all server-side validation.

## Accessibility and responsive behavior

- Functional text is at least 12 px; body copy is at least 14 px.
- Every checkbox has a full-row label and a visible focus state.
- Selected, recommended, locked, incompatible, and weak states use icon/text in addition to color.
- No nested scrolling area is used for source selection.
- The desktop review rail becomes a bottom action bar below 860 px.
- Reduced-motion preferences disable entrance and progress animations.
- Errors appear beside the review action and move focus to a live status region.

## Out of scope

- In-place incremental ODM/OpenSplat training.
- Automatic promotion of the new version.
- Claims of better geometry before registration and quality gates complete.
- Cross-site scene merging or raising the 500 m server boundary.

