## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD fd8e8a78c2caaa71b8f645bbc2c4612ea205d408 (planning artifacts untracked in the change dir).
Owner rulings (label, four surfaces, history relabel, persist-going-forward / no V130) treated as settled; only
their implementation is judged.

### What I verified (with evidence)

Citations confirmed against the live tree:
- `utils/aggregate.ts:113` keys groups by `String(row[groupBy])`; `chartClickSelection.ts:151` maps `"null"` -> `""`
  only when `groupHasNull`; `ChartOutputPanel.tsx:107-113` computes strict `=== null` `groupHasNull`;
  `chartDataOptions.ts:232-260` renders `aggregate.categories` as axis data / pie names; `OutputPreviewPane.tsx:97-110`
  aggregates without `groupHasNull`.
- `CrossFilterIndicator.tsx:22-25`, `PanelInspectView.tsx:129-133` (header) and `:157-158` (button) print the raw value.
- Server history: `OutputSummaryReducer.scala:41` groups by `jsString`, and `JsSemantics.scala:64` maps `JsNull -> "null"`.
- `SchemaField(name, type)` with its `require`; `schemaFieldJsonFormat` writes `{name,type}` only
  (`PipelineAnalyzeService.scala:82-102`); no `case SchemaField(` extractor patterns exist (0 hits), so adding a
  defaulted third field won't break any pattern matches.
- Output writes: `PipelineRunSucceededWrites.scala:143-146` and `PipelineRunBackfill.scala:167-169` call
  `inferShallowFromJsObjects(nodeJsRows)` over the **full** materialized node rows (D8's open question is answered:
  not sampled). `inferShallowFromJsObjects` hardcodes `nullable = false` (`SchemaInferenceEngine.scala:197`), and the
  comment at :167-169 is out of date, as the design says.
- Pinned-false reads: `DataSourceProtocol.scala:257-258`, `PanelCapabilityService.scala:77`,
  `WorkspaceContextService.scala:396`. `PipelineNodeReads.scala:233` (node capabilities) is also pinned false and is
  correctly out of scope.
- CSV writes: create `DataSourceService.scala:311`, URL create `:377`, refresh via `inferAndStoreRefreshedSchema`
  (`:1186-1192`) -> shared `upsertSourceDataType` (`:1338`).
- AC3 targets exist: `CsvBlankCellsNullSnapshotSpec.scala:105-107` loops `AsText, AsNumeric` only, and
  `SortCast.AsTimestamp` exists (`NodeSnapshotRepository.scala:23`). The lookup test is at
  `CsvBlankCellsNullStepsSpec.scala:175`.
- DESIGN.md "Nulls sort last" anchor exists (`DESIGN.md:603`).
- No placeholders/TBDs. Every AC maps to tasks (AC1 -> 2.x/3.4/3.5, AC2 -> 1.x/3.3/3.7, AC3 -> 3.1/3.2). C3 (HEL-1502
  files) is respected: the plan only imports `chartTimeAxis.ts` and never edits it.

Defects found (each reproduced by reading the code path end to end):

**A. D2's ordering is impossible in the real pipeline.** D2 says to relabel "as the last step before the option is
built, i.e. after any history-overlay alignment by raw key". But overlay alignment runs *after* the option is built:
`buildChartOption.ts:148` builds the data option from `chartAggregate.categories`, and only then does
`buildChartOption.ts:271` call `applyChartOverlay`. That function aligns by `String(c)` over the built option's
`xAxis.data` (`chartOverlayOption.ts:30-46, 89-97`). So "before build" and "after alignment" cannot both hold.
- The natural reading is to relabel `chartAggregate` in `ChartOutputPanel`. Then `xAxis.data` holds `"(blank)"`, the
  overlay map is keyed `"null"`, and the blank group gets no overlay point. That breaks the spec scenario "Overlay
  aligns on the blank group".
- `groupHasNull` doesn't reach `buildChartOption` today: it only rides on the click spec.

**B. D4 ignores the History view's own "vs" overlay.** `HistoryChart.tsx:24-40` draws the selected point's series as
`rawRows` and the comparison point's series as an overlay via `selectPointOverlay`. That overlay returns raw
`comparison.points` (`chartOverlay.ts:134-156`), and `applyChartOverlay` aligns it by `String(x)`. If only the
primary grouped series is relabelled to "(blank)", the comparison's `"null"` category no longer matches and the blank
group's comparison bar silently disappears. Neither the design nor the spec covers this path.

**C. D8's full-row scan makes nearly every real CSV report all columns `nullable: true`.**
- `csvLines` emits a trailing empty line after a final newline (doc at `SchemaInferenceEngine.scala:259-261`).
  `parseRfc4180Row("")` plus `padTo` turns it into an all-empty row, and the fold marks every column nullable.
- An existing test pins this: `SchemaInferenceEngineSpec.scala:724-726`,
  `fromCsv("a,b\n1,2\n").fields.map(_.nullable) shouldBe Seq(true, true)`.
- Today that only hits files with 100 rows or fewer. With "every data row", it hits every file ending in a newline,
  which is almost all of them.
- The row loader skips blank and whitespace-only lines (`InProcessPipelineEngine.scala:807`,
  `lines.tail.filter(_.trim.nonEmpty)`), so the stored nullability would contradict the materialized rows.
- The spec scenario "Fully populated column is not nullable" would fail on a normal file. A test written without a
  trailing newline would pass while proving nothing.
- Separately, `fromCsvBytes` documents that it reads only the head so an upload never becomes a file-sized value
  (`:38-40`). The current `lines.take(N).toVector` must not become a whole-file `toVector`. The design should say the
  scan stays a streaming fold.

### Verdict: REFUTE

### Change Requests
1. **design.md D2 (and tasks 2.2/2.5):** replace the impossible ordering with one concrete mechanism. Either option
   works:
   - (a) Relabel in `ChartOutputPanel`/`OutputPreviewPane` (aggregate categories) and also relabel the overlay's
     `"null"` x when `groupHasNull`. Note that `selectChartOverlay` has no `groupHasNull` today, so say where that
     mapping happens.
   - (b) Plumb `groupHasNull` into `buildChartOption` and relabel `xAxis.data`/pie `data[].name` after
     `applyChartOverlay` (`buildChartOption.ts:271`).

   Whichever is chosen, tasks must name a test that renders a live aggregated chart with a null group plus a
   grouped baseline holding `"null"`, and asserts that the overlay value lands on the `(blank)` category (the spec
   scenario "Overlay aligns on the blank group").
2. **design.md D4 + specs/blank-category-label:** relabel `"null"` to `(blank)` in **both** the selected and the
   comparison grouped series in `HistoryChart` (only when `series.mode === "grouped"`), or relabel inside
   `selectPointOverlay`'s output. Add a scenario plus a test: two grouped history points both holding `"null"`, and
   the comparison overlay has a value at `(blank)`.
3. **design.md D8 + specs/stored-schema-nullability + tasks 1.2/3.3:**
   - The nullability fold skips blank/whitespace-only lines, matching the row loader at
     `InProcessPipelineEngine.scala:807`.
   - The scan stays a streaming fold over the line iterator, never a whole-file `toVector`.
   - The pinned test at `SchemaInferenceEngineSpec.scala:724-726` is updated deliberately: a trailing newline no
     longer marks columns nullable.
   - The "fully populated column is not nullable" scenario and its test use a file that ends with a newline.
   - Check the multi-row byte/String parity test at `:728+` still holds.

### Non-blocking notes
- `upsertSourceDataType` (`DataSourceService.scala:1332-1339`) is shared by CSV, text, pdf and image refresh. D6 says
  content kinds stay `None`, so passing `Some(f.nullable)` there would write `Some(false)` for them. The reported
  value is identical (all their `DataField`s are `nullable = false`), but either thread the choice per caller or
  amend D6 so the executor doesn't have to guess.
- `FieldOverridePayload` (`DataSourceProtocol.scala:229`) has no `nullable`, so the add-source modal's nullable
  checkbox (`InferredFieldsTable.tsx:77-78`) is still ignored server-side. This is pre-existing and out of scope, but
  once nullability is persisted the user's toggle and the stored value can visibly disagree. Consider a follow-up.
- Two categories reading "(blank)" (a null group plus a literal "(blank)" text) produce duplicate ECharts category
  names. This was already accepted in Risks; fine.
