## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 0c699d2633e5dedbc14cb3bddaca6147dd6b6025 (unmodified main plus the untracked change dir). Artifacts:
proposal.md, design.md, tasks.md, specs/{output-routes-api,pipeline-draft-preview-api,pipeline-live-output-column}/spec.md.
Owner rulings read from `.concertino/runs/HEL-1705/events.jsonl` (`escalation.answered`, sub_answers `saved-to-schema`,
`dashboard-parity`, `latest-y`).

### What I verified (with evidence)

**Round-2 change requests, both resolved**
- CR1 (memory). D2 now widens `retainOnly`, so the extra frames stay charged to the tally. Checked against
  `InProcessPipelineEngine.scala:568-575`: `releaseConsumed` calls `tally.remove` only for dropped keys, so any key in
  `keep` stays charged. That makes D2's claim true: no capture happens outside the tally, so held memory is bounded by
  the one budget. The behaviour cost is stated. 4.3's adversarial shape is explicit (8 branches, at most 1,000 rows
  each, near the text budget, run one after another, peak at or under 96 MB). The spec's live-memory requirement now
  says "including every frame retained for a requested `rows` line".
- CR2 (phone pick). D3 lifts `pick` into `PipelineMobileLayout` and passes it through `MobilePreviewTab`. It resolves
  against `previewChosenId`, then `defaultPreviewStepId`, then the first entry. That matches `MobilePreviewTab.tsx:59-62`
  and the phone mount (`selectedStepId={chosen.step.id}`, line 97). 4.5 adds a phone case.
- All five round-2 non-blocking notes are folded in:
  - D6 `columns` lists only present schema names.
  - D7 has Inspect use `columns`.
  - 4.5 states that a mid-burst switch adds at most one request.
  - The spec has an "Extra id not previewable" scenario.
  - D5 walks back to the last numeric y.

**Design claims checked against the tree**
- **D: single rows step.**
  - `buildDraftPreviewRequest` (`state/draftPreviewRequest.ts`) picks a single `rowsStepId`: the focus step, else the
    first server step.
  - `draftStepView.ts:124` reads rows only when `transport.rows?.stepId === stepId`.
  - `DraftPreviewService.scala:199` retains one key, and `rowsLine` (`:226-233`) emits one line, `available: false`
    when there is no outcome.
  - The plan to add a lookup per extra id fits this shape.
- **D: queue and decoder.** `QueueCapacity = MaxSteps + 2` (`DraftPreviewService.scala:34`), so +8 covers 8 more rows
  lines. `TopKeys` is at `DraftPreviewRequestDecoder.scala:20`, and the existing "must name a step" 400 is at `:198`.
- **D: pick and stale doc text.**
  - `LiveOutputColumn.tsx:71` holds `pick` as local state today.
  - `resolveDisplayedOutput` is pure, and `page.allOutputs` is available before `usePipelineDraftPresentation` is
    called (`PipelineSpineLayout.tsx:77`, `PipelineMobileLayout.tsx:133`). Lifting the pick creates no circular
    dependency.
  - The "exactly one rows line" text exists in `draft-preview-line.schema.json` and in the `draftPreviewClient.ts`
    header comment, as D1 says.
- **H: spray-json.** Version 1.3.6 is in the coursier cache. Its `JsonParser.scala:100` builds
  `members(TreeMap.empty)`, and `JsObject(fields: Map[...])` prints in map iteration order, so a `VectorMap`-backed
  `JsObject` keeps its order through `compactPrint`. Scala is 2.13.15 (`build.sbt:4`), so `VectorMap` is available.
- **H: the three read paths.** Each parses with spray: `NodeSnapshotRepository.scala:306` (`listRowsPaged`),
  `NodePayloadHistoryRepository.scala:156` (`findById`), and `PublicPanelRowsResolver` reuses `listRowsPaged`. Each
  path already holds `output.schema`, which `OutputRowsQuery.resolveSort(output.schema, ...)` reads.
- **H: client ordering.**
  - `recordsToPanelRows` uses `Object.keys(records[0])` and `Object.values` (`outputRenderInputs.ts:26-37`).
  - `deriveKeys` is at `tableRendererModel.ts:33`.
  - `inspectColumnKeys` is at `inspectColumnOrder.ts:22-42`.
  - `orderLiveColumns` puts extras in frame order (`frameRecords.ts:10-21`).
  - `WARM_WINDOW_KEYS` is at `warmStore.ts:50`.
- **E: overlay.** The `groupedPlot` guard and the `selectChartOverlay` call are at `ChartOutputPanel.tsx:112-119`.
  `selectChartOverlay` returns `null` unless `rowsTruncated === false` (`chartOverlay.ts:96`), so D4's boolean
  `rowsTruncated` fits.
- **E: metric.** `selectMetricHistoryView` returns `EMPTY_VIEW` when `history.current.value === null` and reads
  server `delta`/`pct`. That confirms D4's premise that the client has no delta arithmetic and that a separate
  draft-value selector is needed. `OutputHistoryService.deltaAndPct` (`:156-163`) matches D4's port description
  exactly: `pct` is `None` when `b == 0`, and non-finite values are filtered.
- **E: tile.** `planTimeAxis` and `resolveChartPlan` produce `time` with `timed` sorted by instant, and
  `category-fallback` with `ordered` (`chartTimePlan.ts:29-79, 125-155`), as D5 describes.
- **Rulings and constraints.** C1-C6 each trace to a design decision and a task:
  - C1: D6/D7, 2.1-2.3, the proposal's behaviour-change note.
  - C2: 1.1, 4.1, raw body.
  - C3: D4, 4.7.
  - C4: D5, 3.9, 4.9.
  - C5: D2/D3, 4.3, 4.5.
  - C6: 1.1, 1.2.
- **Ticket ACs.** Each AC maps to a task: red-first 1.x, D 4.4/4.5, E 4.7/4.9, H 4.1/4.8, running app 4.10.

### Verdict: CONFIRM

The design is sound and can be implemented as written. The round-2 blockers are fixed correctly against the engine's
real retention and tally semantics. The notes below are precision gaps that an implementer can resolve or that a
planned test will catch. None of them blocks execution.

### Non-blocking notes

- **Dashboard table plumbing is not named.** The authenticated dashboard path is `usePanelData` (`:320-322`, which
  calls `recordsToPanelRows`), then `OutputPanelContent.tsx:193`, then `TableRenderer`, then `useTableRows`. That last
  hook calls `deriveKeys(paginationRows)` and ignores `headers` in pagination mode. D7 and task 3.6 list
  `fetchPanelPage`, `panelsSlice`, the warm store, `usePublicPanelData` and `useSavedOutputRows`, but not
  `usePanelData` or a `columns` prop on `OutputPanelContent` and `TableRenderer`. Without that prop the most common
  saved table keeps its natural sort. Add these to 3.5/3.6. Make 4.8's saved-table case render through
  `usePanelData` and `OutputPanelContent`, not `TableRenderer` directly, so the gap cannot pass the test.
- **Inspect and `columnOrder`.** `inspectColumnKeys` puts present `columnOrder` keys first (HEL-1394). D7's "uses
  `columns` outright" can be read as dropping that. State that `columnOrder` still leads and that `columns` replaces
  only the schema-plus-natural-extras tail. This matches how D7 already treats tables.
- **Page merge rule.** D7 says a later page appends "new extras" and re-sorts the extras tail. A schema name absent
  from page 1 but present on page 2 belongs at its schema position, not in the extras tail. Say how the merge tells
  the two apart: it can use `output.schema`, or it can re-derive with the server's rule over the union.
- **Draft value type.** `metricLoadedValue` returns a string (`""` when there is no value). State how
  `selectDraftMetricComparison` gets its number: `Number()`, and `""` or NaN treated as null.
- **`area` is not a chart type.** D5 and the spec say "line, area or bar", but `CHART_TYPES` is
  `bar, line, pie, scatter, heatmap, histogram` (`utils/chartTypes.ts:3`). Drop "area", or say what it means here
  (for example, a line chart with area fill).
- **Unexplained "Output limit".** The spec's "Select this step to update it" note gives "the server-resolved Output
  limit was exceeded" as its example. The client sends at most two ids, so no such limit applies to it. A real example
  would be a node with no rows line, or a superseded or failed request.
- **Fallback chain.** D3's phone chain includes "else the first entry". `PipelineMobileLayout.tsx:129-131` today has
  no `entries[0]` fallback for `focusStepId`. Keep the displayed-Output resolution and the tab's `chosen` derivation on
  the same function so they cannot drift.
