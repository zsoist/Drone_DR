# Scene Similarity UI Design

> **Implemented dated design.** Retained as acceptance provenance; backend distance gates remain authoritative.

## Outcome

The existing “Mejorar esta escena” modal will make the same-site boundary visible before a user submits work. Flights with measured centers within 500 m of the stable site anchor remain selectable and read as `mismo sitio`. Flights outside that radius remain visible for traceability, read as `otro sitio`, and cannot be selected into this version.

## Approaches considered

1. Keep the current warning-only rows and reject incompatible sources at submit time. This preserves the layout but makes the user discover the boundary through an error.
2. Recommended: keep every flight visible, disable cross-site rows, add measured same-site/cross-site language, and retain the server gate. This prevents wasted interaction without hiding evidence or weakening backend safety.
3. Add a separate cluster-management screen. This could support advanced site administration later, but it introduces a new navigation surface that is unnecessary for the current workflow.

The approved direction is approach 2. It extends the existing visual system and interaction model instead of inventing a new screen.

## UI contract

- Distance continues to come from measured flight coverage centroids and the current model center.
- Rows at 500 m or less show `mismo sitio` alongside their measured distance.
- Rows beyond 500 m show `otro sitio`, retain their thumbnail and evidence history, and disable their checkbox.
- The “Seleccionar candidatos ≤500 m” action selects only enabled same-site rows plus the immutable active sources.
- The selected-source counter counts only checked sources; disabled rows never inflate it.
- The existing evidence state remains visible. Spatial compatibility augments it and does not overwrite registration history.
- The footer explains that the server validates the 500 m site boundary again before queueing.

## Data and safety

The browser classification is an interaction aid. `/api/scene_improve` remains authoritative and rejects missing coverage or any source beyond 500 m. No cross-zone request creates a version or job. Worker-side frame preflight remains independent: spatially valid sources still need at least five post-selection frames before RTX matching.

## Verification

- Static UI test proves cross-site rows are disabled and same-site selection ignores them.
- Server tests prove near, far, and unknown coverage behavior.
- Browser QA checks the modal at desktop and narrow widths, verifies no horizontal overflow, and confirms disabled rows cannot be toggled.
- Live rejection probe confirms a measured 52.2 km cross-zone source returns `SCENE_SOURCE_INCOMPATIBLE` without queue mutation.

## Self-review

The design has no placeholder requirements, keeps the existing modal and tokens, uses one measured threshold consistently across client and server, and does not add unrelated navigation or data models.
