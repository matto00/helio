## Context

See proposal.md - Why. Facts gathered at planning:

- CI log, main run 44873260203 job 136752280174: `✘ hel1790-hover-probe.spec.ts:27:7 ... (dark) (4.0m)`;
  `Error: page.waitForFunction: Test timeout of 240000ms exceeded` at `hel1790-hover-probe.spec.ts:37:16`. Line 37 is the
  sweep wait (rAF polling for `.mobile-step-sheet .ui-select__trigger` with `top <= 360 && bottom >= 366`), not the
  `noAnimations` wait (line 20). Light passed in the same leg (8.3 s).
- The `playwright-report-shard-4` artifact of that run holds the dark case's `trace.zip` and `error-context.md`;
  downloaded to the MAIN checkout's `.concertino/scratch/HEL-1813/ci-main/` (`tr/` is the unzipped trace). In it:
  the `.spine-row__select` click ended at 612025 ms, "Wait for function" started at 612026 and never ended; the
  error-context snapshot shows the "Step editor" dialog open with the Filter step's comboboxes. So the sheet opened and
  the condition was never observed true. The PR #1197 failing job (run 44803300832, job 136532369427) has not yet been
  examined; its artifacts may also hold a trace.
- The sheet enters with a CSS animation, `bottom-sheet-in` (`translateY(100%)` → none), in
  `frontend/src/shared/motion/BottomSheet.css`; `:root[data-motion="subtle"]` swaps it for a fade (no travel). The
  spec sets the theme via `openPipeline(page, pipelineId, theme)` in `e2e/support/hel1582Phone.ts`.
- Leading hypothesis (NOT confirmed): the condition holds only while the trigger's top is in [366 - height, 360], a band
  about (trigger height - 6) px wide (roughly 30 px), in the middle of a 280 ms ease-out slide over about 828 px
  (`theme.css` motion tokens).
  With `polling: "raf"` the predicate is sampled once per frame; on a slow or janky runner one frame can carry the
  trigger from below y=366 to above y=360 (or a stall can land the slide outright), after which the trigger rests above
  the pointer row and the condition can never become true again, so the wait runs to the test timeout. Alternatives
  the probe must eliminate: the sheet not sliding at all in that run (motion setting, reduced motion, fade entrance);
  the trigger at rest still straddling or never reaching the row (a geometry difference between themes, e.g. a font or
  border that changes layout height); the selector matching a different element; the page context stalling.

## Goals / Non-Goals

**Goals:** a probe-confirmed root cause consistent with the CI trace; a forced condition reached deterministically; every
wait bounded by a short explicit timeout with a diagnostic message; the guard still red under the HEL-1790 mutations.

**Non-Goals:** product CSS/JS changes; changing the behaviour of `hel1675-shared-hover.spec.ts` or
`hel1735-feature-hover.spec.ts`; retries or timeout increases.

## Decisions

1. **Probe before fix (systematic-debugging law).** Step 0 is trace-first: extract from the CI trace what the page did
   during the wait (screencast frames' timestamps after the click, any console/page errors, the DOM snapshots' trigger
   box and the sheet's computed animation, the `data-motion` / theme attributes on `:root`). Also download the PR #1197
   failing job's artifacts if they exist. Then instrument the sweep locally: record per rAF frame the trigger's
   `top/bottom`, frame timestamp and delta, the sheet animation's `currentTime`/`playState`; record the largest per-frame
   travel across that band and compare it with the band width (measured, not assumed); check the theme discriminator
   explicitly (dark is the file's first test, so cold first-load jank on its worker is a candidate); and reproduce the miss (natural rate stated, including 0/N; then a forced variant,
   e.g. CDP `Emulation.setCPUThrottlingRate` or a main-thread stall during the slide, only to test the named
   hypothesis). The named cause must explain why dark and not (or less often than) light, or state with evidence that
   theme is not the discriminator (e.g. per-theme order/load in the leg).
2. **Red first, committed.** Commit a red demonstration (a probe that shows the unbounded wait hanging or missing the
   window under the forced condition, with its output as a `.txt` file) before the fix commit. `*.log` is gitignored.
   The probe code must not run in CI from the red commit: either place it where Playwright's `testDir: ./e2e` default
   match does not pick it up (e.g. under `.concertino/runs/HEL-1813/evidence/` with its output), or make it a temporary
   spec variant that the fix commit removes, and say which.
3. **Fix preference: make the forced condition deterministic, not sampled.** Preferred: control the slide through the
   Web Animations API (find the sheet's `bottom-sheet-in` animation, pause it, seek `currentTime` to a point where the
   trigger provably straddles the pointer row, move the mouse there, then resume) so the "mouse event while the trigger
   is under the pointer" ingredient never depends on frame timing. **The capture must be race-free.** Preferred (design gate round 2): before the click, inject a style rule such as
   `.ui-modal.bottom-sheet[open] { animation-play-state: paused !important }`, so the animation is created paused at
   currentTime 0 regardless of frame timing; then seek it and `play()` it. An `animationstart` listener is weaker: the
   event fires in a later frame's update, so a long stall can let the slide finish first. Looking the
   animation up from the test after `click()` returns (a Node-to-page round trip that jank stretches) races a 280 ms
   slide, and a finished CSS animation is no longer returned by `getAnimations()`. So install the capture in the page
   BEFORE the click, e.g. a capturing `animationstart` listener on `document` filtered to
   `animationName === "bottom-sheet-in"` that pauses the animation synchronously (or an equally argued mechanism that
   cannot miss it). If the animation is never captured, or has already finished, the spec fails fast with a message
   naming that state (Decision 4). Alternatives the executor may choose with justification: waiting on a condition that
   stays true once reached. Rejected: simply widening the band, raising the
   timeout, or retrying, since each still samples a moving target. Whatever is chosen, it must still produce what the
   HEL-1790 guard forces: the trigger `:hover` (or transitioning from hover) when the slide lands, under the main-thread
   stall, so that a pre-fix rest read can return hover paint.
4. **Fail fast.** Every `waitForFunction`/poll in the spec gets an explicit timeout (seconds, not minutes) and a
   message, or a predicate that throws a descriptive error naming the observed state (trigger rect, animation state).
   Worst-case runtime of the file must be well under 240 s; measure it. If the probe places the cause in app code, STOP
   and report (the orchestrator escalates; a product change is not in this ticket's scope).
5. **Keep the guard's teeth.** `expect(early).toBe(settled)` stays. Re-run both HEL-1790 mutations
   (`settleToRest` → no-op, `settleToRest` → `noAnimations` only) against the fixed spec and show red. **Threshold:**
   each mutation is red in every run, in each theme, over N >= 5 runs per theme; if not achieved, its red rate must be
   at least the HEL-1790 baseline (noAnimations-only 7/10, no-op 3/6; archived HEL-1790 `skeptic-final-1.md:66-68`) with
   the shortfall explained. `e2e/support/hel1790Rest.ts` changes only if needed, and then both of its other consumers,
   `hel1675-shared-hover.spec.ts` and `hel1735-feature-hover.spec.ts`, must still pass in full. Confirm the main-thread
   stall (`top <= 250` trigger) still fires with whatever geometry or seek point the fix uses.

## Risks / Trade-offs

- [Seeking a paused animation does not trigger a hover refresh the way a live sweep does] → verify with the probe
  that `:hover` turns on as in the live sweep (the mutation going red is the proof).
- [Local machine cannot reproduce the CI miss] → forced condition (CPU throttle / stall) labelled as such, natural rate
  stated; the deterministic fix removes the timing dependency either way.
- [Subtle motion mode: fade with no travel] → the spec must assert the entrance it relies on, failing fast if absent.

## Planner Notes

- Lane DB `helio_hel1813`; lane servers via `scripts/concertino/start-servers.sh` with `ANTHROPIC_API_KEY` exported empty
  and `DATABASE_URL` pointing at the lane DB; Playwright 2 workers total, `nice -n 19`.
- Stability AC: `--repeat-each=10` over the 2-test file (20 runs) at `--workers=2`, all green, with the per-test max
  duration reported.
