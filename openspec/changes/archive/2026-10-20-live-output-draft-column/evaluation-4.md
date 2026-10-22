## Evaluation Report — Cycle 4 (evaluation-4.md)

Reviewed commit: `4eab42cdea227840196f0c828a4ac7a9d500f89b`. This review covers only what changed since `97f1d207c`, the squash plus archive: the `useIdleCoalesced` hook and two comment fixes.

### Phase 1: Spec Review — PASS

- Constraint C7 (the latency budget with a chart Output on screen) is met again. The numbers are below.
- C2: `hel1631-draft-mode.spec.ts` is unchanged and green.
- C3 (network contract) is unchanged; reasoning in (c) below.
- Both stale comments are fixed: the hel1668 header (now 1280x840) and `PipelineSpineLayout.css:24-25`.

### Phase 2: Code Review — PASS

Gates, run fresh by me:

| Gate | Result |
|---|---|
| lint, format:check, typecheck | all exit 0 |
| build | exit 0 |
| Targeted jest (`HELIO_JEST_MAX_WORKERS=2`): liveOutput, useIdleCoalesced, PipelineDetailPage, PipelineMobile, usePipelineDraft | 27 suites, 408 tests, all passed |
| e2e (flock, `--trace retain-on-failure`): `hel1631-draft-mode` + `hel1632-live-output` | 27/27 passed. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/c4-e2e.log` |

The coalescing test can fail. In a throwaway worktree (since removed) I replaced `useIdleCoalesced` with an identity function, `return value`. `LiveOutputColumn.test.tsx` "coalesces a burst..." then failed (1 of 12).

**(a) Throttle claim: confirmed at 2.5x.**

I added a CPU-throttle hook only in the throwaway worktree copy of the specs; the branch is not modified.

| Test | Throttle | Per-edit ms | Max of edits 2-10 |
|---|---|---|---|
| hel1631 :177 | none | 10.5, 4.7, 4.4, 4.4, 14.7, 13.3, 14.2, 13.0, 12.9, 12.7 | 14.7 |
| hel1632 :259 (step count) | none | 9.1-18.1 | 18.1 |
| hel1631 :177 | 2.5x | 55.1, 35.7, 34.5, 34.8, 34.0, 32.5, 32.4, 32.4, 31.5, 27.4 | 35.7 |
| hel1632 :259 (step count) | 2.5x, 4 runs | first edit 56.8-58.0 | 45.1 / 41.6 / 43.0 / 41.0 |

- Unthrottled, both tests pass.
- At 2.5x, hel1631's band matches main CI's 28-46ms, and both tests pass.
- I did not run at 4x, so the claim that 4x fails even for an untouched hel1631 is unverified by me.
- **Headroom is thin.** At 2.5x, hel1632's edits 2-10 stay 5-9ms under the 50ms budget. CI is the real measurement, so watch the next CI run.

**(b) The ~9ms per edit from the fixture: unverified.**
- Unthrottled, the hel1632 step-count latency (9-18ms) sits about 4-9ms above hel1631's (4-15ms), so a fixture-dependent cost exists.
- I did not attribute it against `c1add2394`. hel1632's fixture asserts the live column before the burst, so it cannot run on main as is.

**(c) Coalescing correctness:**
- **Coalescing works.** Each new value cancels the pending timer and idle callback, so a burst produces one render of the latest value. The unit test shows this and the mutation check backs it.
- **Selection is immediate.** `LiveOutputColumn.tsx`: `shown = coalesced.selectedStepId === selectedStepId ? coalesced : fresh` renders the fresh inputs on a step change. The component test asserts it.
- **Unmount is safe.**
  - The effect cleanup clears the timer and calls the current `cancelIdle`. That is a `let` reassigned inside the timer, which the cleanup closure reads at cleanup time.
  - No `setShown` can run after unmount.
  - Without `requestIdleCallback` (jsdom), `run()` executes inside the timer, which is also cleared on cleanup.
- **The network contract is unchanged.**
  - The saved-rows and baseline hooks only read on Output and id changes, never per edit.
  - Coalescing delays when the view sees a change but adds no reads.
  - The hel1632 e2e still passes its one-history-read and zero-requests-during-burst assertions.
- **Nothing stays stale forever.** Once changes stop for 120ms, the latest value is shown, within at most 200ms more through the idle timeout.

**Non-blocking caveats:**
1. **The 1500ms cap is not reliable in a real browser.**
   - `MAX_WAIT_MS` caps the timer delay, not the render. After 1.5s the wait drops to 0, but the render still goes through `requestIdleCallback` (200ms timeout), and every newer value cancels that callback.
   - So an unbroken stream of changes less than about 200ms apart never shows an intermediate value until it pauses.
   - The unit test "still updates now and then" runs without `requestIdleCallback`, so it does not cover this path.
   - Fix: call `setShown` directly, skipping `whenIdle`, once `pendingSince + MAX_WAIT_MS` has passed. Or reword the doc comment.
   - It is not a correctness problem: the stream ends, and the latest value then shows.
2. **The view sees `page.runStatus` coalesced.** A run that went `succeeded` → (another run) `succeeded` with every intermediate status inside one 120ms quiet window would skip the post-run baseline refresh and the saved-rows clear. Real runs take seconds and status changes are spaced, so the risk is low.

### Phase 3: UI Review — PASS (UX judgment below)

Measured input → live-Output update:
- 141.9-159.8ms unthrottled;
- 168.0-196.9ms at 2.5x.

That is consistent with the claimed ~140-230ms.

**Is it acceptable against DESIGN.md §11? Yes, as a listed trade-off, not a defect.**
- The ticket's acceptance criteria and the owner's perf ruling constrain the step count and preview update (edit 1 < 100ms, edits 2-10 < 50ms). They put no budget on the Output render.
- design.md D6 already sanctioned this exact fallback ("coalesces the column's render to at most one per animation frame / idle callback ... the fix must keep the budget, not relax it").
- About 150-200ms after the user pauses reads as responsive for a chart.

Owner-visible cost: for about 150-200ms after each edit, and for the whole of a continuous typing burst, the column still shows the "live" marker on the previous draft's frame.
- §11 (a [judgment] rule) says "live" appears only on a surface recomputed from the current draft.
- This is a transient, bounded lag rather than a misuse of the marker.
- It is cheap to close: render the header marker from the fresh inputs, showing "updating" while `coalesced !== fresh` for draft changes. The marker is not the expensive part.
- I recommend listing the ~150-200ms lag in the PR's "Reversible UI calls", together with that follow-up.

### Overall: PASS

### Non-blocking Suggestions
- `useIdleCoalesced.ts`: honour `MAX_WAIT_MS` by skipping the idle wait once the cap has passed (caveat 1), and cover that path with a test that stubs `requestIdleCallback`.
- `LiveOutputColumn.tsx`: drive the marker from the uncoalesced source, so a pending draft change reads "updating" rather than "live" (§11).
- Watch the next CI run of `hel1632-live-output.spec.ts:259`: local 2.5x headroom on edits 2-10 is only 5-9ms.
