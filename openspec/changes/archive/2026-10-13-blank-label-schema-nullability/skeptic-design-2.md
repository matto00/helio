## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD fd8e8a78c2caaa71b8f645bbc2c4612ea205d408 (planning artifacts untracked in the change dir).
The owner rulings from escalation HEL-1424-1791873620011-3ecf7d are settled. I judge only how they are implemented.

### What I verified (with evidence)

Round-1 change requests, re-checked against the live tree:
- **CR1 (D2 ordering): fixed for vertical charts.** `buildChartOption.ts:148` builds the option from raw
  `chartAggregate.categories`, and `:271` then calls `applyChartOverlay`. `alignByCategory` keys on `String(c)`
  over `xAxis.data` (`chartOverlayOption.ts:29-47`). A relabel run after `:271` therefore leaves alignment on raw
  keys. `groupHasNull` reaches `ChartRenderer` via `clickSpec` (`ChartOutputPanel.tsx:107-114`). Feasible.
- **CR2 (History "vs"): fixed.** `HistoryChart.tsx:24-41` builds `rawRows` from `series.points`, and
  `selectPointOverlay` (`chartOverlay.ts:134-156`) returns raw `comparison.points`. D4 relabels both, so they stay
  aligned. The server stores the string "null" for a null group (`OutputSummaryReducer.scala:41`,
  `JsSemantics.scala:65`). The spec now has a "vs" scenario.
- **CR3 (D8 nullability scan): fixed.**
  - D8 now says the scan is a streaming fold that skips blank lines, matching
    `InProcessPipelineEngine.scala:807`.
  - `parseRfc4180Row` trims cells (`SchemaInferenceEngine.scala:302,309`), so whitespace-only and quoted-blank
    cells still count as nullable. That matches the row loader's `v.trim.isEmpty -> null`.
  - The pinned test at `SchemaInferenceEngineSpec.scala:724-726` is called out for update. The spec scenario now
    uses a file that ends with a newline.
- **Round-1 note (content-kind refresh) folded into D6.** Only CSV passes `Some` through `upsertSourceDataType`
  (`DataSourceService.scala:1332-1339`).

Other claims checked:
- **Adding the third field is safe for existing call sites.** `SchemaField(name, type)` has no extractor or
  `apply`/`tupled` uses. Test sites use `SchemaField(_, "string")`, which compiles with a defaulted third
  parameter.
- **Output wire shape is unaffected.** `OutputResponse.schema` goes through a separate
  `OutputSchemaFieldResponse` (`OutputProtocol.scala:190`), and `output-schema-field.schema.json` has
  `additionalProperties:false`. So the persisted `nullable` key never leaks onto the Output wire. No contract
  delta is needed.
- **`InferredFieldResponse` / `PanelCapabilityColumnResponse` / `WorkspaceContextColumn` already carry a boolean
  `nullable`.** No schema delta is needed.
- **Output schema writes use the full node rows.** `PipelineRunSucceededWrites.scala:143` and
  `PipelineRunBackfill.scala:167` pass every row. `DataSourceRepository.scala:460` also calls
  `inferShallowFromJsObjects`, but it reads only `dataType`, so the new nullability does not affect it.
- **No `SchemaField` equality comparison found.** No `==`, `toSet` or `distinct` over `SchemaField` vectors in
  `domain/` or `services/pipelines`. Lookups are by name. Task 1.5 still audits this.
- **First-run templates are covered.** They create CSV sources via `createCsv`
  (`FirstRunDashboardService.scala:90`).
- **No placeholders. Every AC maps to tasks.**
  - AC1 -> 2.x, 3.4, 3.5
  - AC2 -> 1.x, 3.3, 3.7
  - AC3 -> 3.1, 3.2
  - C3 (HEL-1502 files) is respected.

New defects (each traced end to end in code):

**A. Horizontal bar charts are missed by D2, which also regresses HEL-1408's blank selection there.**
- D2 relabels only "category `xAxis.data` entries and pie `data[].name`", as a final step after
  `applyChartOverlay`.
- For a horizontal bar, `applyChartTypeOptions` (`buildChartOption.ts:254`, before the overlay at `:271`) swaps
  the axes: `chartTypeOptions.ts:131-136` makes the category axis (which holds the data) `yAxis`, and `xAxis`
  becomes the value axis. So D2's relabel finds no category `xAxis` and the bar still reads "null".
- A horizontal aggregated bar is reachable. `chartAggregationSpec` does not exclude it, and orientation is a user
  control in the Output editor (`OutputEditorSheet.labels.test.tsx:163-166`).
- D2 also *replaces* the click mapper's `"null"` check with `params.name === BLANK_LABEL`
  (`chartClickSelection.ts:151`). On a horizontal bar, ECharts still reports `params.name === "null"`, so the
  selection value becomes `"null"`, not `""`. "Filter dashboard" then cross-filters siblings on the literal text
  "null" and no longer matches their blank rows.
- That breaks AC1 ("Filter dashboard on blank rows keep matching null rows exactly as HEL-1408 made them") and
  the spec requirement "Aggregated charts label a null category (blank)" (bar, any orientation).
- No task or test covers the horizontal orientation.

**B. The spec promises refresh-response nullability that no task delivers.**
- `specs/stored-schema-nullability` says the CSV source's reported `inferredSchema` "(list, detail, create and
  refresh responses) SHALL carry that value".
- But `inferAndStoreRefreshedSchema` (`DataSourceService.scala:1186-1193`) discards the upserted row and returns
  `Right(source)`, the *pre-refresh* source. The refresh routes (`DataSourcePreviewRoutes.scala:60`,
  `SourcePreviewRoutes.scala:103`) render that stale source.
- So after a refresh, the response still shows the old schema: a legacy source reads all-`true`, and a changed
  column shows its old value.
- Task 1.4 only persists the value. Nothing changes the return value, and no refresh-response scenario or test
  exists. The spec line and the task list contradict each other.
- Also, there is no source "detail" endpoint (CLAUDE.md: no GET-by-id for data sources), so "detail" names a
  surface that doesn't exist.

### Verdict: REFUTE

### Change Requests
1. **design.md D2 + tasks 2.2/2.3 + specs/blank-category-label:**
   - Make the relabel target the *category* axis wherever it ended up: `xAxis` normally, `yAxis` after the
     horizontal-bar swap in `chartTypeOptions.ts:131-136`. Pie `data[].name` stays as it is. Alternatively,
     relabel before `applyChartTypeOptions` but after alignment. Either way, state the mechanism explicitly.
   - State the click-mapper rule so a click on a horizontal blank bar still yields `""`. One way: accept
     `params.name === BLANK_LABEL` (plus `groupHasNull`) after the relabel covers every orientation, and say why no
     raw `"null"` name can reach the mapper.
   - Add tests: `buildChartOption` with `chartOptions.bar.orientation: "horizontal"` and `blankCategory: true`
     shows `(blank)` on the y category axis, and a horizontal click on it maps to `""`.
   - Add a spec scenario for the horizontal bar.
2. **specs/stored-schema-nullability + task 1.4/3.3:** pick one and make the artifacts agree:
   - (a) add a task to make `inferAndStoreRefreshedSchema` return the upserted source
     (`upsertSourceDataType` already returns `Future[DataSource]`), plus a refresh-response scenario and test; or
   - (b) drop "refresh" (and the non-existent "detail") from the response list, and say that the refresh response
     reflects the stored value only on the next list read.

### Non-blocking notes
- **D6's "analyze-derived fields `None`" is only approximately true.** Fields passed through from a CSV source's
  schema keep their `Some(..)` through analyze, and a pipeline baseline schema serialized with
  `schemaFieldJsonFormat` will then include the key. It looks harmless: `SchemaFieldResponse` drops it,
  `PipelineSchemaDrift` compares name+type, and reads tolerate the key. The executor should confirm this in the
  1.5 audit rather than assume `None`.
- **Patch-set fingerprints may 409 once after deploy.** They hash the `DataSourceResponse` `inferredSchema`
  (`PatchSetTargetFingerprint.scala:35`), so a legacy CSV flipping false->true on read gives one 409 for a
  preview taken before deploy. Already accepted in Risks.
