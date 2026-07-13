# Incremental Scene Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one real-world place improve over time by combining compatible videos/photos into immutable reconstruction versions and promoting the best valid version.

**Architecture:** A scene manifest owns a stable `scene_id`; each exact source set continues to own a deterministic `recon_<hash>` version. Adding captures creates a new version and reruns SfM/ODM/OpenSplat from all selected sources. Promotion is gated by source-level registration and required artifacts.

**Tech Stack:** Python JSON manifests with atomic writes, existing ODM/OpenSfM and OpenSplat pipeline, vanilla JavaScript scene workflow.

## Global Constraints

- Never overwrite or delete the previous active version when adding captures.
- Geographic proximity is a suggestion, not proof of compatibility.
- Never promote a PARTIAL merge automatically.
- Existing clip and reconstruction links remain valid.

---

### Task 1: Scene manifest store

**Files:**
- Create: `pipeline/scenes.py`
- Create: `pipeline/test_scenes.py`

**Interfaces:**
- Produces: `create_scene(title, anchor, sources, photos)`, `get_scene(scene_id)`, `add_version(scene_id, reconstruction_id, sources, photos, status)`, and `promote(scene_id, reconstruction_id)`.

- [ ] **Step 1: Write failing immutable-version tests**

```python
def test_adding_capture_creates_version_without_overwriting_active(tmp_path):
    scene = create_scene("Casa", {"lat": 4.75, "lon": -74.06}, ["A"], [])
    add_version(scene["id"], "recon_v1", ["A"], [], "ready")
    promote(scene["id"], "recon_v1")
    add_version(scene["id"], "recon_v2", ["A", "B"], ["p.jpg"], "processing")
    result = get_scene(scene["id"])
    assert result["active_version"] == "recon_v1"
    assert [v["id"] for v in result["versions"]] == ["recon_v1", "recon_v2"]
```

- [ ] **Step 2: Verify red**

Run: `python3 pipeline/test_scenes.py`  
Expected: FAIL because no scene store exists.

- [ ] **Step 3: Implement atomic manifests**

Use a temporary sibling file plus `os.replace`. Validate IDs and deduplicate sources/photos while preserving order. Refuse promotion unless the version is `ready` and has `merge_label` `SINGLE` or `FULL`.

- [ ] **Step 4: Verify**

Run: `python3 pipeline/test_scenes.py`  
Expected: PASS.

### Task 2: Scene-aware enqueue and completion

**Files:**
- Modify: `pipeline/aerobrain_server.py`
- Modify: `pipeline/worker.py`
- Modify: `pipeline/build_index.py`
- Modify: `pipeline/test_scenes.py`

**Interfaces:**
- Consumes: `scene_id` plus complete source/photo membership.
- Produces: scene version records linked to jobs and indexed for the UI.

- [ ] **Step 1: Add failing lifecycle tests**

Assert adding source C to scene version `[A,B]` enqueues recon hash `[A,B,C]`, preserves v1, stores `scene_id` in the job, and does not promote when C fails the per-source merge gate.

- [ ] **Step 2: Verify red**

Run: `python3 pipeline/test_scenes.py`  
Expected: FAIL on missing scene-aware lifecycle.

- [ ] **Step 3: Implement endpoints and worker hooks**

Add `/api/scene_create` and `/api/scene_improve`. On completion, copy source registration and output provenance into the version. Promote automatically only for a first valid version; later valid versions remain comparison candidates unless explicitly promoted.

- [ ] **Step 4: Index scenes without breaking models**

Add `scenes` to `manifest/system.json`; keep the existing `models` array and direct `?m=recon_...` links unchanged.

- [ ] **Step 5: Verify**

Run: `python3 pipeline/test_scenes.py && python3 pipeline/test_smoke.py && python3 pipeline/audit_vault.py`  
Expected: PASS.

### Task 3: “Improve this scene” workflow

**Files:**
- Modify: `web/tresd.js`
- Modify: `web/style.css`
- Modify: `pipeline/test_tresd_static.py`

**Interfaces:**
- Consumes: scene manifests and scene-aware endpoints.
- Produces: scene/version selector and capture-addition flow.

- [ ] **Step 1: Add failing UI contract tests**

Assert project details expose `Mejorar esta escena`, show the active version, list previous versions, preselect current sources, and display compatibility warnings plus eventual per-source merge outcomes.

- [ ] **Step 2: Verify red**

Run: `python3 pipeline/test_tresd_static.py`  
Expected: FAIL.

- [ ] **Step 3: Implement the additive workflow**

Reuse the current multi-source picker. Start with the active version’s membership locked-in but removable, offer nearby/compatible candidates, and create a new version. Show `FULL`, `PARTIAL`, or `SINGLE` with exact registered/submitted values.

- [ ] **Step 4: Add version comparison and promotion**

Allow opening old/new project artifacts and promoting a ready FULL version. A PARTIAL version can be inspected but not promoted without an explicit warning flow.

- [ ] **Step 5: Verify mobile-first and complete acceptance**

Run: `node --check web/tresd.js && python3 pipeline/test_tresd_static.py && python3 pipeline/browser_matrix.py <validated_reconstruction_id>`  
Expected: syntax/static PASS and browser matrix PASS at mobile, tablet, and desktop.

