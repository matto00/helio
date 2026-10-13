## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: fd8e8a78c2caaa71b8f645bbc2c4612ea205d408 (branch bug/blank-label-schema-nullability/HEL-1424; change dir untracked).
Owner rulings (escalation HEL-1424-1791873620011-3ecf7d) treated as settled and not reopened.

### What I verified (with evidence)

**Prior REFUTE items (rounds 1 and 2) are resolved in the artifacts**
- R1 CR1 (relabel ordering vs overlay alignment): D2 now relabels inside `buildChartOption` after `applyChartOverlay`.
  `buildChartOption.ts:254` (`applyChartTypeOptions`) and `:271` (`applyChartOverlay`) confirm the order. `alignByCategory`
  (`chartOverlayOption.ts:30-46`) keys on `String(c)` of the raw categories, so the raw `"null"` overlay point aligns
  before the relabel. Task 2.2 names the overlay test.
- R1 CR2 (history "vs"): D4 and task 2.5 relabel both the selected rows and the `selectPointOverlay` points. The spec
  has the "History vs comparison" scenario. `HistoryChart.tsx:22-40` is the only renderer of `summary.series`; grep found
  no other consumer.
- R1 CR3 (inference): D8 covers the streaming fold, skipping blank lines (matches `InProcessPipelineEngine.scala:807`
  `filter(_.trim.nonEmpty)`) and the deliberate update to `SchemaInferenceEngineSpec.scala:724-726`. The spec's
  "fully populated" scenario uses a file that ends in a newline.
- R2 CR1 (horizontal bar): D2 relabels whichever axis holds the categories. `chartTypeOptions.ts:131-136` swaps the
  category axis to `yAxis`. The click mapper rule `BLANK_LABEL && groupHasNull -> ""` covers every orientation. The
  spec has a horizontal scenario, and tasks 2.2/2.3 name tests for each orientation.
- R2 CR2 (refresh response): option (b) was taken. The spec says "after a refresh, the next list read". This matches
  `inferAndStoreRefreshedSchema` returning `Right(source)` (`DataSourceService.scala:1192`).

**Design claims checked against the tree (all hold)**
- `chartClickSelection.ts:151`: the mapping is `groupHasNull && name === "null"`. `ChartOutputPanel.tsx:107-110` uses a
  strict `=== null` predicate. `OutputPreviewPane.tsx:97-108` aggregates with no `groupHasNull`. The only two
  `groupAndAggregate` callers are these two, so both aggregate surfaces are covered.
- Server history stores "null": `OutputSummaryReducer.scala:41` groups by `jsString`, and `JsSemantics.scala:64` gives
  `JsNull => "null"`.
- `CrossFilterIndicator.tsx:23-24`, `PanelInspectView.tsx:129-133` (header) and `:157-158` (button) print the raw value.
- `SchemaField` has two fields (`SchemaField.scala`). Grep found no extractor/`unapply`/`tupled` uses in main or test
  that a third defaulted field would break. `schemaFieldJsonFormat` (`PipelineAnalyzeService.scala:82-102`) is used only
  by persistence and services, never by an `api/` wire protocol. The Output API projects to
  `OutputSchemaFieldResponse(name, type)` (`OutputProtocol.scala:194`), so there is no wire or contract change.
- CSV write sites: `createCsv` (`:313`) and `createCsvUrl` (`:379`). The refresh goes through `upsertSourceDataType`
  (`:1332-1339`), which text, pdf and image refresh share (`:1231/:1275/:1323`). D6 correctly limits `Some` to CSV.
  Every CSV creation goes through `createCsv`, including first-run templates (`FirstRunDashboardService.scala:90`).
  REST/SQL writes go through `CreateSourceEnvelope.scala:57` and stay `None`, as D6 says.
- Output write sites: exactly two `updateSchemaInternal` callers (`PipelineRunSucceededWrites.scala:146`,
  `PipelineRunBackfill.scala:169`). Both infer over the full `nodeJsRows` vector, the same rows written to the snapshot.
- The read pins match D7: `DataSourceProtocol.scala:258`, `PanelCapabilityService.scala:77` and
  `WorkspaceContextService.scala:396`. `InferredFieldResponse.fromDomain` has 7 per-kind call sites (`:445-504`), and
  only the CSV one gets `true`.
- No code branches on `.nullable` (backend: grep shows only response projections; frontend: display only, at
  `SourceDetailPanel.tsx:253` and `InferredFieldsTable.tsx:77`). Flipping a legacy CSV/Output to `true` therefore
  changes presentation only.
- The whitespace-only cell in the spec is covered by the current code. `parseRfc4180Row` trims every cell
  (`SchemaInferenceEngine.scala:302,309`), so the existing `cell.isEmpty` test already treats whitespace-only and
  quoted-whitespace cells as blank.
- The trailing-newline claim is correct. `csvLines` (`:241-278`) yields a final `""` after a terminating newline, which
  is the row `:724-726` pins today.
- AC3 is feasible and needs no protected-file changes. `SortCast.AsTimestamp` exists (`NodeSnapshotRepository.scala:23`),
  and `eq ""` is cast-independent (`NodeSnapshotFilterSql.scala:65`), so adding it to the loop at
  `CsvBlankCellsNullSnapshotSpec.scala:107` is a test-only change. The lookup test is at
  `CsvBlankCellsNullStepsSpec.scala:175-189`. None of C3's files (`TimestampParsing.scala`, `CastStep.scala`,
  `chartTimeAxis.ts`) is on any task's path.

**Adversarial checks**
- Placeholders/TBD: none. The one deferred check, "executor confirms Output write paths infer over full rows", is
  already true per the evidence above.
- Contradictions: none between the proposal, design, tasks and specs. The Non-goals are consistent with the owner's
  four-surface ruling.
- Scope: every AC maps to tasks. AC1 maps to 2.1-2.7 and 3.4/3.5, AC2 to 1.1-1.6, 3.3 and 3.7, and AC3 to 3.1/3.2.
  Nothing goes beyond the ticket. No migration ships (C2).
- Contract: no `/schemas` or OpenAPI delta is needed. The persisted JSON gains an optional key that old code ignores,
  and every wire response that already carries `nullable` keeps its shape.

### Verdict: CONFIRM

### Non-blocking notes
- **D3 plumbing is unnamed.** The design does not say how `blankCategory` reaches `buildChartOption` from
  `OutputPreviewPane`. That path goes ChartRenderer -> ChartPanel -> useChartOption, and the preview passes no
  `aggregationSpec` today. Either add a prop, or derive the flag from `aggregationSpec?.groupHasNull` and have the
  preview pass a spec. If the preview passes a spec, confirm the click handler stays inert without
  `onDataPointSelect` (`ChartPanel.tsx:105-112`). Whichever path is used, add the flag to the `useChartOption` memo deps.
- **Visual judgment at the final gate.** The indicator and the Inspect button render the value inside a `.mono` span.
  `(blank)` in monospace reads like a literal data value. Consider muted or non-mono styling for the placeholder, and
  say so in the DESIGN.md rule (D9). I will judge this in both themes at the final gate.
- **HEL-1444 label measurement.** If any category-label width or overprint measurement runs on the pre-relabel
  categories, `(blank)` (7 characters) is wider than `null` (4 characters). Check that the measured strings are the
  rendered ones.
- **Test churn from task 1.5.** Tests asserting `shouldBe SchemaField("x","string")` on schemas that pass through a CSV
  source, or on stored Output schemas, will now see `Some(..)`. Update them deliberately, and record any fixture change
  with its reason (a fixture edited to pass is a defect symptom).
