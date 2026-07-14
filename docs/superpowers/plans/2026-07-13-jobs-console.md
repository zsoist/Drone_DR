# Jobs Operational Console Implementation Plan

> **Completed dated plan.** Current operation and recovery rules are in [../../OPERATIONS.md](../../OPERATIONS.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stale Jobs cards with a truthful operational console backed by structured events and complete durable logs.

**Architecture:** SQLite stores summaries and structured events; append-only files store complete subprocess output. Polling fetches compact summaries, while job details and logs load only on demand. The UI follows the current AeroBrain tokens and components, with a responsive list and log drawer.

**Tech Stack:** Python `sqlite3`, HTTP JSON endpoints, vanilla JavaScript, CSS, existing AeroBrain shell components.

## Global Constraints

- Full logs never travel in `/api/jobs`.
- Log endpoints enforce authentication and bounded reads.
- Original errors are immutable; diagnoses and resolutions are separate events.
- User-facing copy is Spanish and requested/effective quality is always explicit.

---

### Task 1: Durable logs and events

**Files:**
- Modify: `pipeline/jobs.py`
- Create: `pipeline/test_jobs_observability.py`

**Interfaces:**
- Produces: `event(jid, event, message="", level="info", data=None)`, `events(jid)`, `log_chunk(jid, after=0, limit=500)`, and `log_path(jid)`.

- [ ] **Step 1: Write failing store tests**

```python
def test_event_round_trip_and_order():
    event(jid, "attempt", "Ultra -d2", data={"preset": "ultra", "d": 2})
    assert events(jid)[-1]["data"]["d"] == 2

def test_log_chunk_is_bounded_and_cursor_based():
    path = log_path(jid)
    path.write_text("a\nb\nc\n")
    chunk = log_chunk(jid, after=1, limit=1)
    assert chunk == {"lines": ["b"], "next": 2, "eof": False}
```

- [ ] **Step 2: Verify red**

Run: `python3 pipeline/test_jobs_observability.py`  
Expected: FAIL because the event table and durable logs do not exist.

- [ ] **Step 3: Add the additive schema and helpers**

Create `job_events` with an index on `(job_id, ts)`. Sanitize job IDs before deriving `VAULT/ops/job_logs/<id>.log`. Append each subprocess line in `run_tracked` while retaining the existing throttled SQLite tail.

- [ ] **Step 4: Verify store behavior and cancellation**

Run: `python3 pipeline/test_jobs_observability.py && python3 pipeline/test_smoke.py`  
Expected: PASS.

### Task 2: Enriched job APIs

**Files:**
- Modify: `pipeline/aerobrain_server.py`
- Modify: `pipeline/jobs.py`
- Modify: `pipeline/test_jobs_observability.py`

**Interfaces:**
- Produces: `/api/jobs`, `/api/job?id=`, and `/api/job_log?id=&after=&limit=`.

- [ ] **Step 1: Add failing API contract tests**

Assert `/api/jobs` omits full log content and includes counts plus normalized requested/effective fields. Assert `/api/job_log` rejects `../jobs.db`, caps `limit` at 1000, and returns a cursor.

- [ ] **Step 2: Verify red**

Run: `python3 pipeline/test_jobs_observability.py`  
Expected: FAIL because only the current broad `/api/jobs` route exists.

- [ ] **Step 3: Implement exact route matching and normalizers**

Parse job specs server-side. Read model/splat sidecars only for detail requests. Return ISO timestamps, factual elapsed duration, source counts, requested/effective quality, product mode, artifacts, events, and diagnosis annotations.

- [ ] **Step 4: Verify**

Run: `python3 pipeline/test_jobs_observability.py && python3 -m py_compile pipeline/*.py`  
Expected: PASS.

### Task 3: Responsive operational UI and full-log mode

**Files:**
- Modify: `web/tresd.js`
- Modify: `web/shell.js`
- Modify: `web/style.css`
- Modify: `pipeline/test_tresd_static.py`

**Interfaces:**
- Consumes: enriched Jobs APIs.
- Produces: searchable/filterable job list, summary counters, expandable provenance, fallback timeline, and log drawer.

- [ ] **Step 1: Write failing UI contract assertions**

Assert the source contains controls for search, ODM/Splat/Import filters, requested/effective labels, log search, wrap, autoscroll/pause, copy, and download. Assert progress bars expose `role=progressbar` and `aria-valuenow`.

- [ ] **Step 2: Verify red**

Run: `python3 pipeline/test_tresd_static.py`  
Expected: FAIL on the missing operational controls.

- [ ] **Step 3: Implement the console using existing tokens**

Replace the two-column dense grid with a single operational list on desktop and mobile. Use existing icons, colors, radii, typography, chips, and buttons. Display elapsed time; display ETA only when the API supplies `eta_basis`.

- [ ] **Step 4: Implement on-demand log mode**

Open a drawer from each row. Fetch cursor chunks, preserve keyboard focus, support search/severity/wrap/autoscroll, and pause network appends without losing the cursor.

- [ ] **Step 5: Verify syntax, static contract, and mobile layout**

Run: `node --check web/shell.js web/tresd.js && python3 pipeline/test_tresd_static.py`  
Expected: PASS. Then inspect at 390x844 and desktop through the approved local browser workflow.
