## Context

Three HEL-1685 addenda (D, E, H) on the HEL-1632 live Output column. Owner rulings on this run (escalation.answered,
2026-11-16, sub_answers `saved-to-schema`, `dashboard-parity`, `latest-y`) settle H's direction and both E questions.

Ground truth found while planning:
- D: `buildDraftPreviewRequest` (`frontend/src/features/pipelines/state/draftPreviewRequest.ts`) sends exactly one
  `rowsStepId` (the focused step, else the first server step). `mapServerResolved` (`state/draftStepView.ts`) only takes
  rows when `transport.rows.stepId === stepId`; otherwise `frameStale`, which `liveOutputSource.ts` maps to
  `SELECT_STEP_HINT`. The server (`DraftPreviewService.walk`) retains one node via `retainOnly` and emits one `rows` line.
- H: the ticket says draft-preview order is not deterministic. Not so: the live column reorders every frame by the
  Output schema (`orderLiveColumns`, `state/liveOutput/frameRecords.ts`). The saved path is deterministic but
  alphabetical: `node_snapshots.data` is JSONB and `NodeSnapshotRepository.listRowsPaged` parses it with spray-json
  1.3.6, whose `JsonParser` builds a `TreeMap`. Browsers then enumerate integer-like keys first. Chart/metric/collection/
  timeline panels read headers from `Object.keys(records[0])` (`recordsToPanelRows`); table panels natural-sort keys
  (`deriveKeys`, `tableRendererModel.ts:33`, HEL-127). Neither is schema order.
- E: dashboard chart overlay = `selectChartOverlay(history, config, ctx)` (`panels/history/chartOverlay.ts`) in
  `ChartOutputPanel.tsx`; metric comparison = `selectMetricHistoryView` (`panels/history/metricHistoryView.ts`) in
  `MetricOutputPanel.tsx`. The live column already reads the same history cache entry with `configCompare(config)`
  (`hooks/useLiveOutputBaseline.ts`), so E needs no new request.

## Decisions

D1 (D, wire). Optional `rowsStepIds: string[]` (max 8, distinct, each a step in the request); `rowsStepId` unchanged. The
server emits the `rows` line for `rowsStepId`/default first, then one per further id in list order (an id equal to the
primary is not repeated). Line shape unchanged. Decoder adds the key to `TopKeys` with 400s; `QueueCapacity` grows by 8.
Doc sync: `draft-preview-line.schema.json` description, CLAUDE.md's endpoint line and `draftPreviewClient.ts:12` say
"exactly one rows line" today; all three are updated. Rollout: old clients never send the key; a new client against an
old backend gets a 400 shown as "Preview unavailable. It will retry on your next change." (stated in the PR).

D2 (D, memory). Widen `retainOnly` to the primary key plus every extra id, so each requested frame stays charged to
the engine's `LiveCellTally` (`releaseConsumed` only removes dropped keys; `InProcessPipelineEngine.scala:568-575`) and
the request's held memory stays inside the one live-cell budget. No capture outside the tally. The `rows` lines read
`outcomes` for each id, like the primary. Behaviour cost (accepted): a draft that sits close to the budget today can now
get `Draft preview memory limit` on a later step because the displayed Output's frame is held; the client sends at most
the focused step plus one displayed node, so this is one extra frame. An extra id that resolves to no outcome (unavailable,
errored, pruned) gets an `available: false` rows line, like the primary. Heap proof (4.3): an adversarial shape of 8
extra ids, each on its own branch, each a frame of at most 1,000 rows whose text weight approaches the budget, evaluated
one after another; later branches must hit the memory limit and the measured peak must stay at or under 96 MB.

D3 (D, client). The explicit Output pick leaves `LiveOutputColumn` local state; the column becomes controlled
(`pick`, `onPick` props) in both mounts. Desktop: `PipelineSpineLayout` holds `pick` and resolves the displayed Output
with `resolveDisplayedOutput(outputs, pick, selectedStepId)` using its fresh `selectedStepId`. Phone:
`PipelineMobileLayout` holds the Output `pick` alongside `previewChosenId` and passes `pick`/`onPick` through
`MobilePreviewTab` to the column; it resolves against the Preview tab's resolved step (`previewChosenId`, else
`defaultPreviewStepId`, else the first entry, the chain at `MobilePreviewTab.tsx:59-62`), never `focusStepId`. Each layout
passes the displayed Output's `nodeStepId` to `usePipelineDraftPresentation` -> `buildDraftPreviewRequest({...,
outputNodeStepIds})`, which sends `rowsStepIds` = server-resolved ids among [focus, displayed node], deduped, in that
order. The id is sent whether or not the column is visible (collapsed disclosure, phone Steps tab): same request, no
extra send, and the frame is current when revealed. `TransportView.rows` becomes `ReadonlyMap<stepId, {rows: Frame;
truncated: boolean}>`; `mapServerResolved` reads its own entry. No scheduler change. Switching the displayed Output
under a draft changes the key and adds at most one paced send. Measurement (4.5): the burst with a non-focus Output
displayed sends exactly as many requests as without; a mid-burst switch adds at most one.

D4 (E, overlay). `LiveOutputRender` passes `overlay` to `ChartRenderer` from the unchanged `selectChartOverlay(history,
config, {filterActive: false, rowsTruncated, rawRows, headers})` behind the `groupedPlot` guard, extracted from
`ChartOutputPanel.tsx:112-118` into a shared function both use. `rowsTruncated` = `sampleTruncated ||
rowsEntry.truncated` for a server-resolved frame, `sampleTruncated` for a client frame, the saved read's truncation for
saved rows. Metric: the client has no delta arithmetic (`selectMetricHistoryView` reads server `delta`/`pct`), so port
`OutputHistoryService.deltaAndPct` exactly: `delta = cur - base`; `pct = delta / |base| * 100`, `null` when `base == 0`;
any non-finite result `null`; `null` when either side is null. A shared JSON fixture of (cur, base, delta, pct) cases,
including 0, negative and non-finite bases, is asserted by a ScalaTest on the Scala function and a jest test on the port.
`selectDraftMetricComparison(history, config, draftValue)` reuses `selectMetricHistoryView`'s validity guards (compare
matches config, point matches the resolved field; extracted, not copied) but does not require `history.current.value`, so
a null latest value with a valid baseline still yields a delta against the draft value. No sparkline (non-goal).

D5 (E, tile). `LATEST <Y>` only for a chart whose resolved type is line or bar, with no aggregation spec, no
`seriesField`, and `fieldMapping.xAxis` and `fieldMapping.yAxis` (single strings) mapped; never for pie, scatter,
heatmap, histogram or multi-series. The point is the last of the row order `resolveChartPlan`/`planTimeAxis`
(`utils/chartTimePlan.ts`) produces for the chart (`timed` for a time plan, `ordered` for the category fallback, record
order only when the plan says so), read through the same plan the renderer uses. If the last plotted row's y is null or non-numeric, the tile walks back
to the last plotted row with a numeric y; with none it is absent. Formatting matches the aggregate tile.

D6 (H, server). One Scala function orders a parsed row: schema names present, then other keys in ascending code-point
order, as a `JsObject` over a `VectorMap` so `compactPrint` keeps it. Applied in `OutputRowReads.rows`,
`PublicPanelRowsResolver` and the history-payload read (`NodePayloadHistoryRepository.findById` parses with the same
spray parser). Each response gains `columns: string[]`: schema names present in at least one row of the page (all
schema names on an empty page; nothing beyond what rows expose) then extra keys seen on the page in code-point order.
Live `orderLiveColumns` already keeps only present schema names, so both sides agree when schema and rows drift. Schemas updated: output rows, public panel rows,
history payload, draft-preview request and line. Proof on the wire: route tests read the raw body text; red on main.

D7 (H, client). One ordering rule everywhere: schema, then extras code-point ascending. `orderLiveColumns` sorts its
extras the same way (today: frame order). `recordsToPanelRows(records, columns?)` takes headers from `columns` and
builds each raw row as `columns.map(c => row[c])`, never `Object.values`. Tables: `deriveKeys(rows, columns?)` and
`useTableRows` use `columns` when given (configured `columnOrder` still applies on top, unchanged); without `columns`
the HEL-127 natural sort stays as the fallback, so its tests keep passing unchanged. The history-payload view's
`TableRenderer` receives the same `columns`. Inspect (`inspectColumnKeys`, `inspectColumnOrder.ts:22-42`) uses
`columns` outright when present (its HEL-1394 natural-extras behaviour stays as the no-`columns` fallback). `DataGrid.deriveColumns` stays for its other
callers (sources, step preview), which have no Output schema. Saved-path plumbing: `fetchPanelPage`'s result, the
`panelsSlice` window, `StoredWindow`/`WARM_WINDOW_KEYS` (and its allow-list test), `usePublicPanelData`'s cache and
`useSavedOutputRows` all carry `columns`. Pages merge by keeping the existing list and appending new extras from a later
page, then re-sorting the extras tail by code point. A window with no `columns` (old warm entry) renders as today.

D8 (round-3 precision notes, binding). (a) Dashboard table plumbing: `usePanelData` -> `OutputPanelContent` ->
`TableRenderer` -> `useTableRows` (which calls `deriveKeys(paginationRows)` in pagination mode) all carry a `columns`
prop; the saved-table test renders through `usePanelData` + `OutputPanelContent`. (b) Inspect: present `columnOrder`
keys still lead; `columns` replaces only the schema-plus-natural-extras tail. (c) Page merge re-derives with the server
rule over the union of pages' keys using `output.schema` (a schema name first seen on page 2 takes its schema place).
(d) `selectDraftMetricComparison` takes `Number(metricLoadedValue(...))`, treating `""`/NaN as null. (e) The phone's
displayed-Output step and the Preview tab's `chosen` derive from one shared function.

## Risks / Trade-offs

- Existing dashboards with no column config / no x-axis mapping change default column order (owner accepted; PR says so).
- helio-mcp reads `/api/outputs/:id/rows`; an added `columns` field must pass `check:helio-mcp-types`.

## Planner Notes

- Self-approved: D1 keeps `rowsStepId` for old clients rather than replacing it; cap 8 mirrors the roots/lanes caps.
- Self-approved: extras outside the schema use code-point order on every path (server can't reproduce `Intl.Collator`).
- The rows-order requirement lives in `output-routes-api`, which already holds the public panel rows route's contract
  alongside `public-dashboards`; one requirement names all three routes rather than duplicating it.
- `OutputPreviewPane.tsx:68` (output editor) keeps `Object.keys`; not a saved-panel path, out of scope.
- Reproduce first (ticket AC): tasks 1.x are red tests on unmodified code before any fix.
