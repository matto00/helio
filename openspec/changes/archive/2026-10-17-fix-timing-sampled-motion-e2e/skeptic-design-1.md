## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/fix-timing-sampled-motion-e2e/HEL-1658`.
  Reviewed HEAD 4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec. The change dir is untracked, and there is no code diff yet (as expected at the design gate).
- Read ticket.md, proposal.md, design.md and tasks.md in full. I found no TODO/TBD placeholders, and no decision is deferred in a way that blocks implementation.
- I checked the plan's premises against the live specs:
  - `e2e/hel1584-motion-surfaces.spec.ts:562` is the save-check test. It reads `log(page)` once right after `toBeVisible`, which matches design Context bullet 1. The recorder's `animationstart` handler (`e2e/support/motionRecorder.ts`) is asynchronous to the visibility wait, so the premise holds.
  - `:487` is the refresh-morph test. It runs `waitForTimeout(1800)`, filters `__chartBars` to `[refreshedAt, refreshedAt+1800)` and requires `between.length >= 2`, which matches. `__chartEdges` exists in the recorder (the unfinished/finished edges of the zrender clock), so Decision 3's second signal can be built on top of the existing instrumentation.
  - `e2e/hel1260-orphan-owner-repair.spec.ts:108` is the UI-create test. Its `boundingBox()` reads are at :145 and :150 after `waitForTimeout(500)`. The sibling orphan test (:24) has the same pattern at :89 and :94, and Decision 4 covers it explicitly.
- AC coverage:
  - Red-first under throttle: task 1.1 and C2.
  - Controls still red: task 3.2. The four named controls match the HEL-1584 evidence files `red-run-{off-lift,width-block,expand-strictmode,palette-label}.txt`, plus the new hard-cut and missing-pop mutations.
  - No retries, timeouts or loosening: C1. Decision 3 explicitly rejects a bare `>=2 -> >=1`, and the hard-cut red run is mandatory.
  - 40/40 throttled: task 3.1.
  - Driver scope sweep: Decision 5 and task 2.4.
  - Product-defect escalation path: C3 and Decision 1.
- Internal consistency: the proposal, design and tasks agree. The scope is test-only, `skip_specs: true` is justified, and no API or schema contract is touched.

### Verdict: CONFIRM

### Non-blocking notes
- The ticket says "Keep the Off / reduce controls" for :487, but the refresh test runs under Full only (:487 is not part of the mode loop at :336). Decision 3's "Off/reduce mode controls where they apply" is correct to treat this as possibly not applicable. The executor should say explicitly in evidence which mode controls apply to the morph test and which do not, rather than leave it silent.
- On the root cause of `boundingBox()` returning null in hel1260: Playwright returns null for a non-visible or detached element, and a mid-opacity or transform entrance still has a box. The executor should record in the red run what the element state actually was (detached/replaced vs. not yet laid out), so the stable-box helper is grounded in a probe-confirmed cause rather than the assumption that it was "mid-entrance". A poll still fails loudly if the box never arrives, so this does not mask a hang.
- Decision 1's throttle harness: if an env-gated helper is committed, document it in the spec and make sure it is a no-op when unset. Otherwise keep it in scratch.
- AC "Green in CI on the exact merged head" has no task. It belongs to delivery/merge, but the orchestrator must still check it.
- The `__chartEdges` / `__chartBars` recorder reads the first chart `find()` resolves. Confirm that this is still the M-refresh chart (it is today, since the existing assertions depend on it), and that hover or other animations on that chart cannot make the clock go unfinished during a hard-cut control. The mandatory hard-cut red run covers this empirically.
