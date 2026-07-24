## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established**
- Read `ticket.md`, `proposal.md`, `design.md`, `specs/pipeline-window-op/spec.md`, `tasks.md` under
  `openspec/changes/pipeline-op-window-partition-order/`.
- `git diff main...HEAD --stat` — 31 files changed, matches `files-modified.md`'s claimed surface
  (backend core/wiring, frontend editor/wiring, MCP description, tests, openspec artifacts).

**Flyway migration (scrutinized per instructions)**
- `ls backend/src/main/resources/db/migration/ | sort -V | tail` shows `V64__add_datebucket_op.sql`,
  `V65__add_pivot_op.sql`, `V66__add_window_op.sql` — V66 is genuinely the next free version; no
  collision with the datebucket/pivot lanes.
- Ran the **full** backend suite fresh (`sbt test`, not just the targeted window tests): Flyway log
  shows `Successfully applied 66 migrations to schema "public", now at version v66` against the
  embedded Postgres test instance — the migration applies cleanly. `pipeline_steps_op_check` correctly
  extends the drop/re-add pattern (matches `V50__add_splittext_op.sql`) and appends `'window'` to the
  existing list including `'pivot'`.

**WindowStep.scala — tie-break, functions, coercion (read the actual code, not the comments)**
- `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala:158-176` — `rowOrdering` builds an
  explicit `Ordering[(Row, Int)]` that folds over `orderBy` keys, then falls back to `idxA.compareTo(idxB)`
  as the final tie-break. This is a genuine index-stable order, independent of any particular sort
  algorithm's stability — confirmed by reading the comparator, not trusting the doc comment.
- `computeRowNumber`/`computeRank` (lines 201-225) operate on this pre-sorted, index-tie-broken
  sequence, so `row_number` assigns sequential positions in a deterministic order and `rank`/`dense_rank`
  correctly detect tied groups via `orderKeysEqual` (same equality semantics as the comparator).
- Verified `rank` skip-by-tie-count and `dense_rank` no-gap semantics against
  `InProcessPipelineEngineSpec.scala` (added test): 4 rows, 2 tied at the top → `rank` = `[1,1,3,4]`,
  `dense_rank` = `[1,1,2,3]` — standard SQL semantics, test passed.
- `compareValues` (lines 181-192): nulls sort last **regardless of `desc`** (the null branches return
  before the `if (desc) -cmp else cmp` negation) — matches `SortStep.apply`'s `sortWith` null handling
  (`(None, _) => false`, `(_, None) => true`) byte-for-byte in effect. Confirmed by reading both files.
- `running_sum` (lines 231-237) accumulates `PipelineRowJson.toDouble(...).getOrElse(0.0)` — read
  `AggregateStep.scala`'s `sum` (`nums.sum` where `nums = groupRows.flatMap(r => toDouble(...))`) and
  confirmed the two are equivalent in effect: both drop non-coercing values from the accumulation
  rather than erroring. Genuine parity, not just an asserted comment.
- `lag`/`lead` (lines 242-254) index into the *sorted* partition view by `pos ± offset` and return the
  raw (un-coerced) field value, or `null` when `targetPos` falls outside `[0, n)` — correctly implements
  partition-edge nulling.

**apply/infer parity, including the unrecognized-function fallback**
- `PipelineAnalyzeService.scala:333-346` (`inferWindow`): `integer` for the rank family, `number` for
  `running_sum`, same-as-`field`'s-schema-type for `lag`/`lead` (falls back to `"string"` if `field` is
  absent from `inputSchema`), and a catch-all `case _ => "string"` for an unrecognized `function` — this
  degrades gracefully at *analyze* time (no error) while `WindowStep.apply` throws at *execute* time for
  the same unrecognized value. Confirmed this asymmetry is an intentional, pre-existing pattern by
  reading `aggResultType` (line 368-373), which has the identical `case _ => "string"` catch-all — not a
  fabricated precedent.
- Collision rule (`inputSchema.filterNot(_.name == outputColumn) :+ SchemaField(...)`) matches
  `WindowStep.apply`'s `row + (outputColumn -> computed...)` overwrite-on-existing-key behavior.

**Full wiring surface** — read the diffs for `PipelineStep.scala`, `package.scala`,
`PipelineStepRepository.scala`, `PipelineStepProtocol.scala`, `PipelineStepConfigCodec.scala`,
`PipelineAnalyzeProtocol.scala`, `PipelineService.scala`: every arm present (`Registry`,
`PipelineStepKind.Window`, type aliases, `rowToDomain`, wire union read/write + `fromDomain`,
`encodeConfig`/`extractConfig`, analyze union, `toAnalyzeStepResponse`) — exact parity with the
`pivot`/`datebucket` pattern, no missing arm.

**Fresh gate re-runs (not trusted from prior reports)**
- `sbt -batch testOnly` on the 5 targeted specs: **220/220 passed**.
- `sbt -batch test` (full backend suite, fresh, not reused from evaluator): **1832/1832 passed**,
  0 failed, 0 canceled — includes the embedded-Postgres Flyway migration to V66 above.
- `npm run lint` (frontend, zero-warnings policy): clean, no output.
- `npx jest --config jest.config.cjs --testPathPatterns="pipelines"`: **331/331 passed** (all
  pipeline-feature tests, not just `WindowConfig.test.tsx`).
- `npm run format:check`: all files match Prettier style.
- `npm run build`: production build succeeds (2925 modules transformed, no errors).

**Frontend WindowConfig.tsx — round-trip exercised live in the browser, not just rendered**
- Started servers via `scripts/concertino/start-servers.sh`, confirmed `assert-phase.sh servers` → PASS
  (ports 5549/8456).
- Opened the "Profit (migrated)" pipeline, added a `window` step via the picker — confirmed the new
  "Window (rank / running total)" menu item appears (matches `stepNarrowing.ts`'s `OP_TYPES` entry) and
  renders a `WindowConfig.tsx` editor styled consistently with the sibling `Cast type`/`Date bucket`
  step cards (same section classes, no one-off styling).
- Selected `running_sum`, chose the `profit` source field, set `outputColumn = "cum_profit"` — network
  tab showed `PATCH /api/pipeline-steps/{id} => 200`. **Reloaded the page from scratch** (fresh
  `browser_navigate`, new snapshot) and confirmed `function: running_sum` and the field selector
  persisted — this is a genuine PATCH + refetch round-trip, not merely local component state.
- Clicked "Preview data" and read the live-computed table: `profit` values `[0, 100, 20000, 1000000,
  2000000]` → `cum_profit` `[0, 100, 20100, 1020100, 3020100]` — hand-verified the cumulative sum is
  arithmetically correct. This confirms the execution engine (not just the UI) works end-to-end against
  the real dev backend, independent of the unit-test suite.
- Toggled dark → light theme: the editor re-styled correctly with proper token-driven backgrounds/text
  (no hardcoded-color artifacts), same layout as the dark screenshot — light/dark parity holds.
- Console errors on the current page/tab (post-navigation, not cross-session noise from other
  worktrees' stray ports): **zero**.
- Removed the test step afterward to leave the shared dev pipeline as found (courtesy cleanup, not a
  workflow requirement) — confirmed it returned to "2 steps".

**Frontend wiring diff** (`stepNarrowing.ts`, `pipelineStep.ts`, `useStepCardState.ts`, `StepCard.tsx`) —
read in full: `OP_TYPES` entry (label + `faRankingStar` icon), `defaultConfigFor` case,
`windowConfigOf` narrowing helper (tolerant of malformed persisted config, defaults sane), `onWindowChange`
correctly omits `field`/`offset` from the persisted PATCH body when the selected function doesn't use
them (avoids persisting stale values from a previously-selected function) — a genuinely careful detail,
not boilerplate.

**MCP tool description** (`helio-mcp/src/tools/write.ts`) — documents `window`'s full config shape in
prose (free-text `type`, not an enum, correctly not touching the zod schema) including the
apply/infer-parity note about `outputColumn` appearing in `analyze_pipeline`'s output schema (unlike
`pivot`'s dynamic columns) — accurate, not just copy-pasted boilerplate.

**Tests actually assert the AC scenarios, not just "renders"**
- `InProcessPipelineEngineSpec.scala` new tests (read in full): row_number+partition+original-order
  preservation, rank/dense_rank ties, running_sum accumulation + non-numeric coercion + missing-field
  error, lag/lead neighbor read + partition-edge nulls + default-offset + non-positive-offset error,
  unsupported-function error (asserts all six names appear in the message), output-collision overwrite,
  empty-partitionBy single-partition, null-partition-key-is-valid. Every scenario in `spec.md` has a
  corresponding, non-trivial assertion.
- `PipelineAnalyzeServiceSpec.scala` new tests: type-per-function (integer/number/lag-lead-inherits/
  string-fallback), unrecognized-function degrades to string, collision replaces in place, malformed
  config → `validationError` + identity schema.
- `WindowConfig.test.tsx` (17 tests): field/offset conditional visibility per function, partition
  add/remove/change, orderBy delegation to `SortConfig`, function/field/offset/outputColumn `onChange`
  wiring — asserts actual `onChange` payloads, not just DOM presence.

### Verdict: CONFIRM

All ticket acceptance criteria trace to real, exercised code:
- `window` executes each function correctly per partition/order; unsupported function fails at execute
  time with a descriptive error listing all six — verified by test and by reading `WindowStep.apply`.
- `analyze_pipeline` appends `outputColumn` with the correct type per function, apply/infer parity
  confirmed including the unrecognized-function fallback precedent.
- `pipeline_steps_op_check` accepts `'window'`; migration applies cleanly against a real Postgres
  instance (embedded, via the full `sbt test` run).
- Frontend StepCard renders a working window editor; config PATCHes round-trip — verified live in the
  browser with a full page reload, not just unit-tested.
- MCP `add_pipeline_step` documents `window` + its config shape.
- All required test files updated with genuine, scenario-specific assertions (1832/1832 backend,
  331/331 frontend-pipelines tests passing fresh).
- Backward compatible: purely additive migration and dispatch arms; no existing behavior touched.

No design-standard violations found (token usage, shared component reuse, light/dark parity all hold).
No placeholders, no unresolved TODOs, no scope drift.

### Non-blocking notes

- The Playwright MCP `browser_click` tool in this session repeatedly failed with a CSS-selector parse
  error when passed a bracketed `ref` string (e.g. `"button [ref=f18e169]"`); passing the bare ref ID
  (e.g. `"f18e169"`) worked. This is a tooling quirk of the review session, not a product defect —
  noting it only in case it recurs for a future reviewer.
- `WindowConfig.tsx`'s partition-by editor reuses the exact `pipeline-detail-page__aggregate-*` class
  names from the aggregate/pivot editors rather than introducing window-specific classes — this is
  correct DESIGN.md-aligned reuse, not a defect, but worth naming as the reviewed evidence for "no
  one-off styling."
