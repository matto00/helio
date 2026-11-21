## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `158ae85f224fa58888b1a4708f0c3a2f27be56b2` against base `81b51b37d096f3e46d9f36b6c3ae5d0906840b6d`
(resolved live with resolve-review-base.sh, exit 0). Spawn-cwd guard: READY. Driver constraints file read and followed:
lane DB `helio_hel1814`, `ANTHROPIC_API_KEY` exported empty, Playwright 2 workers with one batch at a time, `nice -n 19`,
servers stopped with stop-servers.sh (`STOPPED ports=7246,10153`), no .env read.

### What I verified (with evidence)

- **Scope.** `git diff --stat` shows 3 code files, all e2e: `e2e/hel1573-motion-grid-chart.spec.ts`,
  `e2e/support/hel1573-motion-primitives.ts` and `e2e/support/motionRecorder.ts`. The rest is change-dir artifacts. There
  is no app code, and no HEL-1796 or HEL-1808 file is touched.
- **AC1 root cause, failure A (recorder race).** `red-a-probe.txt` has 8 rows. Every row has `atClick: "ready"`, which
  refutes H-A1. Row i=1 has `transitionrun ... live: 0` with `recorderTransformRecords: 0`. The other rows have `live: 1`
  and record 1. That is the claimed mechanism: the event arrives after the CSSTransition is gone, and the old handler loops
  over an empty `getAnimations()`. The CI motion log I was told about (0 records, even the 160 ms colour transitions) is the
  same signature. I treat it as a claim backed by the probe, not as something I re-ran.
- **AC1 root cause, failure B (wall-clock span).** `red-b-stall.txt` shows that a 450 ms injected stall gives `later` 649.3 ms
  and fails the old `toBeLessThan(600)`. The no-stall run gives about 234 ms. I confirmed in
  `frontend/src/utils/chartAppearance.ts:330-343` that the configured durations are token-driven (280, and 0 after the
  entrance). So the excess is stall time, not configuration.
- **Fallback correctness, judged independently (the executor's open caveat).** The fallback has no red run on the real
  spec, so I tested its logic directly. A scratch Playwright test outside the worktree
  (`/home/matt/Development/helio/.concertino/scratch/HEL-1814/skeptic/fallback.spec.ts`) installs the real `RECORDER` and
  dispatches synthetic `transitionrun` events on elements that have no live transition. Result, 1 passed:
  - a multi-entry `transition: opacity 160ms ease, transform 280ms cubic-bezier(0.3, 0.9, 0.4, 1)` gives transform
    `{duration 280, easing "cubic-bezier(0.3, 0.9, 0.4, 1)", inferred true, moves true}` and opacity
    `{160, "ease", moves false}`. The index mapping works, and the split does not break on the commas inside
    cubic-bezier.
  - `all 0.01ms` gives 0.01 ms (Chrome serialises it as `1e-05s`, and the parser handles that).
  - `transition: none` records nothing, so no duration is invented.
  - A real live transition takes the original path only: one non-inferred record, no duplicate.
  The old handler records nothing in the `live: 0` state by construction, because its only path is the loop over
  `getAnimations()`. The fallback can only add records, and it only adds them when a transition really fired. The Full
  indicator assertion stays mutation-covered: in `red-a-mutation.txt`, with the fallback present, removing the CSS rule
  gives 0 records, because no `transitionrun` fires. I accept that the fallback has no red run on the real spec. The race
  is not deterministic on the real spec, and the logic is now verified directly.
- **`ready` wait (failure A).** It applies only to Full, is bounded at 15 s, and has a message. A regression in which the
  group never reaches `ready` fails loudly in the wait. It does not pass silently, so the change does not weaken the test.
- **Failure B rewrite does not weaken the contract.** The entrance upper bound was `< 600 ms` wall-clock. It is now
  `__chartFirstOption` toEqual `{animationDuration: 280, animationDurationUpdate: 280}`, which is the value ECharts
  actually holds. The observed `entrance > 150` stays, so an entrance switched off (0 ms) still fails. `red-b-mutation.txt`
  (library defaults) fails at `hel1573-motion-grid-chart.spec.ts:161` with that message. I checked that line 161 in HEAD is
  the `toEqual`.
  - First-capture timing: echarts-for-react 3.0.6 (`initEchartsInstance`) first creates a temporary instance and calls
    `setOption` only on the second one. `ECharts.getOption()` returns `undefined` with no model (echarts 6.1.0
    `lib/core/echarts.js:568`). The recorder's `find()` needs a `<canvas>`, and zrender creates canvas layers lazily on
    paint. So the temporary instance is not expected to be found, and the real instance gets its canvas inside the same
    synchronous `setOption`. Every one of the more than 40 local passes agrees: the executor's, the evaluator's and mine.
    If it were found, the result would be a loud failure, not a false pass (see note 1).
  - The entrance window closes no earlier than about 280 ms after chart-ready. Closing it does not rebuild the option, so
    the first rAF discovery reliably sees the entrance option.
- **`later` guard 600 -> 1000, judged.** I accept it. It is labelled in the spec as a GUARD with no mutation coverage
  claimed. The contract it stood for (an update never replays the entrance or exceeds the token) is proven, before it
  runs, by `applied` toEqual `{0, 280, cubicOut}` (unchanged), `replay.longestSpanMs < 60` and the bar-collapse ratio
  guard. Those are configuration and replay checks, not wall-clock checks. A replay at the 1000 ms library default
  measures at least 1000 ms, so it still fails `< 1000`. The new bound leaves about 720 ms of headroom for stalls, against
  616 ms observed on CI.
- **AC2 (20 in a row), fresh runs by me.** These were full spec files, 2 workers, `nice -n 19`, against the lane DB and
  the lane servers:
  - `e2e/hel1573-motion-grid-chart.spec.ts --repeat-each=5`: `20 passed (1.7m)`, which includes the :104 chart test 5
    times (`/home/matt/Development/helio/.concertino/scratch/HEL-1814/skeptic/grid-chart-5x.txt`).
  - `e2e/hel1573-motion-primitives-full-subtle.spec.ts --repeat-each=5`: `20 passed (2.5m)`, which includes Full/dark 5
    times (`/home/matt/Development/helio/.concertino/scratch/HEL-1814/skeptic/primitives-5x.txt`).
  - The 20x counts themselves rest on the evaluator's pasted runs (40+40 passed per file, twice). The evaluator ran them
    independently, and the counts are unambiguous. My runs agree with them and found no failure.
  - The evidence the run wrote (`e2e-evidence/HEL-1573/chart-entrance.json`): entrance span 296.6 ms, after-refresh spans
    304.6 and 229.9 ms, `applied` {0, 280, cubicOut}, replay longest 0 ms.
- **AC3 (red under mutation).** `red-a-mutation.txt` fails at `hel1573-motion-primitives.ts:218` "rail indicator transform
  transition", Received 0. That is the indicator assertion, not the new wait, and line 218 in HEAD is that `expect`.
  `red-b-mutation.txt` fails at `:161`, as above. Neither is a timeout. I did not re-run the mutations: they need app-code
  edits, which this role cannot make. The pasted outputs are unambiguous and their file:line values match HEAD.
- **Static gates, my own runs.** `eslint --max-warnings=0` on the 3 files: exit 0. `prettier --check`: exit 0.
  `tsc --noEmit -p e2e/tsconfig.json`: exit 0.
- **UI / design judgment:** N/A. No `frontend/**` file changed.
- **Gate-defect check (mtime):** no report in this chain relies on mtime ordering. Nothing to record.

### Verdict: CONFIRM

### Non-blocking notes

1. `e2e/support/motionRecorder.ts` tick: `instance.getOption()` returns `undefined` on an ECharts instance that has no
   option yet. If `find()` ever found one (for example, echarts-for-react's temporary init instance gaining a canvas in a
   future version), `option.animationDuration` would throw inside the rAF loop. That would stop the loop for good and
   empty every chart edge. It would be a loud failure, not a false pass. A one-line guard would be cheap: leave `seen`
   false while `getOption()` is falsy.
2. As the evaluator noted, the `transitionrun` and `animationstart` fallbacks duplicate the `list`/`ms`/`at` helpers
   inside `RECORDER`. A shared local helper would remove the duplication.
3. The `green-*.txt` files hold summary lines only. Keeping the reporter tail would make them self-authenticating.
