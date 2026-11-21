## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `158ae85f224fa58888b1a4708f0c3a2f27be56b2` (commits 7712be66f, 158ae85f2) against base
`81b51b37d096f3e46d9f36b6c3ae5d0906840b6d` (resolved live with resolve-review-base.sh). Spawn-cwd guard: READY.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (root cause per spec): `root-cause.md` gives a cause for each failure. A is a recorder race:
  `transitionrun` fires after the transition finished, so `getAnimations()` is empty. B is a wall-clock span that
  includes main-thread stalls. Both rest on probe rows (`red-a-probe.txt`: rows with `live: 0` record 0;
  `red-b-stall.txt`: a 450 ms stall gives 649 ms at the old `< 600`) and on the CI trace and log. H-A1 was refuted
  in every probe row (`atClick: "ready"`).
- AC2 (20 in a row): I re-ran this myself (Phase 2) and did not rely on the executor's summary files.
- AC3 (fails under its mutation): `red-a-mutation.txt` names
  `hel1573-motion-primitives.ts:218` "rail indicator transform transition" (Expected >= 1, Received 0). That is the
  indicator assertion, not the new `ready` wait, so it meets Decision 4. The rail runs first, which the design
  accepted. `red-b-mutation.txt` names `hel1573-motion-grid-chart.spec.ts:161` "the entrance was configured at the
  standard token (280ms, not 1000ms)". Both name file:line and message, and neither is a timeout.
- Tasks 1.1–2.7 are all marked done, and each matches the diff. Scope is limited to the three e2e files plus the
  change dir. No app code changed, and no file from HEL-1796 or HEL-1808 is touched.
- Decision 3: the entrance keeps the observed `entrance > 150` lower bound (spec:163) and adds a configured-value
  upper check. The `later` span is labelled as a GUARD in the spec comment, and no mutation coverage is claimed for it.
- `workflow-state.md` CONSTRAINTS is `[]`. The driver constraints file was honoured in this review: lane DB, empty
  ANTHROPIC_API_KEY, 2 workers, nice 19, servers stopped with stop-servers.sh, and no .env read.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself. The changed files are under `e2e/**` only, so the `frontend/**` and `backend/**` gate sets are
not triggered. I ran the gates that fit these files:
- `eslint --max-warnings=0` on the 3 changed e2e files: OK.
- `prettier --check` on those files plus the change-dir `.md` files: OK.
- `tsc --noEmit -p e2e/tsconfig.json`: OK.
- Playwright runs: full spec files, 2 workers, `nice -n 19`, lane DB `helio_hel1814`, backend with an empty
  ANTHROPIC_API_KEY.
  - `e2e/hel1573-motion-grid-chart.spec.ts` with `--repeat-each=10`, twice: 40 passed, then 40 passed. That is 20
    of 20 for the chart test at :104.
  - `e2e/hel1573-motion-primitives-full-subtle.spec.ts` with `--repeat-each=10`, twice: 40 passed, then 40 passed.
    That is 20 of 20 for "Motion = full, dark theme", the failure-A test.
  - `e2e/hel1573-motion-primitives-off-reduce-snap.spec.ts` and `e2e/hel1584-motion-surfaces.spec.ts`, once each:
    19 passed. Together with the chart file and the full-subtle part, this covers every `motionRecorder.ts` importer.

Scrutiny of the executor's caveats:
1. **The fallback has no red run on the real spec, and cannot mask a Subtle/Off regression (Decision 2).** The
   fallback in `motionRecorder.ts` only runs inside a `transitionrun` handler, and only when no live CSSTransition
   matches. It never removes or rewrites a record, so it can only add records:
   - A transition that never starts produces no `transitionrun`, so nothing is invented. Mutation A shows this
     (0 records).
   - In Subtle/Off, a regression to a long moving transition still has a live CSSTransition at dispatch and goes
     through the real `record()` path, as before.
   - The fallback sets `moves = MOVING.includes(prop)`, which is conservative. `expectInstantOrStill` then depends
     only on the parsed computed duration.

   I checked this in the motion logs the runs wrote (`e2e-evidence/HEL-1573/motion-log-*.json`). Subtle, Off and
   OS-reduce now hold hundreds of inferred `css-transition` records, all at `duration: 0.01`. That is not `slow`, so
   those modes are at least as strict as before and the fallback is exercised on every run. Full holds 0 inferred
   records locally, as expected without a stall.

   I accept the absence of a red run for the fallback. The race is intermittent: 2/4 and 1/8 in the probe, and 0/8
   with a stall injected on the real spec. Mutation A covers the assertion itself. `root-cause.md` states this
   honestly and does not overclaim.
2. **`later` bound relaxed from 600 to 1000.** It is labelled as a guard. The contract it guarded is still proven
   earlier by the `applied` animationDurationUpdate 280 / animationDuration 0 check and by
   `replay.longestSpanMs < 60`. The new first-option `toEqual` adds to that. Acceptable.
3. **The 20x for A ran on the `-full-subtle` spec file.** That file is correct: it holds the Full/dark test that
   calls `runMode` in `e2e/support/hel1573-motion-primitives.ts`. My runs reproduced 20 of 20.

Code quality:
- The fallback copies the `animationstart` fallback's `list`/`ms`/`i % length` logic and does not share a helper
  (DRY). Both run inside one serialized `addInitScript` function, so moving it to a module-level helper is not an
  option. A local helper inside `RECORDER` would be possible, but this is minor and non-blocking.
- `__chartFirstOption` is captured on the first rAF discovery. echarts-for-react runs init and setOption in the same
  effect, so the first tick always sees the applied option. Mutation B confirms that the check discriminates.
- No dead code, no TODOs, no `any`.

### Phase 3: UI Review — N/A
Phase 3 triggers on `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`, and no changed file
matches. Only test files and change-dir artifacts changed. The Playwright runs above exercised the affected UI flows.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `green-*.txt` hold only Playwright summary lines (for example "40 passed (3.2m)"), not the raw reporter output, so
  they show counts but no per-test lines. Keeping the `--reporter=line` tail in future would make them
  self-authenticating.
- `e2e/support/motionRecorder.ts`: the `list`/`ms`/indexed-`at` helpers in the `transitionrun` fallback could be
  declared once inside `RECORDER` and shared with the `animationstart` fallback.
- Environment note for the next lane: `start-servers.sh` with `DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1814`
  alone failed Flyway with "no PostgreSQL user name specified". Exporting `DB_USER` as the DB owner (from
  `pg_database`) fixed it. This matches the C14 note "DB_USER if URL lacks credentials".
