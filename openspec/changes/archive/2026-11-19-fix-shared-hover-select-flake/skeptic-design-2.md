## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD beb94adfe49759ebc8e180500130a032fdfac3b4 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/hel1675-hover-flake/HEL-1790`.
- **Round-1 change requests: all six are addressed.**
  - CR1: the neighbour fact is corrected, and runner speed is named as the differential.
  - CR2: the rest paint equals the hover paint, and Decision 3 contradicts the product branch.
  - CR3: Decision 1 has the (a)/(b)/(c) completeness bar.
  - CR4: the forced-condition guard rules are in Risks.
  - CR5: task 4.1 covers the PR `e2e (2)` leg and hands post-merge to the orchestrator.
  - CR6: tasks 3.1 and 3.2 separate the full leg-2 run from the neighbour run.
- **Log facts, re-derived from the logs:**
  - Test ids are 104/105/109/112 in the passing log and 104/108/112/114 in all three failing logs.
  - Durations: desktop dark ran 18.8 / 18.2 / 18.9 s and light failed at 9.2 / 8.7 / 8.8 s, against 32.6 / 28.6 s when passing.
  - Legs: `119 passed (12.2m / 12.0m / 11.9m)` against `120 passed (17.5m)`.
  - Failure: `Error: 3 Select trigger must differ from rest on hover` at spec `:374`.
  - CI ran `node scripts/e2e-shard.mjs run 2 7` (`e2e2-fail.log:1618`), and `DEFAULT_E2E_LEGS = 7` (`e2e-shard.mjs:234`). So `plan 7`, leg 2, is the right recipe.
- **CSS facts:**
  - `theme.css:462-463` defines light subtle as `0.11` and strong as `0.2`.
  - `inputs.css:12` sets the rest border to subtle, and `:30-35` is the `(hover: hover)` rule that sets it to strong.
  - The transition is on border-color.
- **Spec structure:**
  - Instances 1 and 3 share the same `open` (`openSheet(page)`, which clicks `.spine-row__select` nth 0).
  - The rest read comes right after `inst.open` (`:367-368`), and `noAnimations` only waits out animations that are already `running` (`:35-39`).
  - The design's pointer-geometry and pending-transition candidates are consistent with this code.
- **FALSE planning fact: "CI uploads only `playwright-json-shard-*` artifacts (no trace)"** (design.md Context, bullet 4).
  - `ci.yml:720-730` has a step "Upload Playwright report on failure" with `if: failure()`. It uploads `playwright-report-shard-<n>` containing `test-results/`, `/tmp/backend.log` and `/tmp/frontend.log`, with 7-day retention.
  - `playwright.config.ts:208` sets `trace: "retain-on-failure"`.
  - The failing log shows the upload: `e2e2-fail.log` around line 2139 reports `Uploading artifact: playwright-report-shard-2.zip`, 5 files, 3821341 bytes. The `trace.zip` path is printed at `:2026`.
  - The artifacts exist and have not expired. Read-only `gh api .../actions/runs/<id>/artifacts` returned:
    - run 44667845106 (main@beb94adfe): `playwright-report-shard-2  3655804  expired=false  expires 2026-11-27T03:41:49Z`;
    - run 44664959871 (PR #1188, both attempts): `3769895` and `3821341` bytes, `expired=false`, expiring 2026-11-27.

### Verdict: REFUTE

The structure is now sound. But the reproduction recipe in Decision 1 and Risks is built on a false premise: that the real CI runner left no trace. Three real failing-run Playwright traces are available today, and they expire on 2026-11-27. Each trace has:

- the action log, with the exact pointer coordinates of every click and hover;
- DOM snapshots before and after each action, including the sheet geometry at the rest read;
- a screencast, plus the backend and frontend logs.

This is the strongest evidence available for the primary probe question, because it comes from the runner that actually fails, which local reproduction may never match. As written, the executor is told it does not exist. It would go straight to local reproduction, CPU throttling, and a CI diagnostics commit, and could even name a cause from a forced local guard that the real-run trace contradicts. The fix is cheap.

### Change Requests

1. **Correct design.md Context bullet 4 and add a trace-first step.**
   - Replace "CI uploads only `playwright-json-shard-*` artifacts (no trace)" with the facts above:
     - the `playwright-report-shard-2` artifacts from runs 44667845106 and 44664959871 (both attempts);
     - each artifact holds `test-results/.../trace.zip`, `backend.log` and `frontend.log`;
     - they expire on 2026-11-27.
   - Add a step 0 to Decision 1's recipe and to tasks.md §1, before 1.2. In it:
     - download all three artifacts with `gh run download <run> -n playwright-report-shard-2 -D .concertino/scratch/HEL-1790/ci-trace-<run>[-<attempt>]`;
     - persist the three `trace.zip` files to `.concertino/runs/HEL-1790/evidence/` now, because they expire;
     - from each trace, extract for instance 3 the click point of `openSheet` and the hover point of `control.hover()`, the `.ui-select__trigger` bounding box in the DOM snapshot at the rest read, and the timing between the click, the sheet-visible check, `noAnimations` and the `paint` evaluate;
     - record whether the click point falls inside the trigger's box.
   - Decision 1's completeness bar must then also be consistent with this real-run trace evidence. A cause the CI trace contradicts is not confirmed, even if a local forced guard reproduces it.
   - Only if the traces cannot settle it do the existing fallbacks apply (local leg-2 run, then neighbours, then throttling, then the CI diagnostics commit). Note that the passing run has no trace (`retain-on-failure`), so discriminator (c) still needs local or diagnostic evidence.

### Non-blocking notes

- Instance 2 is marked `probeOnly`, but the desktop loop ignores `probeOnly` and asserts `not.toEqual` for all six. That is fine, but a test fix must keep it that way.
- One candidate worth naming for the probe: Chromium dispatches a synthetic mouse move after layout or scroll changes, and its timing depends on how busy the page is. That would make `:hover` turn on under a pointer that never moved, at a moment that depends on load. `noAnimations` also ignores transitions that are not yet running. Either could make the result depend on runner speed. These are candidates, not conclusions.
- `TICKET_TYPE: feature` in workflow-state.md is still set for a bug ticket. This is cosmetic.
