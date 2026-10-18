## Context

See proposal.md - Why. The three failures (CI run 39070838899 on main, run 39076418526 on PR #1056) all read state at a
moment chosen by wall-clock rather than by the state the assertion is about:

- `:562` reads `__motionLog` once right after the "Saved" check is visible; the `animationstart` that the recorder
  (`e2e/support/motionRecorder.ts`) logs can land a frame later on a slow runner.
- `:487` samples `__chartBars` (summed bar height per rAF) for 1800 ms and requires >= 2 frames strictly between the old
  and new sums inside a ~280 ms update tween. A slow runner yields fewer rAFs per tween. The recorder already records the
  zrender animation clock's unfinished/finished edges in `__chartEdges`.
- `hel1260 :108` reads `.react-grid-item` `boundingBox()` after a fixed 500 ms wait; HEL-1584's grid entrance can leave
  the item without a box (null) at that moment.

## Goals / Non-Goals

**Goals:** each test waits on the state it asserts; each still goes red on its control (hard cut, missing pop, Off token
removed, etc.). **Non-Goals:** product code, CI config, retries/timeouts/threshold loosening.

## Decisions

1. **Reproduce red first under CPU throttle.** Use CDP `Emulation.setCPUThrottlingRate` (4-6x) via a test-local or
   env-gated helper applied only during the probe/repeat runs (never left on in the committed specs unless it is a
   deliberate, documented part of the test), or `taskset`/`nice` on the browser. Record the red run in evidence before
   any fix. If a probe instead shows the product really misbehaves (the check never pops, the morph hard-cuts, the
   grid item never gets a box), stop and escalate - do not fix the product here.
2. **`:562` -> `expect.poll` on the motion log** for a `motion-enter` record whose target includes `motion-pop`, with the
   default expect timeout (no larger timeout). Control: removing the pop class/animation from the check -> red.
3. **`:487` -> state-based morph assertion.** Wait (poll) until the chart has settled on the new data (final sum stable
   and the zrender clock finished after having gone unfinished after the refresh click), then assert: the data changed;
   the zrender animation clock went unfinished after the refresh (a hard cut with animation disabled never does - verify
   that empirically under the hard-cut mutation); at least one sampled frame lies strictly between old and new; and no
   frame collapses toward zero (min/settled > 0.4, unchanged). The exact form is the executor's call, but it MUST be
   shown red under a hard-cut mutation (update animation disabled / duration 0) and under the Off/reduce mode controls
   where they apply. Rejected: just lowering `>= 2` to `>= 1` with no other signal (weaker than needed if a single
   stray frame could satisfy it; acceptable only combined with a second, hard-cut-proof signal).
4. **`hel1260 :108` -> settled box helper.** Poll until the item's `boundingBox()` is non-null and equal (within 0.5 px)
   across two consecutive reads one animation frame apart (or until the item's `getAnimations()` have all finished),
   for both `rectBefore` and `rectAfter`; drop the fixed 500 ms wait if it becomes redundant. Apply the same helper to
   the sibling orphan test in the same file (lines ~89/94), which has the identical pattern.
5. **Pattern sweep.** Inspect the rest of `hel1584-motion-surfaces.spec.ts`, `hel1573-motion-grid-chart.spec.ts` and
   `hel1573-motion-primitives.spec.ts` for a log read once immediately after a visibility wait, or a frame/sample count
   inside a fixed window. Fix those that clearly share the defect with the same state-based technique; list the rest
   (with reason) in the PR body. Fixed-time waits used to let something *not* happen (negative assertions, e.g. "no
   entrance on warm switch") are legitimate and stay.

## Risks / Trade-offs

- [Throttle harness differs from CI] -> reproduce red under throttle AND keep the CI failure lines as corroboration.
- [State wait masks a real hang] -> polls use default expect timeouts, so a never-arriving state still fails.
- [Weakened morph check] -> hard-cut mutation red run is mandatory evidence.

## Planner Notes

- Self-approved: test-only, no escalation-worthy decisions. `skip_specs: true` because no behavior changes.
- Scratch: `/home/matt/Development/helio/.concertino/scratch/HEL-1658/` only; durable evidence in
  `/home/matt/Development/helio/.concertino/runs/HEL-1658/evidence/`.
