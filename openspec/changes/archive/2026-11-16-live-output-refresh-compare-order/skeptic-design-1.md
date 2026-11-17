## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 0c699d2633e5dedbc14cb3bddaca6147dd6b6025 (planning artifacts are uncommitted in the worktree). Owner rulings
(escalation HEL-1705-1794878026855-00ebb1: `saved-to-schema`, `dashboard-parity`, `latest-y`) are taken as binding; this report
only checks whether the design implements them soundly.

### What I verified (with evidence)

Claims that hold:
- D, client: `buildDraftPreviewRequest` sends exactly one `rowsStepId` (`frontend/src/features/pipelines/state/draftPreviewRequest.ts:118-119`);
  `mapServerResolved` takes rows only when `transport.rows?.stepId === stepId` (`state/draftStepView.ts:124`), else `frameStale`,
  which `liveOutputSource.ts:79-80` maps to `SELECT_STEP_HINT`. The transport reducer keeps one rows value
  (`hooks/useDraftPreviewTransport.ts:51-54`). Confirmed.
- D, server: `DraftPreviewService` passes `retainOnly = Some(Set(<rowsStepId or root>))` (`DraftPreviewService.scala:199`) and emits
  one `rowsLine` (`:227-233`). `onNodeFrame` fires for every successfully evaluated step, including a disabled one, while the parent
  is still retained (`InProcessPipelineEngine.scala:601-612`). `rowsStepIds` can only name steps, never a root, so D2's
  "falls back to `retainOnly`" branch for roots is moot. `QueueCapacity = MaxSteps + 2` (`:34`). Confirmed.
- H, server: `listRowsPaged` parses `data::text` with spray-json (`NodeSnapshotRepository.scala:303-306`); spray-json is 1.3.6
  (coursier cache) and its `JsonParser` builds objects from `TreeMap.empty` (`spray/json/JsonParser.scala:100`, extracted from
  the sources jar). `PublicPanelRowsResolver.scala:80-90` uses the same `listRowsPaged`. `NodePayloadHistoryRepository.findById`
  parses `rows::text` with `parseJson` (`:152-158`). So all three routes share the alphabetical order. Confirmed. (Postgres
  JSONB also normalises key order, so insertion order is lost before parse anyway; the design's reorder-by-schema handles that.)
- H, live: `orderLiveColumns`/`frameToRecords` (`state/liveOutput/frameRecords.ts:10-43`) build schema-ordered records, but
  `Object.defineProperty` still enumerates integer-like keys first, so `recordsToPanelRows`'s `Object.keys(records[0])`
  (`features/panels/ui/outputRenderInputs.ts:32`) is integer-first. D7's `columns` argument is the right fix for this path.
- E: `selectChartOverlay` exists (`panels/history/chartOverlay.ts:87`) and `ChartOutputPanel.tsx:112-118` applies the
  `groupedPlot` guard inline. `useLiveOutputBaseline` already reads the history cache with `configCompare(config)`
  (`hooks/useLiveOutputBaseline.ts:21-27`). Confirmed.
- E, plot order: `buildDataOptionCore` reorders raw rows. A time plan plots `plan.timed` in instant order and a category
  fallback replaces `rawRows` with `plan.ordered` (`panels/ui/chartDataOptions.ts:126-128`). So the renderer does **not** plot in
  record order for a timestamp x. D5's "find it" instruction holds, and the answer is `planTimeAxis`.
- Schema files named in D6 all exist; `draft-preview-request.schema.json:130` defines `rowsStepId`.

Claims that do not hold, or gaps that block implementation: see Change Requests.

### Verdict: REFUTE

### Change Requests

1. **H misses the table path, the most common order-dependent render.** The design says "Panels read headers from
   `Object.keys(records[0])`". That is true for chart, metric, collection and timeline. It is false for a saved **table**
   panel. `TableRenderer` → `useTableRows` → `deriveKeys` (`panels/ui/renderers/useTableRows.ts:68`,
   `tableRendererModel.ts:33-38`) natural-sorts the keys with `Intl.Collator({numeric:true})`, whatever the wire or record
   order. `DataGrid.deriveColumns` (`shared/ui/DataGrid.tsx:402-409`) and `HistoryRows`' `TableRenderer` behave the same way.
   With D6 and D7 as planned, a saved table with no column config still shows `10, alpha, zeta`. The live `LiveTable` would
   show `zeta, 10, alpha`. The spec scenario "Same column order live and saved" fails for tables, and the proposal's
   behaviour-change statement ("dashboards with no column config change … to schema order") is wrong for tables. The owner
   ruled on context that named "table with no column config" as an affected render, so the ruling covers tables. Revise
   D7/tasks to say how a table with no `columnOrder` gets schema order:
   - `useTableRows`/`deriveKeys` take `columns` (or the schema) ahead of the natural sort.
   - Say whether `DataGrid.deriveColumns` and the history-payload `TableRenderer` follow.
   - Reconcile the extra-key rule: the server sorts extras "ascending" (code point), while the client's table and Inspect
     (`inspectColumnOrder.ts`) use the natural collator. Pick one and state it.
   - Add a table case to task 4.7. Name the HEL-127 natural-sort tests that will change on purpose.

2. **D7 does not say where `columns` lives on the saved-panel path.** Saved rows do not reach `usePanelData` straight from
   the response:
   - The flow is `fetchPanelPage` (`panels/state/panelThunks.ts:327-390`, which returns only `rows`, `hasMore`, `materialized`,
     `total`, `metric` and `generation`) → `panelsSlice` `paginationState` → `paginationEntry.rows`
     (`usePanelData.ts:320-322`).
   - Pages are appended by "Load more".
   - The window is persisted by the HEL-1575 warm store through an explicit allow-list (`WARM_WINDOW_KEYS` / `StoredWindow`,
     `dashboards/tabs/warm/warmStore.ts:9-60`) that would drop `columns`. A warm-restored dashboard would then render in a
     different order from a freshly fetched one.

   Specify:
   - (a) `columns` is added to the thunk result, the slice window and `StoredWindow`/`WARM_WINDOW_KEYS`, plus its key
     allow-list test.
   - (b) How `columns` merges across appended pages, since extras are "seen on the page".
   - (c) The fallback when a window has no `columns` (an old warm entry, or `usePublicPanelData`'s cache).
   - (d) `useSavedOutputRows` stores `columns` too.

3. **D4's metric arithmetic premise is false.** The design says "re-derive delta/pct … through the same arithmetic the view
   uses (extract it if it is inline, do not reimplement)". The client has no such arithmetic. `selectMetricHistoryView` reads
   server-computed `history.delta` and `history.pct` (`panels/history/metricHistoryView.ts:133-151`). The formula lives only
   in Scala: `OutputHistoryService.deltaAndPct`, `delta = cur - base`, `pct = delta / |base| * 100`, `None` when
   `base == 0` or non-finite (`OutputHistoryService.scala:155-161`). An executor told "do not reimplement" has no compliant
   path. State that a client port is required, give its exact formula including the zero-base and non-finite rules, and
   require a test that pins it to the Scala function on shared fixture values. Also state the behaviour when the server
   `delta` is `null` but a baseline exists, for example when the latest history value is null but the draft value is not.
   Today's view emits no `delta` comparison in that case.

4. **D4's `rowsTruncated` source misses the draft-preview response cap.** D4 says "`rowsTruncated` is `sampleTruncated` for a
   draft/sample frame". A server-resolved node's rows come from a `rows` line capped at 1,000 rows with its own `truncated`
   flag. A node can exceed 1,000 rows even when the root sample is not truncated, for example after a join or explode. The
   transport discards `truncated` (`useDraftPreviewTransport.ts:51-53`). The spec requires the overlay hidden "including rows
   that are a truncated sample", and `selectChartOverlay` hides it whenever `rowsTruncated !== false`. Require the
   per-step rows entry in the new `TransportView.rows` map to carry `truncated`. Set `rowsTruncated = sampleTruncated ||
   rowsLine.truncated` for server-resolved frames, and add a test with an untruncated sample and a truncated rows line.

5. **D3 does not say how the page learns the displayed Output.** The explicit `pick` is local `useState` inside
   `LiveOutputColumn` (`ui/liveOutput/LiveOutputColumn.tsx:70-72`). The request is built higher up, in
   `usePipelineDraftPresentation`, called from `PipelineSpineLayout.tsx:77` and `PipelineMobileLayout.tsx:133`. D3 says "the
   page passes … via `resolveDisplayedOutput`" without saying that `pick` must move up. There are two readings:
   - Lift `pick` into both layouts and make the column controlled. The mobile tab's `chosenId` already does this, "held by the
     layout, which needs it for the draft transport" (`MobilePreviewTab.tsx:39`).
   - Report the shown Output up via an effect or callback. This changes the request key a render late and can cost an extra
     request.

   Mandate the first. Say which `selectedStepId` resolves the pick: the column resolves against a coalesced
   `shown.selectedStepId`, while the layout sees the fresh one. Say whether a collapsed `disclosure` column or the mobile Steps
   tab, where no Output is visible, still adds the Output's node to `rowsStepIds`.

6. **The D3/4.5 request-count measurement can pass without testing anything.** As written ("drives the real scheduler with a
   fake clock over a 10-edit burst with an unfocused server-resolved Output displayed"), it can be met at scheduler level.
   There, "an Output displayed" does not exist as an input, so equal counts are guaranteed and prove nothing about the
   wiring. The extra-request risk is in the wiring (CR5), not in the scheduler. Require the measurement to mount the real
   layout, or at least `usePipelineDraftPresentation` plus the lifted pick, with `postDraftPreview` mocked. Count real sends
   for the same burst with and without a non-focus Output displayed, and include an Output switch mid-burst. Also require a
   mutation check: making the key churn (for example dropping the dedupe or ordering of `rowsStepIds`) must turn the test red.

7. **The draft-preview spec delta contradicts the live spec it leaves in place.**
   - `openspec/specs/pipeline-draft-preview-api/spec.md:13` requires "exactly one final `rows` line", and `:151` says "The
     final `rows` line SHALL carry at most 1,000 rows". The delta only ADDs a requirement for several rows lines, so the
     archived spec would contradict itself. Change it to MODIFY the "Draft preview streams per-step lines before the final
     rows line" requirement and the cap sentence.
   - The design says "Line schema unchanged", but `schemas/pipelines/draft-preview-line.schema.json`'s description says
     "then exactly one `rows` line". Add a task to update that description.
   - Add a task for the same sentence in `CLAUDE.md`'s endpoint list (`POST /api/pipelines/:id/draft-preview` … "then exactly
     one final `rows` line").
   - Add a task for the module comment in `services/draftPreviewClient.ts:12`.

8. **D5 is underspecified for chart shapes other than a single-series x/y line.** "A chart with `keyAggregate === null` and a
   mapped y field" covers bar, scatter, pie, heatmap and multi-series (`seriesField`, `buildTimeMultiSeries`) charts. The
   "last plotted point" is undefined or meaningless for pie, heatmap and colour-grouped scatter. For multi-series, it is
   unclear whose last point counts. "First y field when several are mapped" does not match the config: `fieldMapping.yAxis`
   is a single string. Name the chart types and series shapes that get the tile, and those that don't. Name `planTimeAxis`
   (time plan `timed`, category fallback `ordered`) as the order source rather than leaving "if the renderer plots record
   order" open, and require a test where record order differs from plot order.

### Non-blocking notes
- D6: on the public panel route, `columns` built as "union over schema" lists schema names even on an empty page. The rows
  already expose every key, so nothing new leaks, but state it.
- The output editor's `OutputPreviewPane.tsx:68` also uses `Object.keys(rows[0])`. It is not a saved-panel path, but it will
  still be integer-first after this change. Consider it, or note it as out of scope.
- D2: `take(1000)` must be taken from a strict collection, so a lazy frame does not pin its whole source. Rely on the 4.3
  HeapSpec measurement to catch this. The captured rows are outside the live-cell tally; say so in the design.
- The `output-routes-api` delta also governs the public panel rows route. Check that capability is the one the public route's
  existing requirement lives in.
