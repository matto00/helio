## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 81b51b37d096f3e46d9f36b6c3ae5d0906840b6d (artifacts untracked in the change dir). Nothing was run: no servers, no Playwright. This is a reading of the code and the plan.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/hel1573-motion-timing-flakes/hel-1814`.
- **Failure A location:** the ticket's `:209` matches `e2e/support/hel1573-motion-primitives.ts:209`. The `rail`/`segmented` loop (lines 205-212) requires at least one `motion-indicator` `transform` record. Lines 96-100 click Compact right after `toBeVisible()`, with no wait for the indicator container to settle.
- **H-A1 is plausible from the code.** In `frontend/src/shared/motion/useIndicatorSlide.ts:42-57`, a placement made while `data-indicator !== "ready"` is a `snap` (no transition), and `ready` lands two rAFs later. `ThemeProvider.tsx:73` gives `effectiveMotion` "full" by default, and the saved choice here is also full. So only the first placement after `/settings` mounts arms `snap`. A preference load does not re-arm it, which means the design's "Motion preference loads after first paint ... re-arming snap" overstates that path. Under load, a click inside those two rAFs moves the indicator with no transition. That is correct app behaviour, and the fix belongs in the test.
- **H-A2 is plausible from the code.** In `e2e/support/motionRecorder.ts:127-138`, the `transitionrun` handler records only from `target.getAnimations()` and has no fallback. The `animationstart` handler has one (lines 98-123), for exactly the same "already gone under load" case.
- **Mutation A is representative and reaches the rewritten assertion.** It removes `[data-indicator="ready"] .motion-indicator { transition: ... }` (`motion.css:52-57`). The `ready` attribute is still set by JS, so a new `ready` wait still passes. The computed `transition` falls back to `all 0s`, and no `transitionrun` for `transform` fires. Both the computed-value check and the "one observed event" check therefore go red. The loop runs `rail` first, so the red shows at the rail iteration of the same shared assertion. That is acceptable.
- **Failure B location:** `e2e/hel1573-motion-grid-chart.spec.ts` checks `later` spans `< 600` at the end of the test (the ticket's line 257). The order in the test body is: entrance `>150`/`<600` → bar-collapse guard → `applied` toEqual `{0, 280, cubicOut}` → type-change replay (`longestSpanMs < 60`, `barGrowMinRatio`) → `later` spans `< 600`.
- **Mutation B (`chartAppearance.ts:334-343` returning library defaults) is representative of pre-HEL-1573.** The comment at line 322 says the old behaviour was the ECharts 1000ms default. It turns the entrance check red, because the entrance check runs first.
- **The fix shapes do not weaken Failure A.** The `ready` precondition is a real user-reachable state. The duration/easing asserts are kept. One observed event is still required. A fallback record reads computed values only for a transition that fired.

### Verdict: REFUTE

The plan is mostly sound, and leaving the fix shape open until the probe settles the root cause is correct under the debugging law. Two gaps remain in Failure B. Each could let the rewrite weaken an assertion or claim mutation coverage it does not have, so both need fixing in the artifacts now.

### Change Requests

1. **Design Decision 3: keep the entrance's lower bound (proof that the entrance runs) explicitly.** Decision 3 gives the entrance check "the same treatment" as the update check, and the update check is an upper bound only ("each <= the token"). Read literally, that drops `expect(entrance).toBeGreaterThan(150)`, and with it the half of the title "the entrance runs about the standard token". An implementation that closed the entrance (`animationDuration: 0` on first mount) would then pass. Revise Decision 3 (and task 2.2) to require one of these:
   - keep `entrance > 150`. It is not exposed to slow hosts in the failing direction, because load only lengthens spans.
   - assert that at least one entrance animator has a configured duration of about 280ms (`|d - 280| < 1`), not only `<= token`.

2. **Design Decision 4 / tasks 2.4: the `later` replacement is never reached by mutation B, so its red is unproven.** Under mutation B the test fails at the entrance check, and the `applied` toEqual and `replay.longestSpanMs < 60` fail before the `later` check too. Whatever replaces the `later < 600` span is never executed under the mutation, so the "chart test red" output says nothing about it. Revise to require that each mutation `.txt` names the assertion that failed (file:line and message), and handle the `later` replacement in one of these ways:
   - move the refresh-window update check (configured update-animator durations <= token) ahead of the `applied` toEqual, and add a mutation that reaches it, for example `animationDurationUpdate: 1000` with `animationDuration` logic untouched. Note that `applied` would still catch this first unless the check is ordered ahead of it.
   - state explicitly that this check is a guard already covered by `applied.animationDurationUpdate === 280` and `replay.longestSpanMs < 60`, label it as a guard in the spec comment (as the existing bar-collapse guard already is), and do not claim mutation coverage for it.

   For mutation A, the `.txt` must likewise show a failure at the indicator transition assertion, not a timeout in a new `ready` wait.

3. **Design Decision 2(b): spell out what a fallback record looks like so Subtle/Off cannot regress.** Name the fallback's `moves` value and `kind`, and how its duration is parsed from the computed `transition-duration` list indexed by `transition-property`. `moves` cannot be read from keyframes once the transition is gone. If `moves` is guessed as `true` for `transform`, Subtle/Off depend on the parsed duration being `<= 0.01ms`. Task 2.6 then needs to cover Subtle and Off for the primitives parts (every `hel1573-motion-primitives-*.spec.ts`) as well as the other `motionRecorder` importers. Spell this out so the executor does not stop at the Full part.

### Non-blocking notes

- H-A1 wording: with the default full and a saved full, a later preference load or ResizeObserver re-measure does not re-arm `snap` once the container is `ready` (`useIndicatorSlide.ts:42-44`). Only the first placement after mount (or after `hidden`) snaps. The probe should record the click time relative to the second rAF, not look for a re-arm.
- The `ready` wait should be bounded, with a message, and apply to the rail too if the probe shows the same race. Decision 2(a) already covers this.
- `tasks.md` has an empty "Standing Constraints" heading. Fill it in or delete it.
- Feasibility of capturing zrender animator durations: the recorder finds the instance only by rAF polling after mount, so entrance animators may already exist when it first sees the chart. The probe should read the live animator list on first discovery as well as hooking new ones, or Decision 3 falls back to the wall-clock bound.
