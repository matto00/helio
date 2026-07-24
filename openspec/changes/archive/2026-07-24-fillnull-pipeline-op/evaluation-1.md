## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 7 ticket acceptance criteria addressed explicitly:
  1. Each strategy fills only null cells in named columns; constant/forwardFill/mean/median/mode
     all implemented per design.md semantics; unsupported strategy fails descriptively —
     confirmed by `FillNullStep.scala` + 11 new cases in `InProcessPipelineEngineSpec.scala`.
  2. `analyze_pipeline` identity passthrough — `PipelineAnalyzeService.scala` joins the
     `fillnull` case into the true `filter | limit | sort | dedupe` passthrough arm (not the
     `cast` arm, correctly distinguished per the design-gate skeptic's note referenced in the
     commit message) — confirmed by a live analyze call in the browser and
     `PipelineAnalyzeServiceSpec`.
  3. `pipeline_steps_op_check` accepts `'fillnull'` — `V69__add_fillnull_op.sql`; confirmed V69 is
     the current max migration file (no collision with the concurrently-landing dedupe/unpivot/
     window lanes) and `sbt test` shows Flyway migrating cleanly to v69.
  4. Frontend StepCard renders a working editor; config PATCHes round-trip — verified live in
     Chrome via Playwright (column checkbox toggle + strategy switch + constant-value input all
     produced `200 OK` PATCH /api/pipeline-steps/:id round-trips).
  5. MCP `add_pipeline_step` documents `fillnull` + config shape — `write.ts` description string
     updated with the full strategy/config documentation.
  6. Tests: round-trip per strategy in `InProcessPipelineEngineSpec`, analyze passthrough test,
     codec round-trip test, `PipelineStepSpec` kind-parity — all present and passing.
  7. Backward compatible / additive — no existing dispatch arm or type modified in a
     breaking way; confirmed by full `sbt test` (1870/1870 green, no regressions).
- No AC silently reinterpreted.
- All 26 tasks.md items marked done and each is backed by a corresponding diff hunk (migration,
  step impl, 6 backend wiring points, 4 frontend wiring points, MCP doc, 6 test files).
- No scope creep — diff is scoped exactly to the fillnull-pipeline-op change (the wider repo diff
  vs. `main` includes prior unmerged sibling-lane commits in the batch stack — dedupe/unpivot/
  window — but the `c027d5dc` commit itself, reviewed via `git show`, touches only files listed in
  files-modified.md).
- No regressions to existing behavior — full backend and frontend suites pass unchanged elsewhere.
- API contract: no schema files under `schemas/` needed updating (op-list is protocol/DB-check
  only, not JSON-Schema-governed); `check:schemas` passes clean.
- Planning artifacts (design.md decisions 1–7) match the implemented behavior exactly — verified
  line-by-line against `FillNullStep.scala`'s doc comments and logic.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md mechanical compliance**: no inline FQNs in any new/changed file (all imports
  top-of-file); `check:scala-quality` reports zero violations attributable to this change.
  `FillNullStep.scala` is 200 lines (within the ~250 soft budget). One pre-existing soft-budget
  warning (`PipelineStepConfigCodecSpec.scala`, now 294 lines) predates this change — it was
  already 275 lines before HEL-388 added ~19 lines of new test cases; not a new violation, and the
  script treats file-size as informational-only per CONTRIBUTING.md ("File-size warnings ... are
  informational only").
- **DESIGN.md mechanical compliance**: `FillNullConfig.tsx` introduces zero new CSS/classNames —
  it reuses `pipeline-detail-page__dedupe-config`, `__compute-field`, `__compute-label`,
  `__select-fields-*` verbatim from `DedupeConfig.tsx`/`PipelineDetailPage.css`, and the shared
  `Select`/`TextField` components from `shared/ui`. No hardcoded colors/spacing/hex values found.
- **DRY**: columns-checklist markup is a direct, intentional reuse of `DedupeConfig`'s pattern
  (documented in the file's header comment) rather than a new abstraction — reasonable given only
  two call sites exist to date; not premature to extract a shared component yet.
- **Readable**: `FillNullStep.scala` strategy dispatch, `isNull`/`fillConstant`/`fillForward`/
  `fillWithStat`/`computeMean`/`computeMedian`/`computeMode` are all narrowly named and
  documented; no magic values (strategy names are declared once in `SupportedStrategies`).
- **Modular**: five strategies factored into five small private methods; `fillWithStat` correctly
  shares the "compute once, apply to nulls" skeleton across mean/median/mode via a passed
  `stat` function — good abstraction, not over-engineered.
- **Type safety**: `FillNullConfig` fields are fully typed on both backend (`Vector[String]`,
  `String`, `Option[String]`) and frontend (`string[]`, `FillNullStrategy` union, `string | null`);
  no `any`/`unknown` escape hatches.
- **Security**: no new input surface beyond existing config-JSON decode path (`StepCodecUtil`,
  already-audited tolerant decode); no injection surface (no raw SQL/HTML construction).
- **Error handling**: `constant` without `value` and unsupported `strategy` both fail with
  descriptive `IllegalArgumentException`s at execute time (matches the established
  `AggregateStep`/`WindowStep`/`PivotStep` failure-shape precedent) rather than failing silently.
- **Tests meaningful**: 11 new backend execution-path tests cover every scenario in
  `spec.md` (constant, missing-key, missing-value failure, columns-not-listed, forward-fill +
  leading-null, mean, median, mode + tie-break, all-null-stays-null, unsupported-strategy) plus
  codec/protocol/analyze/kind-parity coverage; 9 new frontend tests cover every UI scenario
  (column toggle add/remove, strategy switch, conditional value input for constant vs. the other
  four strategies, typed-value onChange payload). These would catch a real regression in any of
  the five strategies or the passthrough dispatch.
- **No dead code**: no unused imports, no leftover TODO/FIXME in the diff.
- **No over-engineering**: single-strategy-per-step config shape matches the ticket's literal
  signature (design.md Decision 1 explicitly rejects a more complex per-column strategy map as
  scope creep) — appropriately minimal.
- **Behavior-preserving**: this is a purely additive change (no existing dispatch arm's behavior
  changed); confirmed by the full backend suite passing unchanged (1870/1870) and no diff hunks
  touching pre-existing case arms beyond adding a new one.
- **Hook-bypass note**: commit was made with `-n`, explicitly called out in the commit body per
  CONTRIBUTING.md's AI-collaborator requirement. The bypassed check (`check:openspec`) is a
  workflow-ordering artifact (change not yet archived — archiving is a distinct later phase per
  the concertino-deliver pipeline), reproduced independently by re-running `check:openspec`
  myself; all other pre-commit checks (`lint`, `format:check`, `check:schemas`,
  `check:scala-quality`, frontend `test`) were independently re-run and pass clean, plus the full
  `sbt test` suite (not in the Husky chain) also passes.

### Phase 3: UI Review — PASS
Issues: none.

Servers started via `scripts/concertino/start-servers.sh` (ports 5561/8468); `assert-phase.sh
servers` returned PASS.

- **Happy path**: added a `fillnull` step to a live pipeline (HEL-254 Wide Table Pipeline, 200
  rows / 30 columns) via the op-type dropdown ("Fill null / impute" entry, correct icon).
  `FillNullConfig` rendered with the columns checklist (all 30 analyze-columns), strategy dropdown
  defaulting to `constant`, and the constant-value input. Toggled a column checkbox (`col_0`),
  typed a constant value ("unknown") — both triggered `PATCH /api/pipeline-steps/:id` → `200 OK`.
  Ran "Dry run" — `POST /api/pipelines/:id/run?dry=true` → `200 OK`, resulting in "Run status:
  succeeded" / "Preview: 200 rows" with the fillnull step correctly showing "200 rows" (schema
  pass-through confirmed live, matching the identity-passthrough AC). Clicked "Preview data" on
  the step — data grid rendered all 30 columns / 10 preview rows with no errors.
  Removed the step afterward — `DELETE /api/pipeline-steps/:id` → `204 No Content`.
- **Strategy switch**: selected `forwardFill` from the dropdown — constant-value input correctly
  disappeared from the DOM (matches the "Constant value input only shown for constant strategy"
  spec scenario), no console errors, preview grid remained rendered.
- **Unhappy paths**: not applicable at the UI layer for this op (all failure modes — missing
  `value`, unsupported `strategy` — are backend execute-time errors covered by backend tests, not
  reachable through the constrained UI, which only ever sends valid strategy enum values and only
  shows the value field for `constant`).
- **Loading/empty states**: reused `DedupeConfig`'s pattern (`analyzeColumns.length === 0` renders
  an empty `<ul>` with `aria-label="Available fields"`); consistent with sibling ops.
- **Console errors**: zero new console errors across the whole flow. The one recurring error
  (`GET .../schedule → 404`) is pre-existing, unrelated to this pipeline having no schedule set,
  and present before any fillnull interaction.
- **Entry points**: exercised via the standard "+ Add transformation step" dropdown, the only
  entry point for pipeline ops (consistent with every other op in the codebase).
- **Accessible names / keyboard**: checkboxes have per-column accessible names (`col_0` etc. via
  the wrapping `<label>`); the strategy `Select` is a proper `combobox` with `aria-label`; the
  constant-value `TextField` has both a `<label htmlFor>` and `aria-label`. All interacted via
  Playwright's role-based locators without needing CSS fallbacks.
- **Breakpoints**: rendered at 1440/1100/768/390px — the columns checklist reflows its column
  count responsively with no overflow or clipping at any width (inherits `DedupeConfig`'s existing
  responsive CSS, unchanged by this ticket). No new breakage introduced.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PipelineStepConfigCodecSpec.scala` is now 294 lines (soft budget ~250; predates this change at
  275 lines). Not a regression introduced here, but worth a follow-on split (e.g. one spec file per
  op family) the next time that file is touched substantially.
