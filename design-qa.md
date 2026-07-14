# Design QA — CUDA splat frontier UI

Date: 2026-07-13  
Reference: user-provided Estudio 3D configuration screenshot  
Implementation: `web/tresd.js`, `web/shell.js`, `web/style.css`

## Visual comparison

![Reference and implemented CUDA quality UI](docs/qa/2026-07-13-cuda-studio-comparison.png)

The implementation preserves the existing product language: dark modal shell, blue active
step, compact uppercase labels, restrained borders, monospace telemetry, the established
quality-card interaction, and the same primary action hierarchy. The new profile surface is
an extension of those components rather than a separate visual system.

## Deliberate product changes

- Replaced the stale “worker integration in progress” and silent Metal fallback promise with
  the live NVIDIA node state, VRAM, temperature, utilization, and strict failure policy.
- Added the complete canonical quality ladder: Fast 1K, Medium 2K, Cinematic 7K, Ultra 15K,
  Ultra+ 20K, Frontier 30K, and Grandmaster 40K.
- Kept local Apple Metal only for Fast/Medium. CUDA-only cards visibly lock the compute choice.
- Added measured-versus-projected timing language. Measured values include sample count,
  cameras, and effective resolution; projections identify their measured baseline and range.
- Added Auto/Complete/Half resolution controls with full-first behavior explained in place.
- Split ODM fallback behavior from splat behavior: ODM may continue locally; strict CUDA splats
  do not silently change backend or quality.

## Interaction QA

- Direct splat flow: all seven tiers render; Frontier 30K is selected; CUDA is locked; Auto is
  selected; strict policy is visible.
- Local fallback: selecting Fast 1K enables the compute toggle; disabling CUDA updates the
  policy to Apple Metal and disables CUDA resolution controls.
- Studio phased flow: enabling gaussian training reveals the same seven-tier contract and
  sends the same preset/backend/resolution vocabulary as the direct flow.
- Live node states cover ready, busy, asleep, and unavailable; asleep exposes Wake-on-LAN.
- Desktop visual pass completed in the in-app browser using real vault data and RTX telemetry.

## Result

PASS. No blocking hierarchy, spacing, contrast, or interaction defects remain in the tested
desktop flow. Responsive rules collapse the profile grid to two columns below 900 px and one
column below 580 px.
