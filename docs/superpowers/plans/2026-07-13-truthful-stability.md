# Truthful Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace false preflight certainty with evidence-based decisions and make ODM Alta plus Gaussian Cinematic/Ultra deliver the best available artifact with explicit provenance.

**Architecture:** `preflight.py` returns deterministic input-memory facts plus calibrated or unverified risk. The server stores the decision in the job spec, and the worker uses it to choose the first safe rung and an explicit quality fallback ladder. ODM and splat sidecars expose requested/effective quality uniformly.

**Tech Stack:** Python 3.14, SQLite, unittest-style project tests, OpenSplat MPS, ODM Docker.

## Global Constraints

- Never show a numeric Cinematic/Ultra peak unless it comes from a matching measured envelope.
- Never silently relabel a degraded artifact as the requested quality.
- Preserve existing job and artifact compatibility.
- Do not run multiple heavy jobs concurrently.

---

### Task 1: Evidence-based splat preflight

**Files:**
- Modify: `pipeline/preflight.py`
- Create: `pipeline/test_preflight.py`
- Modify: `pipeline/aerobrain_server.py`

**Interfaces:**
- Produces: `splat_preflight(n_images, width, preset, d=1) -> dict` with `verdict`, `confidence`, `recommended_d`, `input_floor_mib`, and optional calibrated peak fields.
- Consumes: `hwconfig.load()["caps"]["opensplat_mib"]`.

- [ ] **Step 1: Write failing truth tests**

```python
def test_ultra_does_not_invent_peak_or_claim_machine_incapable():
    result = splat_preflight(232, 3072, "ultra")
    assert result["verdict"] == "UNVERIFIED_HIGH_RISK"
    assert result["confidence"] == "unverified"
    assert "projected_peak_mib" not in result
    assert result["recommended_d"] == 2

def test_large_medium_uses_calibrated_d2():
    result = splat_preflight(214, 3072, "medium")
    assert result["confidence"] == "calibrated"
    assert result["recommended_d"] == 2
    assert result["d2_projected_peak_mib"] == 8800
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `python3 pipeline/test_preflight.py`  
Expected: FAIL because current Ultra returns `REJECTED` with a fabricated numeric peak.

- [ ] **Step 3: Implement deterministic floor and calibrated Medium envelopes**

Use `_base_imgs_mib()` for all presets. Return numeric calibrated peaks only for Medium, select `recommended_d=2` when the full-resolution floor consumes more than 70% of the cap, and return `UNVERIFIED_HIGH_RISK` for Cinematic/Ultra without a matching empirical envelope.

- [ ] **Step 4: Store and expose the new decision**

Update `/api/preflight` and `/api/splat` to preserve the result and accept `best_available` without blocking an unverified preset.

- [ ] **Step 5: Run focused tests**

Run: `python3 pipeline/test_preflight.py && python3 pipeline/test_smoke.py`  
Expected: PASS with no categorical Ultra rejection at 22 or 232 images.

### Task 2: Safe first rung and quality ladder

**Files:**
- Modify: `pipeline/worker.py`
- Modify: `pipeline/splat_presets.py`
- Create: `pipeline/test_splat_policy.py`

**Interfaces:**
- Produces: `splat_attempt_plan(spec, n_cams, width) -> list[dict]` where each attempt has `preset`, `d`, `train_args`, and `reason`.
- Consumes: preflight fields stored in the job spec.

- [ ] **Step 1: Write failing policy tests**

```python
def test_ultra_large_scene_skips_guaranteed_full_resolution_attempt():
    plan = splat_attempt_plan({"preset": "ultra", "best_available": True,
                               "preflight": {"recommended_d": 2}}, 232, 3072)
    assert plan[0]["preset"] == "ultra"
    assert plan[0]["d"] == 2
    assert any(x["preset"] == "cinematic" for x in plan)
    assert any(x["preset"] == "medium" for x in plan)

def test_strict_mode_never_changes_preset():
    plan = splat_attempt_plan({"preset": "ultra", "best_available": False}, 30, 3072)
    assert {x["preset"] for x in plan} == {"ultra"}
```

- [ ] **Step 2: Verify red**

Run: `python3 pipeline/test_splat_policy.py`  
Expected: FAIL because no policy function or cross-preset ladder exists.

- [ ] **Step 3: Implement the bounded attempt plan**

Generate at most one justified input scale per quality tier, ordered requested -> lower tiers. Keep current preset train arguments and the 11 GB cap. Emit a structured attempt/fallback event before every transition.

- [ ] **Step 4: Persist effective provenance**

Extend splat sidecars and `reconstruction.splat_runs[]` with `requested_preset`, `effective_preset`, `input_scale`, `attempts`, `fallback`, and the observed peak fields.

- [ ] **Step 5: Verify policy and existing splat audit**

Run: `python3 pipeline/test_splat_policy.py && python3 pipeline/audit_splats.py`  
Expected: PASS; existing current and archived splats remain valid.

### Task 3: ODM and phased-chain truth

**Files:**
- Modify: `pipeline/worker.py`
- Modify: `pipeline/aerobrain_server.py`
- Modify: `web/tresd.js`
- Modify: `pipeline/test_smoke.py`

**Interfaces:**
- Produces: job spec keys `then_splat`, `splat_preset`, and `best_available`; ODM completion provenance in the job summary.

- [ ] **Step 1: Add a failing round-trip test**

Post an ODM request with `then_splat=true`, assert the stored 3D spec retains Ultra, complete the mocked ODM stage, and assert exactly one splat job is enqueued with `requested_preset=ultra`.

- [ ] **Step 2: Verify red against the captured production regression**

Run: `python3 pipeline/test_smoke.py`  
Expected: FAIL until the UI/API/worker chain preserves and reports the phased selection.

- [ ] **Step 3: Implement the round-trip and completion wording**

Keep the selected phased fields through enqueue and worker completion. Build completion detail from effective ODM metadata instead of the generic “modelo listo” string.

- [ ] **Step 4: Verify**

Run: `python3 pipeline/test_smoke.py && node --check web/tresd.js`  
Expected: PASS.

