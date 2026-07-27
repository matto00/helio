## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

All 7 ticket acceptance criteria are addressed explicitly and match the delta spec
(`specs/workspace-context-assembly/spec.md`):
- Every `dataTypes[]` Structured-category column carries `nullRate`/`distinctCount`(+capped)/
  `exampleValues`; numeric (`integer`/`float`) columns additionally carry `min`/`max`/`mean` —
  verified in `WorkspaceContextService.computeColumnStatsForField` and mirrored in
  `helio-mcp/src/context.ts`'s `computeColumnStatsForField`.
- Bounded-fetch-only computation: single `listRows` call (`StatsRowLimit = 500`) serves both
  `sampleRows` and `columnStats` — no second query path, confirmed by reading `toDataTypeEntry`
  and by test `context.test.ts`'s `getDataTypeRowsCalls` assertion (called exactly once).
- Determinism: dedicated Scala (`WorkspaceContextServiceComputeColumnStatsSpec`,
  `WorkspaceContextServiceSpec` "assemble (HEL-373 5.1 columnStats)") and TS
  (`context.test.ts`) tests assert identical output across repeated calls, including
  `exampleValues` order and `mean` rounding.
- Backend/MCP shape parity: `schemas/workspace-context.schema.json`'s `ColumnStats` def is the
  documented shared contract; both sides independently implement + test the same field set and
  constants (200-char truncation, cap 100, 5 example values, 4-decimal mean rounding, 40-column
  enumeration cap).
- All-null/empty-snapshot handling: covered explicitly (D8 branch precision) with dedicated
  tests for both cases on both Scala and TS sides.
- `schemas/workspace-context.schema.json` updated; `sbt test` and MCP tests both green (see
  Phase 2 fresh gate re-runs).
- Backward-compat: additive only — new top-level `columnStats` field (always-present Map, never
  `Option`), new optional `min`/`max`/`mean` per-column fields, new optional `maxStructuredColumns`
  query param on `/rows`. Confirmed the one existing frontend caller
  (`frontend/src/features/dataTypes/services/dataTypeService.ts`) passes neither `limit`,
  `excludeContentFields`, nor `maxStructuredColumns` — unaffected.

No task items misrepresented; all 22 tasks.md items are actually implemented as described (spot
verified 1.1–1.3, 2.1–2.4, 3.1–3.6, 4.1–4.3, 5.1–5.6 against the diff). No scope creep — every
touched file is in the ticket's stated Impact list. No regressions: full `sbt test` suite
(2280 tests) passes unchanged elsewhere; `/rows`'s pre-existing `excludeContentFields`-only and
no-param behaviors are pinned by new route-level tests (`DataTypeRoutesSpec`) alongside the two
new combinations. Design.md's 10 decisions (D1–D10) are all implemented as specified — see Phase
2 for the line-by-line verification of the specific claims called out in the assignment brief.
Planning artifacts (design.md/tasks.md/files-modified.md) accurately reflect the final code; no
drift found.

### Phase 2: Code Review — PASS
Issues: none.

**Fresh gate re-runs (not trusting the executor's pasted output):**
- `sbt test` (full suite, not just new specs): **2280/2280 passed**, 0 failed, 135 suites.
- Targeted re-run of the 4 new/changed spec files individually: 63/63 passed.
- MCP tests (`npx jest helio-mcp/src/context.test.ts`, resolved via root `jest.config.cjs` since
  `helio-mcp/package.json` has no dedicated test script): **28/28 passed**.
- `npm run check:schemas`: clean ("schemas in sync with JsonProtocols").
- `npm run check:scala-quality`: clean — 76 pre-existing soft file-size warnings (informational
  only per CONTRIBUTING.md), no inline-FQN violations. `WorkspaceContextService.scala` is now
  410 lines (over the ~400 "propose a split" threshold); this is flagged by the executor in
  `files-modified.md` as a deliberate, disclosed trade-off (kept `computeColumnStats` alongside
  its direct sibling `sanitizeSampleRows` rather than mid-ticket restructuring) and is
  informational-only per the tool's own output — not a mechanical failure.
- `openspec validate column-statistics-workspace-context --strict`: valid.
- `npx eslint` + `npx prettier --check` on the three touched TS files: clean.
- `npm run check:openspec`: reports the change as complete-but-not-yet-archived, which is
  expected at this workflow stage (archiving is a later step), not a code defect.

**Design.md binding-decision verification (per the assignment brief's specific asks):**
- **D2's independent 40-column cap**: confirmed BOTH mechanisms present —
  `WorkspaceContextService.scala:206-207` extends the SQL-tier `excludeKeys` via
  `DataTypeService.overflowStructuredFieldNames`, AND `computeColumnStats` (line 311-312)
  independently does `fields.filter(...Structured...).take(SampleColumnLimit)` before folding.
  Both are exercised by tests for empty-snapshot AND non-empty wide DataTypes, at both the pure
  unit level (`WorkspaceContextServiceComputeColumnStatsSpec`) and the DB-integration level
  (`WorkspaceContextServiceSpec` "report no columnStats entry for a wide DataType's overflow
  columns, both empty-snapshot and non-empty"). TS mirrors this with its own `.slice(0,
  SAMPLE_COLUMN_LIMIT)` (`context.ts:166`), also tested for both branches.
- **`overflowStructuredFieldNames` single shared implementation**: lives once in
  `DataTypeService`'s companion object (`DataTypeService.scala`, new code after line 178), called
  identically from `WorkspaceContextService.scala:207` and `DataTypeRoutes.scala:79` — no
  duplication, confirmed by `grep`.
- **D1a memory retention**: read `toDataTypeEntry` directly — `rawRows` is consumed inside the
  single `.map` on `dataTypeService.listRows(...)`'s result (line 208-214), producing only the
  tuple `(sampleRows, columnStats)`; the outer `statsF.map { case (sampleRows, columnStats) =>
  ... }` (line 217) closes over that tuple only. `rawRows` never escapes the inner `.map` and is
  not retained by any accumulator across `assemble`'s `Future.traverse` fan-out (line 109) —
  each `toDataTypeEntry` call's `rawRows` is independently scoped per-future.
- **`/rows` route's `maxStructuredColumns` independence from `excludeContentFields`**: branch
  condition is `if (!excludeContentFields && maxStructuredColumns.isEmpty)`
  (`DataTypeRoutes.scala:58`) as specified. All 4 combinations from spec.md/tasks.md 5.3 are
  covered by dedicated route-level tests in `DataTypeRoutesSpec` (alone, alone, both, neither) —
  not just the paired case.
- **`min`/`max`/`mean` as `Option[Double]`, correctly excluded from schema `required`**: verified
  in `schemas/workspace-context.schema.json`'s `ColumnStats` def (`required` array has only
  `nullRate`/`distinctCount`/`distinctCountCapped`/`exampleValues`; `min`/`max`/`mean` are in
  `properties` typed `["number","null"]`). Both field-present (numeric column) and field-absent
  (non-numeric column) branches are schema-validated by dedicated tests
  (`WorkspaceContextServiceSpec` "HEL-373 5.4 columnStats schema validity").
- **`asNumeric` CSV-string handling and exclusion semantics**: `JsString(s) => s.trim.toDoubleOption`
  (Scala) / trimmed `Number(...)` with NaN/empty-string rejection (TS) both exclude unparseable
  values from the numeric fold without counting them as null or zero — verified by both unit
  tests (`asNumeric` describe blocks on both sides) and the "exclude an unparseable value from
  min/max/mean without counting it as null or zero, on a mixed column" integration-style test.

**TS/Scala parity**: constants (`StatsRowLimit`/`STATS_ROW_LIMIT` = 500, `SampleColumnLimit`/
`SAMPLE_COLUMN_LIMIT` = 40, `SampleCellCharLimit`/`SAMPLE_CELL_CHAR_LIMIT` = 200,
`DistinctCountCap`/`DISTINCT_COUNT_CAP` = 100, `ExampleValueLimit`/`EXAMPLE_VALUE_LIMIT` = 5,
`MeanRoundingFactor`/`MEAN_ROUNDING_FACTOR` = 10000) and behavior (distinct-set growth-stop
threshold, first-seen-order example capture, null/absent-key handling, numeric exclusion
semantics) all match line-for-line between `WorkspaceContextService.scala` and `context.ts`.

**Determinism**: dedicated tests on both sides assert identical output (including
`exampleValues` order and `mean`) across two calls over an unchanged input/snapshot.

**Owner-scoping**: `WorkspaceContextServiceSpec`'s "assemble (HEL-373 5.1 columnStats
owner-scoping)" test mirrors the existing `sampleRows` cross-user test pattern exactly — user B's
response never contains user A's DataType entry or any of user A's example values.

**Backward compatibility**: confirmed via direct read of
`frontend/src/features/dataTypes/services/dataTypeService.ts` — its only `/rows` call passes no
query params, so it hits the unchanged `if (!excludeContentFields && maxStructuredColumns.isEmpty)`
branch exactly as before.

**General code quality**: no dead code, no TODO/FIXME left behind, no inline FQNs (mechanically
verified via `check:scala-quality`), imports are top-of-file/wildcard per CONTRIBUTING.md
convention, `computeColumnStats`/`asNumeric`/`overflowStructuredFieldNames` are all
`private[services]` or public-on-companion for direct unit-testability (mirrors the existing
`sanitizeSampleRows` pattern) rather than over-exposed. No untyped escape hatches. Error handling
at the existing `Left`/`Right`/`findByIdOwned` boundaries is unchanged in shape. Structural
changes (the `/rows` route's branch restructuring) are behavior-preserving for the two pre-existing
cases (no-params, `excludeContentFields`-alone), both re-verified by dedicated tests as unchanged.

### Phase 3: UI Review — N/A
This ticket is backend (Scala) + MCP (TypeScript) + schema only, per the task brief. No
`frontend/**` files, no `ApiRoutes.scala` route composition changes were made (only
`DataTypeRoutes.scala`'s existing `/rows` route gained an additive param), and there is no
Playwright-observable UI surface. Phase 3 is explicitly skipped per the orchestrator's
instruction and the trigger criteria (no matching file changes).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `WorkspaceContextService.scala` is now 410 lines, past CONTRIBUTING.md's ~400-line
  "propose a split" soft threshold. The executor already flagged this in `files-modified.md` as
  a deliberate choice (keeping `computeColumnStats` next to its direct sibling
  `sanitizeSampleRows` rather than a mid-ticket structural split) and proposed a follow-up
  spinoff (e.g. extracting a `WorkspaceContextSampling` helper). Reasonable — no action needed
  this cycle, but worth a spinoff ticket if this file grows further.
