## Evaluation Report — Cycle 1

Commit reviewed: 089cfe64 ("HEL-375 Add pivot pipeline op (reshape long rows into wide, one column per distinct pivot value)")

### Phase 1: Spec Review — PASS
Issues: none.

- All 8 ticket acceptance criteria are addressed explicitly:
  - `pivot` execution (long→wide, grouping, `<values>_<v>` columns, unsupported-agg error) —
    implemented in `PivotStep.scala`, verified with fresh `sbt test` (1809/1809 passing) and a live
    dry-run in the browser (see Phase 3).
  - `analyze_pipeline` index-only output schema with no false `validationError` — implemented in
    `inferPivot` (`PipelineAnalyzeService.scala`), verified via a live `/analyze` fetch showing
    `outputSchema: [{"name":"col_0","type":"string"}]` and no `validationError` key on the wire.
  - Apply/infer parity for `index` — confirmed (index field + type carried through in both the
    dry-run preview and the analyze response).
  - Flyway migration (`V65__add_pivot_op.sql`) — applies cleanly; confirmed via `sbt test` migrating
    a fresh embedded-Postgres schema through v65 with no errors, and V65 is genuinely the next-free
    VNN (checked against `origin/main`, still at V64).
  - Frontend StepCard pivot editor renders and PATCHes round-trip — live-verified (Phase 3).
  - MCP `add_pipeline_step` description lists `pivot` + config shape — confirmed in `write.ts` diff.
  - Tests across all 5 required suites (`InProcessPipelineEngineSpec`, `PipelineAnalyzeServiceSpec`,
    `PipelineStepConfigCodecSpec`, `PipelineStepSpec`, plus `PipelineStepProtocolSpec` for wire
    round-trip) — all present and passing.
  - Backward compatibility — additive only; no existing op's behavior changed; unknown-kind
    tolerance preserved (`decode({})` tolerance test included).
- No AC silently reinterpreted. Design decisions (value-column naming `<values>_<v>`, collision
  resolution, null-column-value handling, `first` agg, index-only analyze schema) are all
  ticket-sanctioned "decide in impl, document it" choices, and are documented in design.md and
  mirrored in the spec.md scenarios — all scenarios verified to hold in the implementation (test
  suite + live dry-run).
- Task list (`tasks.md`) — all 22 items checked, and each checked item's claimed file/behavior
  matches the diff.
- No scope creep — diff is confined to the 5 wiring touch-points named in the ticket plus tests;
  no unrelated refactors.
- No regressions — full backend suite (1809 tests) and full frontend suite (1276 tests) pass; no
  existing op's code was touched beyond additive registry/union-arm entries.
- API contracts — `schemas/` ↔ `JsonProtocols` drift check passes (`npm run check:schemas`); no
  schema file needed updating since `pivot` doesn't introduce new top-level request/response shapes
  beyond the existing discriminated-union pattern already covered by the drift checker.
- Planning artifacts (proposal/design/tasks) accurately reflect the final implementation — cross-
  checked design.md's 7 decisions against the actual `PivotStep.scala`/`PipelineAnalyzeService.scala`
  code; all match.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Canonical code-quality compliance**: `npm run check:scala-quality` reports "clean" — zero inline
  FQN violations. `PivotStep.scala` imports are all top-of-file (`com.helio.domain.{...}`,
  `spray.json._`), no inline qualifiers. File is 137 lines (well under the 250-line soft budget).
  `npm run lint` (ESLint, zero-warnings policy) passes clean on the frontend diff.
- **Design-standard mechanical rules**: `PivotConfig.tsx` reuses existing
  `pipeline-detail-page__aggregate-*` / `pipeline-detail-page__compute-*` CSS classes rather than
  introducing new one-off styles — correct DRY reuse of the established `AggregateConfig`/
  `DateBucketConfig` visual pattern, consistent with DESIGN.md's shared-component-reuse expectation.
  No new ad-hoc colors/spacing introduced.
- **DRY**: `sum`/`avg`/`min`/`max` reuse `PipelineRowJson.toDouble` coercion (same as
  `AggregateStep`); collision handling (`indexMap ++ valueColumnsMap`) mirrors `AggregateStep`'s
  `keyMap ++ aggMap` precedent exactly, as documented. Frontend `pivotConfigOf`/`defaultConfigFor`
  follow the exact same narrowing pattern as the other 13 ops in `stepNarrowing.ts`.
- **Readable**: naming is clear throughout (`indexMap`, `valueColumnsMap`, `byPivotValue`); the
  `<values>_<v>` naming choice and its rationale are documented in-code (scaladoc) and in design.md;
  no magic values (agg set is a named `SupportedAggs`/`PIVOT_AGG_FNS` constant on both sides).
- **Modular**: `PivotStep.apply` is a clean two-stage grouping function under 60 lines; UI component
  is presentational and prop-driven, consistent with the codebase's Redux-owns-state /
  components-are-presentational rule.
- **Type safety**: `PivotConfig` is fully typed on both backend (`Vector[String]`/`String`) and
  frontend (`PivotConfigValue` with a literal union for `agg`); no `any`/`unknown` escape hatches.
- **Security**: input validation at the boundary — `decode` uses `StepCodecUtil`'s tolerant
  extraction (no unsafe casts), `inferPivot` validates field existence before trusting field names
  used in construction of the output schema; unsupported `agg` is explicitly rejected.
- **Error handling**: unsupported `agg` throws a descriptive `IllegalArgumentException` at execute
  time (parity with `AggregateStep`); analyze-time config errors are caught and downgraded to a
  `validationError` + identity-fallback schema rather than crashing the analyze endpoint (mirrors
  every other `inferX`).
- **Tests meaningful**: execution tests cover every `agg` function individually, the null-column
  case, unsupported-agg failure, and an index/value-column name-collision scenario (design.md
  decision 2) — a genuinely regression-catching set, not just a happy-path smoke test. Analyze tests
  cover the no-error case, three distinct missing-field cases, multi-index-field type lookup, and
  malformed-config fallback. Frontend `PivotConfig.test.tsx` (11 tests, all passing) covers
  add/remove/change of index rows and onChange wiring for column/values/agg — behavior, not
  implementation details.
- **No dead code**: no leftover TODO/FIXME, no unused imports (confirmed via `check:scala-quality`
  and ESLint's zero-warnings gate, both of which would flag unused imports).
- **No over-engineering**: no premature abstraction — `PivotStep` follows the existing op template
  exactly, no new shared utility was invented where none was needed.
- **Behavior-preserving**: this is a purely additive change; no existing step's `evaluate`/`inferX`
  logic was modified. All touch points in shared files (`PipelineStep.scala`, `package.scala`,
  `PipelineStepProtocol.scala`, `PipelineStepConfigCodec.scala`, `PipelineAnalyzeProtocol.scala`,
  `PipelineStepRepository.scala`, `PipelineService.scala`, `stepNarrowing.ts`, `pipelineStep.ts`,
  `StepCard.tsx`, `useStepCardState.ts`) are additive union/registry arms, verified by diff review.

Gates re-run fresh (not trusting the executor's report):
- `sbt test` (backend, from clean worktree state): **1809/1809 passed**, 101 suites, 0 failed.
  Flyway migrated cleanly through V65 ("add pivot op") in the embedded-Postgres test harness.
- `npm run check:scala-quality`: clean (0 violations; only pre-existing file-size soft warnings on
  unrelated test files).
- `npm run check:schemas`: schemas in sync with `JsonProtocols` (18 protocols checked).
- `npm run check:openspec`: only flags "complete but not archived" — expected at this workflow
  stage, not a code issue.
- `npm run lint` (frontend, zero-warnings ESLint): clean.
- `npx jest --testPathPatterns=PivotConfig`: **11/11 passed**.
- Full frontend Jest suite: **1276/1276 passed**, 123 suites.
- `npm run build` (Vite production build): succeeds, no errors.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via `scripts/concertino/start-servers.sh` and confirmed healthy via
`assert-phase.sh servers` (PASS). Live-verified in the browser against the "HEL-254 Wide Table
Pipeline" (an existing dev-DB pipeline with a 30-column CSV source):

- **Happy path end-to-end**: Added a "Pivot (long → wide)" step via the "+ Add transformation step"
  menu — the new op appears correctly in the picker. Expanded the step card; the editor renders
  Index (group-by, add/remove rows) / Pivot column / Values field / Aggregation exactly as designed.
  Configured `index=[col_0]`, `column=col_1`, `values=col_2`, `agg=sum` via the UI controls only.
  Fetched `GET /api/pipelines/:id/steps` directly and confirmed the persisted config matches exactly
  what was set in the UI — config PATCHes round-trip correctly (all 4 PATCH requests returned 200).
- **Analyze contract verified live**: `GET /api/pipelines/:id/analyze` for the pivot step returned
  `outputSchema: [{"name":"col_0","type":"string"}]` with **no `validationError` key on the wire**
  (i.e., `None`) — this is the literal AC ("NO false validationError") confirmed against a real
  running backend, not just the unit test.
  `inputSchema` for the step correctly reflected all 30 upstream columns (schema-only, no data
  access, as designed).
  `analyzeConfigOf` `defaultConfigFor`, aria labels, etc. all fresh — this is genuine live
  verification, not a re-read of the executor's claims.
- **Execution verified live**: Clicked "Dry run" — the pipeline (3 steps including pivot) succeeded
  with "Preview: 200 rows". Opened "Preview data" on the pivot step and confirmed the actual output
  table: a `col_0` column plus dynamic `col_2_<value>` columns (e.g. `col_2_r118c1`, `col_2_r7c1`,
  ...) exactly matching the `<values>_<v>` naming convention from design.md/spec.md, with `sum`
  values populated correctly and non-matching cells rendered as the shared empty-cell placeholder
  ("—") rather than blank/undefined — this confirms apply/infer parity (index columns match between
  analyze and dry-run) plus correct dynamic value-column execution end-to-end.
- **No console errors** attributable to the pivot feature during any UI-driven interaction (step
  add, expand, field selection, dry run, preview, remove). The only console errors observed
  throughout the session were: a pre-existing 404 on `/schedule` (expected "no schedule set" 404,
  unrelated to this ticket, present on every pipeline in this dev DB) and errors from the
  evaluator's own direct `fetch()` calls made outside the app's request-signing wrapper (missing
  CSRF header) — not app-code issues.
- **Loading/empty/error states**: not independently triggerable for this op beyond what's shared
  infrastructure (Select components, preview grid) already covered by existing op editors; no new
  loading/error-state code was introduced by this change.
- **Entry points**: verified via the standard "+ Add transformation step" step-picker menu, the only
  entry point for adding a pipeline step (consistent with every other op).
- **Accessible names / keyboard**: every control has an explicit `aria-label` (`Index field N`,
  `Remove index field N`, `Pivot column`, `Values field`, `Pivot aggregation function`) verified via
  the accessibility snapshot; uses the shared `Select` component consistent with every other op
  editor's a11y pattern.
- **Breakpoints**: resized to 1440 / 1100 / 768 / 375 (mobile) — layout adapts cleanly at every
  width with the shared responsive nav/step-picker/table patterns; no overflow or breakage
  attributable to `PivotConfig.tsx` (its index-row layout — dropdown full-width with the remove `×`
  on the next line — is inherited verbatim from `AggregateConfig`'s existing groupBy-row CSS classes,
  not a new pattern, so it is consistent with the rest of the app rather than a regression).

Post-verification cleanup: the pivot step added to the shared dev pipeline during this review was
removed via the UI ("Remove step") and confirmed back to its original 2-step state; no stray
screenshot files were left in the repo (removed after inspection); no other worktree/dev-DB state
was left mutated as a result of this review beyond the transient dry-run history entry (a normal,
expected side effect of exercising "Dry run", same as any manual QA pass).

### Overall: PASS

### Non-blocking Suggestions
- None beyond what's already covered — the implementation is a clean, faithful, well-tested
  full-stack wiring of the `pivot` op per the ticket, design, and spec.
