# Files modified (HEL-1424)

## Backend, main
- `backend/src/main/scala/com/helio/domain/engine/SchemaField.scala` — optional `nullable: Option[Boolean] = None` (None = not recorded).
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — `schemaFieldJsonFormat` writes `nullable` only when `Some`, reads its absence / a non-boolean as `None`.
- `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala` — `fromCsvLines` folds nullability over every data row (streaming, blank/whitespace lines skipped; `InferSampleRows` removed); `inferShallowFromJsObjects` computes nullable (JsNull/absent = null) and its stale comment is corrected.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — createCsv, createCsvUrl and CSV refresh persist `Some(nullable)`; `upsertSourceDataType` takes `persistNullable` (true only for CSV; text/pdf/image stay `None`).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunBackfill.scala` — same change as the next bullet (see it)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunSucceededWrites.scala` — Output schema writes persist `Some(nullable)` (both infer over the full materialized `nodeJsRows`, confirmed).
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — `InferredFieldResponse.fromDomain(fields, legacyNullable)`: CSV passes true, the six other kinds false; a recorded value always wins.
- `backend/src/main/scala/com/helio/services/panels/PanelCapabilityService.scala` — same change as the next bullet (see it)
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala` — Output columns read `nullable.getOrElse(true)`; stale comments updated.

## Backend, tests
- `backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala` — EXPECTATION CHANGES, each deliberate: (1) "still treat the trailing empty line ... as a sampled empty row" `Seq(true,true)` -> "not treat ... as a data row" `Seq(false,false)` (design D8: the row loader skips blank lines); (2) "mark field nullable when any cell is empty": fixture `"val\n1\n\n3"` (single column, so the "empty cell" was really a blank line) -> `"val,other\n1,a\n,b\n3,c"`, same intent; (3) "cap sampling at 100 rows" (pinned that a blank at row 101 was NOT seen) replaced by "sample every row, not only the first 100", the inverse by design. New tests: blank lines skipped / blank cell nullable, all-blank column, blank at row 150 (+ bytes parity), shallow inference nullability.
- `backend/src/test/scala/com/helio/domain/engine/SchemaFieldNullableFormatSpec.scala` (new) — format round-trip, absent, non-boolean.
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceSpec.scala` — CSV refresh persists the new nullability.
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — all-blank column on create + list; legacy field without nullability reads true; image source unchanged (false).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — a run records `Some(true/false)` per column.
- `backend/src/test/scala/com/helio/services/panels/PanelCapabilityServiceSpec.scala` — stored value reported, legacy reads true.
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala` — FIXTURE HELPER CHANGE with reason (cycle 2: cycle 1 claimed this but the code still built `SchemaField(name, type)`; now actually done): `setDataTypeFields` writes `SchemaField(.., Some(f.nullable))`, so fixtures keep asserting the value they declare instead of reading the new legacy default `true`. No assertion edited. New test "report stored nullable per column, and true for a legacy field with none (HEL-1424)" (stored false / stored true / legacy absent -> false / true / true via `assemble`).
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/CsvBlankCellsNullSnapshotSpec.scala` — AC3: `eq ""` loop covers `SortCast.AsTimestamp`.
- `backend/src/test/scala/com/helio/domain/engine/CsvBlankCellsNullStepsSpec.scala` — AC3: lookup test asserts `out.count(_("team") == null) shouldBe 2`.

## Task 1.5 audit (SchemaField equality / set comparisons)
Grepped main for `==`/`!=`/`distinct`/`toSet`/`sameElements` over `SchemaField`/`inferredSchema`/`.schema`: no site compares whole `SchemaField`s for "same columns". `PipelineSchemaDrift` compares name+type maps only (design Non-goals), so a nullable-only change is never drift. Only `.name ==` filters in `ReshapeSchemaInference` (name-only). Analyze-derived fields stay `None`.

## Frontend
- `frontend/src/utils/blankLabel.ts` (new) — `BLANK_LABEL`, `selectionValueLabel`, strict `groupHasNull`, `relabelNullCategory`, `isBlankCategoryClick`, `relabelBlankCategory`.
- `frontend/src/utils/aggregate.ts` — `GroupedAggregate.hasNullGroup?` (how the flag reaches `buildChartOption`: it rides on `chartAggregate`, whose identity is already in the `useChartOption` memo deps, so no new prop/dep is needed; both `ChartOutputPanel` and `OutputPreviewPane` set it).
- `frontend/src/features/panels/ui/buildChartOption.ts` — relabels the category axis (x, or y of a horizontal bar) and pie names AFTER `applyChartOverlay` and BEFORE the compact/measuring passes, so anything sized from category labels sees the rendered "(blank)" (skeptic note on label width).
- `frontend/src/features/panels/ui/ChartOutputPanel.tsx` — same change as the next bullet (see it)
- `frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx` — one shared `groupHasNull`; panel sets `hasNullGroup` on the aggregate and keeps `groupHasNull` on the click spec.
- `frontend/src/features/panels/history/chartOverlay.ts` — same change as the next bullet (see it)
- `frontend/src/utils/chartClickSelection.ts` — "(blank)" + `groupHasNull` maps to `""` (selection stays `""`, C1).
- `frontend/src/features/pipelines/ui/outputHistory/HistoryChart.tsx` — grouped series: selected rows AND vs-comparison points map "null" to "(blank)".
- `frontend/src/features/panels/ui/CrossFilterIndicator.tsx` — same change as the next bullet (see it)
- `frontend/src/features/panels/ui/PanelInspectView.tsx` — same change as the next bullet (see it)
- `frontend/src/theme/theme.css` — `selectionValueLabel`; placeholder italic, non-monospace (`.selection-value--blank`, skeptic note).
- `DESIGN.md` — "(blank)" copy rule after "Nulls sort last" (rewritten in cycle 2 to match what ships).

## Frontend tests (expectation changes, with reason)
- `frontend/src/utils/chartClickSelection.test.ts` — "click on the 'null' bar selects blank" -> click on "(blank)" (the displayed name is now the click name); "null without null records stays literal" kept, plus "(blank)" without nulls stays literal; pie click test added.
- `frontend/src/features/panels/ui/ChartOutputPanel.aggregate.test.tsx` — `chartAggregate` toEqual gains `hasNullGroup: true`; preview parity assertion and a literal-"null" preview case.
- `frontend/src/features/panels/ui/PanelCard.aggregateChart.test.tsx` — category data `["east","(blank)","west"]`; click name "(blank)"; header "Showing rows for region: (blank) / sum(amount)" (was an empty value); new click (blank) -> Filter dashboard -> store `crossFilter.value === ""` test.
- New: `utils/blankLabel.test.ts`, `features/panels/ui/buildChartOption.blankCategory.test.ts` (vertical/horizontal/pie, literal "null", overlay-at-(blank)-index, click per orientation), `features/pipelines/ui/outputHistory/HistoryChart.blank.test.tsx` (rows + vs overlay), CrossFilterIndicator and PanelInspectView cases.

## Task 3.6 red-first evidence (fix reverted -> failing tests; fix restored afterwards)
Frontend (relabel gated off, click mapper back to `"null"`, HistoryChart `grouped=false`, indicator/inspect raw value): 13 failed, e.g. `buildChartOption blank category (HEL-1424) > vertical bar and line ...`, `> horizontal bar ...`, `> pie ...`, `> a history overlay keeps its blank-group value at the (blank) index`, `aggregate blank-category click ... > a click on the '(blank)' bar selects blank ...`, `HistoryChart blank category (HEL-1424) > relabels a stored 'null' group ...`, `CrossFilterIndicator > labels an empty (blank) filter value`, `PanelInspectView ... > labels a blank (empty) selection value`, `PanelCard aggregated chart Output > the null group plots as '(blank)' ...`.
Backend (sample cap + no blank-line skip; legacy default false; capability false; Output run no `Some`; CSV refresh no `Some`): 10 failed: `not treat the trailing empty line ...`, `skip blank and whitespace-only lines ...`, `report an all-blank column as nullable`, `see a blank beyond the first hundred data rows`, `sample every row ...`, `persist the refreshed nullability ...`, `report an all-blank CSV column as nullable on create and on a later list read`, `read a legacy stored CSV field without nullability as nullable true`, `records nullable per column on outputs.schema ...`, `report stored nullability, and true for a legacy field with none`. Shallow-inference mutation: `infer shallow nullability from JsNull and absent keys (HEL-1424)` failed.

## Task 3.7 live probe
Backend on this worktree (port 9763), throwaway `hel1424-probe-1791877189@example.test` (id 846a139d-1f79-4266-b990-662c41e71c3f), uploaded `id,notes,score` with `notes` blank in every row: create response and GET /api/data-sources both `[('id', False), ('notes', True), ('score', False)]`. User deleted by exact (id, email) via `buildUserDeleteSql`; servers stopped with stop-servers.sh.

## Cycle 2 (evaluation-1.md)
- Workspace-context nullability: helper fixed, test added. Red-first: `WorkspaceContextService.toDataTypeEntry` mutated back to `nullable = false` -> `report stored nullable per column, and true for a legacy field with none (HEL-1424)` FAILED (38 passed, 1 failed); restored -> 39 passed.
- `DESIGN.md` "(blank)" rule rewritten to what ships: client-aggregated chart categories, history grouped series, selection header/button; italic non-mono only where the value has its own span (indicator, Inspect button), the Inspect header is plain text; non-aggregated chart blank x label unchanged; data grids keep existing null rendering (table panel "—", Inspect grid empty cell).
- Doc comment grammar fixed in `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala`.
- Backend coverage this cycle: `sbt testFull` as the build's 6-way partition (HELIO_TEST_SHARD_INDEX=0..5, HELIO_TEST_SHARD_COUNT=6, -J-Xmx3g, nice -n 19, foreground), all exit 0, hel1468-guard failed=0 aborted=0 each. Suites/tests per shard: 95/1391, 96/1119, 96/1395, 98/1328, 98/1165, 98/1247 = 581 suites, 7645 tests, 0 failed, 4 canceled. (Cycle 1 instead used package slices `testOnly com.helio.{domain,api,infrastructure+spark+testsupport+testkit,services}.*`: 2343 + 2219 + 1093 + 1974 tests, all passing; the shard run supersedes it.)

## Remaining touched files (full paths)
- `frontend/src/features/panels/ui/CrossFilterIndicator.test.tsx` — indicator labels an empty value "(blank)", non-monospace (HEL-1424)
- `frontend/src/features/panels/ui/PanelInspectView.test.tsx` — Inspect header and button label a blank selection "(blank)"
- `frontend/src/features/panels/ui/buildChartOption.blankCategory.test.ts` — new: vertical/horizontal/pie relabel, literal "null", overlay alignment, click per orientation
- `frontend/src/features/pipelines/ui/outputHistory/HistoryChart.blank.test.tsx` — new: grouped history rows and vs overlay relabelled, rows-mode untouched
- `frontend/src/utils/blankLabel.test.ts` — new: unit tests for the shared label helpers
- `openspec/changes/blank-label-schema-nullability/.openspec.yaml` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
- `openspec/changes/blank-label-schema-nullability/design.md` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
- `openspec/changes/blank-label-schema-nullability/evaluation-1.md` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
- `openspec/changes/blank-label-schema-nullability/files-modified.md` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
- `openspec/changes/blank-label-schema-nullability/proposal.md` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
- `openspec/changes/blank-label-schema-nullability/skeptic-design-1.md` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
- `openspec/changes/blank-label-schema-nullability/skeptic-design-2.md` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
- `openspec/changes/blank-label-schema-nullability/skeptic-design-3.md` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
- `openspec/changes/blank-label-schema-nullability/specs/blank-category-label/spec.md` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
- `openspec/changes/blank-label-schema-nullability/specs/stored-schema-nullability/spec.md` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
- `openspec/changes/blank-label-schema-nullability/tasks.md` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
- `openspec/changes/blank-label-schema-nullability/ticket.md` — change artifact (spec/design/proposal/tasks/ticket/skeptic/evaluation/handoff), not product code
