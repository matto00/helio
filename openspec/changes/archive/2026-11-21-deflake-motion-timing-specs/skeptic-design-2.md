## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 81b51b37d096f3e46d9f36b6c3ae5d0906840b6d. The change dir is untracked. Nothing was run: no servers and no Playwright, as the design gate and the driver constraints require. This is a reading of the artifacts against the code.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/hel1573-motion-timing-flakes/hel-1814`.
- **Round-1 CR1 (keep the entrance's lower bound): resolved.** Design Decision 3 now says "Entrance (keeps a lower bound)". It requires either `entrance > 150` (today at `e2e/hel1573-motion-grid-chart.spec.ts:151`) or an entrance animator with a configured duration where `|d - 280| < 1`, and says "at least one of these MUST remain". Task 2.2 repeats the requirement. A chart with its entrance closed now fails.
- **Round-1 CR2 (the `later` replacement is unreachable under mutation B): resolved through the guard option.** Decision 3 labels the post-refresh check as a GUARD in the spec comment, like the bar-collapse guard at spec:190. Its contract rests on `applied` (spec:203) and `replay.longestSpanMs < 60` (spec:249), both of which run earlier, and the design claims no mutation coverage for it. Decision 4 requires each mutation `.txt` to name the failing file:line and message, and it states that a timeout in a new wait does not count. For A, the red must land at the indicator transition assertion and not in the `ready` wait.
- **Round-1 CR3 (specify the fallback record): resolved.** Decision 2 specifies the following:
  - `kind: "css-transition"` and `inferred: true`, with `name`/`props` set to `[propertyName]`.
  - duration, delay and easing come from the computed lists at the index of the property in `transition-property` (falling back to the index of `all`), indexed `i % length`, and parsed with the same `ms()` parser.
  - `moves = MOVING.includes(propertyName)`.
  - when the property has no entry, nothing is recorded.

  I checked this against `e2e/support/motionRecorder.ts`. `MOVING` (line 27), `inferred` (line 19), the `ms()` parser and the `i % length` indexing (lines 106-118) all exist in the `animationstart` fallback. The `transitionrun` handler (lines 127-138) has no fallback today.

  With `moves = true` for `transform`, Subtle and Off go through `expectInstantOrStill` (`hel1573-motion-primitives.ts:138-144`, which filters `moves && slow(r)`). Those modes then depend on the parsed duration, which is 0.01ms there. That is at least as strict as today. Task 2.6 now covers every `hel1573-motion-primitives-*.spec.ts` (the two files `-full-subtle` and `-off-reduce-snap`) and every other `motionRecorder` importer. Grep finds `hel1584-motion-surfaces.spec.ts`, `hel1573-motion-grid-chart.spec.ts`, `support/hel1573-motion-primitives.ts` and `support/motionPrimitivesSeed.ts`.
- **Round-1 non-blocking notes: addressed.**
  - The H-A1 wording now says "only the first placement after mount (or after `hidden`) snaps", and the probe times the click against the second rAF.
  - The `ready` wait is bounded and has a message.
  - The empty "Standing Constraints" heading is gone from tasks.md.
  - The probe reads the existing animator list on first discovery.
- **Failure locations match the code:**
  - The segmented loop is at `hel1573-motion-primitives.ts:205-212`, and the message at :209 is `${key} indicator transform transition`. The click comes straight after `toBeVisible()` (lines 96-100).
  - The chart `later` bound is at spec:257, and the entrance bounds are at :151-152.
- **On the design's own merits:**
  - The fix shape is explicitly contingent on a probe that discriminates the hypotheses (H-A1/H-A2, H-B1/H-B2). This follows `systematic-debugging`.
  - If no reproduction is possible, the plan escalates rather than guessing.
  - Mutation A (drop the `ready` transition rule) leaves the JS-set `ready` attribute in place. The new wait therefore passes, and both the computed-transition check and the observed-event check go red.
  - Mutation B (library defaults, 1000ms) turns the entrance check red first, whether that check is the configured `< 1000` or the wall-clock upper bound kept below 1000.
  - The ACs are covered: root cause per spec (1.4), 20x with 2 workers and `nice -n 19` (2.5), and a red mutation per spec (2.3/2.4).
  - The work stays inside the scope of the e2e files, and app changes are routed to escalation.

### Verdict: CONFIRM

### Non-blocking notes

- Task 2.6 lists the "full, subtle, off, os-reduce" parts. The spec files are `hel1573-motion-primitives-full-subtle.spec.ts` and `hel1573-motion-primitives-off-reduce-snap.spec.ts`, and the glob covers both. Run both files in full.
- If the probe confirms H-A1 only, the plan says the `motionRecorder.ts` fallback is not added. Hold to that: do not add the fallback speculatively "just in case", because a change to that shared recorder touches four importers.
- The `.txt` for each throttled 20x run should state the throttling rate used. A reviewer can then judge whether that rate reflects the CI runner CPU recorded in task 1.1.
