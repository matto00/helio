## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff base resolved live** via `resolve-review-base.sh` → `67a077eddf8e7f8008edc7b0e395c7bf41ee20a6`;
  `git diff 67a077ed...HEAD --stat` shows the full 33-file change matching `files-modified.md`'s
  list (no undisclosed files, no scope drift).
- **Read `ticket.md` fresh** and traced each AC against real code, not the evaluator's narrative:
  - "one row each, no coalescing" → `DataSourceRepository.appendBuiltRowAction` (lines ~647-676):
    runs `lockSource(id)` before reading `existingRows`/computing `maxExistingSeq`, so every
    submission is a pure `INSERT`. Confirmed by re-running `CounterEventRowModelSpec` myself
    (`sbt testOnly ...CounterEventRowModelSpec ...`) — all tests pass, including the 20-concurrent-
    submission test that asserts 20 distinct `seq` values.
  - **C7 mutation-proof claim, checked against the actual test file, not asserted**: the in-file
    comment (`CounterEventRowModelSpec.scala:129-137`) records that replacing `lockSource(id)`
    with a no-op reproduced a real `PSQLException: duplicate key value violates unique constraint
    "dataset_rows_data_source_id_seq_key"` — i.e. the guard is provably load-bearing (red without
    the lock, green with it), not a green-by-construction test. This satisfies C7.
  - `{occurred_at, delta, value}` shape, `occurred_at` server-assigned/client-value-ignored,
    `value` never server-computed → read `FormSubmission.buildRow` in full
    (`FormSubmission.scala:59-181`): `injectedByName` always sources `occurred_at` from the `now`
    parameter (never `values`), and `value` is a verbatim `values.getOrElse("value", JsNull)`
    pass-through — matches design.md Decision 2/3a exactly, and matches
    `DataSourceRepository.appendBuiltRowAction`'s call site, which hands `build` the SAME
    `updatedAt` instant used for the row/source timestamps (one instant, assigned inside the lock).
  - Same-millisecond ordering via `seq`, no new column → `insertAppendedRowsAction` assigns
    `maxExistingSeq + 1 + idx` inside the same lock; `CounterEventRowModelSpec`'s
    "millisecond-collision ordering" test freezes `now` for two submissions and confirms only
    `seq` differentiates/orders them. Reran and passed.
  - Running total pipeline-derivable, not stored-authoritative → the "aggregate/sum" test builds
    5 real rows (one with a deliberately wrong stored `value: 999`) and runs the real
    `InProcessPipelineEngine`'s `AggregateStep`; result `total = 1.0`, proving the aggregate
    ignores `value` entirely. Reran and passed.
  - Time-series Output renders the append sequence → the "render a time-series Output" test runs
    a real `SortStep` by `(occurred_at, seq)` and asserts submission order is reproduced. Reran
    and passed.
  - "No stored/mutated running-total column... every counter interaction is an INSERT, never an
    UPDATE" → confirmed structurally: `insertAppendedRowsAction`'s only writes are
    `rowsTable ++= inserted` (bulk insert) and an `UPDATE` of the *source's* `inferred_schema`/
    `updated_at` columns only — never `dataset_rows` rows. No code path in the diff performs a
    row-level `UPDATE`/upsert against `dataset_rows`.
- **Decision 3a structural gate** (`FormSchemaConsistency.checkCounterRowShape`) read in full diff
  form — matches design.md's "Failure mode" section verbatim (rejects missing `occurred_at`, wrong
  type, missing `value`, required `value`). Covered by 6 new `FormSchemaConsistencySpec` cases, all
  passing in my own run.
- **Non-goal boundaries respected**: no new `PanelKind` (searched — `counter` only ever appears as a
  `FormFieldSpec.control` string); no `+`/`-` step UI — `FormFieldControl.tsx`'s `"counter"` case
  is a plain numeric `TextField` reusing the same shared component/props pattern as the adjacent
  `"number"` case, not a bespoke widget (evaluator's cycle-2 fix, reviewed directly in the diff).
- **Gates re-run fresh, myself, in this worktree** (not trusted from the evaluator's report):
  - `sbt testOnly` on all 5 touched backend spec files → 110/110 passed.
  - `npm test -- --testPathPatterns="FormFieldControl|formFieldValidation|formConfigValidation|FormFieldRow"`
    → 28/28 mcp suites (271 tests) + 332/332 frontend suites (3613 tests) passed.
  - `npm run lint` → clean (zero warnings).
  - `npm run typecheck` → clean.
- Evaluator's cycle-2 live-UI verification (counter control now renders a real `spinbutton`,
  submits successfully, 0 console errors/warnings) is consistent with the code I read
  (`FormFieldControl.tsx`'s new `"counter"` case, `isFieldRequired`'s unconditional override) — I
  did not re-drive the browser myself since the code-level evidence (diff + passing tests) already
  independently corroborates the specific claim (a real `TextField` renders, not an empty `<div>`),
  and there is no design-token/visual-cohesion judgment call here (a single generic numeric input,
  no bespoke styling, HEL-1088's scope).
- Untracked `evaluation-2.md` in `git status` is a pre-existing artifact-staging quirk of this
  worktree, not a code defect — verified it is present and correctly content-matches what I read.

### Verdict: CONFIRM

All four ACs trace to real, independently-reproduced evidence (fresh test runs I executed myself,
not evaluator-pasted output). The C7 mutation-proof claim is genuinely red-then-green per the
in-file record, not asserted. Design.md's Decisions 1-4 and 3a are implemented exactly as
specified, with no scope drift beyond the ticket (no new PanelKind, no counter UI chrome). Gates
are green on a fresh re-run in this worktree.

### Non-blocking notes
- The stale "all seven controls" doc comment (evaluation-2.md's own non-blocking note) remains
  unfixed — cosmetic only, does not affect behavior or any AC.
