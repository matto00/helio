## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD: `4eab42cdea227840196f0c828a4ac7a9d500f89b`. Scope: the delta `97f1d207c..4eab42cde` only. Rounds 1 and 2 CONFIRMed everything before that.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY`, and the branch matches.
- **Delta contents:** `git diff --stat 97f1d207c..HEAD` shows 6 files:
  - the new `hooks/useIdleCoalesced.ts` and its test;
  - `LiveOutputColumn.tsx`, now split into a coalescing wrapper and `LiveOutputColumnView`, with `useDeferredValue` removed;
  - one new component test;
  - two comment-only fixes, in the `e2e/hel1668-schema-panel-copy.spec.ts` header and `PipelineSpineLayout.css:24-25`.
- **Hook logic (read cold):**
  - The effect depends on `[value, shown]`. Every new value's cleanup clears the pending timer and the idle callback, so a burst costs one `setShown` of the latest value.
  - `wait = min(QUIET_MS, remaining MAX_WAIT)`.
  - When `requestIdleCallback` is missing (jsdom, Safari), the hook runs immediately after the timer.
  - Selection bypass: `shown = coalesced.selectedStepId === selectedStepId ? coalesced : fresh`. A step change renders fresh inputs at once.
  - The "Displayed Output" pick is local `useState` inside the view and is not coalesced, so the Select responds immediately.
- **Design sanction:** design.md D6 explicitly allows this fallback: "coalesces the column's render to at most one per animation frame / idle callback ... the fix must keep the budget, not relax it." The budget was not relaxed: the hel1631 spec is unchanged, and hel1632 still uses the same thresholds.
- **Fresh jest run (mine):** `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm --prefix frontend test -- --testPathPatterns='useIdleCoalesced|liveOutput/LiveOutputColumn'` gave 3 suites and 22 tests, all passed.
- **The test can fail:** the evaluator reports that replacing the hook with an identity function fails the "coalesces a burst" test. That is consistent with the test as I read it: it asserts that "60" persists after 4 edits at 30 ms each, then that "30" appears after 500 ms.
- **e2e:** the evaluator's log `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/c4-e2e.log` ends with `27 passed (1.5m)`. Its pasted per-edit latency table is concrete and unambiguous, so I relied on it and did not re-run Playwright. lint, format, typecheck and build were also pasted as exit 0.
- **UI:** the delta has no visual change. There is no new markup, class or token, and the CSS change is comment-only. Rounds 1 and 2 covered the light/dark screenshot review, so I took no new screenshots.

### Caveat (1): "live" marker on the previous draft's frame during the coalescing window

**Ruling: an acceptable, listed trade-off, not a defect.**

- §11 requires "live" only on a surface recomputed from the current draft. The intent is that "live" must never mark saved, stale or not-previewed data. That intent holds: the frame under the marker *was* recomputed client-side from the draft, just one keystroke behind, for about 120-320 ms.
- The marker and the body it labels stay consistent. Both come from the same coalesced `model.source`, so the marker never claims a different frame than the one drawn.
- The round 1 and 2 build had the same property through `useDeferredValue`, where the marker was also read from `deferred.source`. Two prior CONFIRMs accepted it.
- The proposed fix would make things worse during typing. Driving the marker from uncoalesced inputs and showing "updating" while a change is pending would flip the marker live→updating→live on every keystroke burst. A flickering status dot is worse UX than a sub-perceptual lag.
- The same transient applies after Discard: the draft frame and its "live" marker can persist for about one coalescing window. This is the same class of lag and is acceptable for the same reason.

### Caveat (2): MAX_WAIT_MS with requestIdleCallback

- The caveat is real: once the cap is reached, `wait` is 0, but each new value still cancels the scheduled idle callback.
- In practice the main thread is idle between keystrokes, so the idle callback almost always fires before the next edit. The `{timeout: 200}` bounds it once it is scheduled.
- The only consequence is that the column may not refresh during a continuous, very fast stream until the stream stops. That is cosmetic: nothing is lost, and the last value always lands.
- Not blocking.

### Verdict: CONFIRM

### Non-blocking notes

- `useIdleCoalesced.ts`: skip the idle wait (call `run()` directly) once `pendingSince + MAX_WAIT_MS` has passed, so the cap is real when `requestIdleCallback` exists. The current "still updates now and then" test runs without `requestIdleCallback` in jsdom and does not cover that path.
- The latency headroom is thin: at 2.5x CPU throttle, hel1632's edits 2-10 run 41-45 ms against a 50 ms budget. CI is the real measurement, so watch the next CI run's hel1632 :259 and hel1631 :177 numbers.
- The view sees `page.runStatus` coalesced as well (evaluator note 2). The risk is low because real runs take seconds.
