## Context

Both failures are on CI only (one leg each, retries included). Local dev boxes are faster than GitHub runners; the
HEL-1789 runner record (`cpu_model:` line in each e2e job log, artifact `e2e-runner-shard-<n>`) names each leg's CPU.
HEL-1808 and HEL-1813 reproduced timing-only flakes locally with CDP `Emulation.setCPUThrottlingRate` (4x/6x).

**Failure A** (`hel1573-motion-primitives.ts`, Full/dark, run 44876631920 leg 3): `r.segmented` holds no
`motion-indicator` `transform` record (0 >= 1 fails). The later fit check (`segFit`, |dx|,|dw| < 1.5) passed, so the
indicator ended in place -- it moved without a recorded transition. Hypotheses, to be settled by probe, not assumed:
- H-A1 (test race): `useIndicatorSlide` places with `data-indicator="snap"` (no transition) and sets `ready` two rAFs
  later. With Motion full (default and saved), only the first placement after `/settings` mounts (or after `hidden`)
  snaps; a later preference load or ResizeObserver re-measure does not re-arm it once `ready`. If the Compact click
  lands inside those two rAFs, the move is a snap -- correct app behaviour, no transition. The probe times the click
  against the second rAF (the `data-indicator` value at click time).
- H-A2 (recorder race): `motionRecorder.ts`'s `transitionrun` handler reads `target.getAnimations()`; on a long frame
  the 280ms transition can be finished and removed before the queued event is dispatched, so nothing is recorded. The
  `animationstart` handler already has a fallback for exactly this; `transitionrun` has none.

**Failure B** (`hel1573-motion-grid-chart.spec.ts:257`, run 44854332613 leg 4): `later` = every unfinished->finished
span of the zrender animation clock after the refresh (refresh update tween, a resize rebuild, the test's own
`setOption` type-change replay). A span is wall-clock between two rAF samples; 616ms > 600. Hypotheses: H-B1 long
frames stretch one 280ms tween; H-B2 two tweens (e.g. the refresh's option arriving in two commits, or resize + update)
run back to back and merge into one span. The entrance bound (`entrance < 600`, line ~146) measures the same way and is
equally exposed.

## Goals / Non-Goals

**Goals:** a stated, probe-confirmed root cause per failure; assertions that prove the HEL-1573 contract without
wall-clock dependence where possible; 20/20 local passes per spec under 2 workers and `nice -n 19`, plus a run under
CPU throttling; each spec red under its mutation.

**Non-Goals:** app changes (escalate if the cause is in the app); other flaky specs; sibling lanes' files.

## Decisions

1. **Probe first (systematic-debugging law).** Before any fix, reproduce each failure (CPU throttling 4x-6x via CDP on
   the page, or a loop) and instrument to discriminate the hypotheses: for A, record `data-indicator` at click time and
   whether a `transitionrun` for `transform` fired with/without a live `CSSTransition`; for B, record each span's
   frame count and frame intervals and which `setOption`/update produced it. The red runs are committed as `.txt`
   before fix code (C12). If no reproduction is reachable after the debug budget, state the root cause from code +
   CI evidence explicitly as unreproduced and escalate rather than guess.
2. **Failure A fix shape** (final choice follows the probe): (a) wait (bounded, with a message) for the density
   radiogroup's indicator container to be `data-indicator="ready"` before clicking Compact (same for the rail before its
   navigation if the same race applies); (b) prove the transition by what the element is configured to do -- the
   indicator's computed `transition-property` includes `transform` with `transition-duration` 280ms and the ease-out
   curve while `ready` -- plus one observed transform transition on `.motion-indicator`, recorded even when the
   `CSSTransition` object is already gone. Keep the existing duration/easing asserts on the record.
   **Recorder fallback record (only if the probe confirms H-A2)**, in `motionRecorder.ts`'s `transitionrun` handler,
   used only when no live `CSSTransition` matches `event.propertyName`: `kind: "css-transition"`, `inferred: true`,
   `name`/`props` = `[event.propertyName]`; `duration`, `delay` and `easing` read from the target's computed
   `transition-duration` / `transition-delay` / `transition-timing-function` lists at the index `i` of
   `event.propertyName` in the computed `transition-property` list (falling back to the index of `all`; each list
   indexed `i % length`, as CSS repeats short lists; values in `s` or `ms` converted to ms, the same `ms()` parser as the
   `animationstart` fallback); `moves` = `MOVING.includes(event.propertyName)` -- conservative: a fallback transform
   transition counts as moving, so Subtle/Off's "no moving transition longer than 0.01ms" stays at least as strict and
   depends on the parsed duration (0.01ms there). If the computed lists have no entry for the property, record nothing
   (never invent a duration).
3. **Failure B fix shape** (final choice follows the probe): prove "the entrance runs about the token, once" and "an
   update never replays it" from what ECharts configured rather than a wall-clock span where feasible:
   - **Entrance (keeps a lower bound).** Either keep `expect(entrance).toBeGreaterThan(150)` (a slow host only
     lengthens spans, so it is not exposed in the failing direction), or assert at least one entrance animator with a
     configured duration `|d - 280| < 1`; at least one of these MUST remain, so a chart whose entrance is off (0ms)
     fails. The upper bound becomes a configured-duration check (every entrance animator `< 1000`, i.e. not the library
     default) if the animators are readable -- the recorder finds the chart only by rAF polling after mount, so the
     probe must read the existing animator list on first discovery as well as hooking new ones -- otherwise a wall-clock
     upper bound stays below 1000ms with its margin justified by measured CI/throttled frame times, written next to it.
   - **Refresh/update (`later`).** The rewritten post-refresh check (configured update-animator durations <= token, or
     a justified generous span) is labelled in the spec comment as a GUARD, like the bar-collapse guard: its contract is
     already proven by `applied` (`animationDurationUpdate === 280`, `animationDuration === 0`) and
     `replay.longestSpanMs < 60`, which run before it. No mutation coverage is claimed for it.
   - Keep the bar-collapse ratio guard and the `applied` toEqual unchanged.
4. **Mutations (pre-HEL-1573 behaviour), each run and committed as red `.txt`; each `.txt` must name the assertion that
   failed (file:line and message) -- a timeout in a new wait does not count:**
   - A: drop the `[data-indicator="ready"] .motion-indicator { transition: ... }` rule in
     `frontend/src/shared/motion/motion.css` (no indicator slide, as before HEL-1573). The Full primitives test must
     fail at the indicator transition assertion (the rail iteration runs first, acceptable), not in the `ready` wait.
   - B: make `frontend/src/utils/chartAppearance.ts` return the library defaults (no `animationDuration`/
     `animationDurationUpdate` override, i.e. 1000ms entrance and replays). The chart test must fail at the rewritten
     entrance assertion. Mutations are reverted; never committed to source.
5. **Verification:** each full spec file passes 20 times in a row (`--repeat-each` or a loop), Playwright 2 workers
   total, `nice -n 19`, lane DB `helio_hel1814`, backend with `ANTHROPIC_API_KEY` empty. Also one 20x (or at least 5x)
   run of each under CPU throttling to show the fix holds on a slow host.

## Risks / Trade-offs

- Replacing a wall-clock check with a configured-value check could pass while the animation never runs; mitigated by
  keeping one observed event per primitive and by the mutations.
- A recorder fallback could mask a real regression; it reads only computed values of a transition that did fire.
- CPU throttling may not reproduce the CI cause; then the root cause is argued from CI artifacts and stated as such.

## Planner Notes

- Self-approved: test-only change, `skip_specs: true`; recorder fallback lives in `e2e/support/motionRecorder.ts`,
  shared by other HEL-1573/1584 specs -- the executor must run every spec importing it (grep) to show no regression.
- Self-approved: CPU throttling is an evidence tool only, not added to the committed specs unless the probe shows it is
  the only way to make the assertion meaningful (then justify in design notes).
