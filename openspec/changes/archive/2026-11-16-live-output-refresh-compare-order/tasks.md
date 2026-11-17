## Standing Constraints

- [C1] H direction is saved-to-schema (owner): rows routes return schema-ordered keys plus `columns`; the PR states the default column-order change for existing panels plainly.
- [C2] H proof is on the wire: a test reads the raw response body key order and is red on main; the fix survives spray-json's TreeMap and the browser's integer-like-key reordering.
- [C3] E overlay is dashboard-parity (owner): the unchanged `selectChartOverlay` / metric-delta code over the draft rows; the HEL-1632 parity test asserts identical overlays.
- [C4] E plain-chart tile is `LATEST <Y>` (owner): the last plotted point of the y field.
- [C5] D adds no draft-preview requests per draft change and keeps `DraftPreviewHeapSpec` under its bound; both measured and recorded in evidence.md.
- [C6] Reproduce D and H with red tests on unmodified code before building their fixes; record the red output in evidence.md.

## 1. Reproduce (red first, before any fix; ticket AC)

- [x] 1.1 Backend route test: raw body key order of `GET /api/outputs/:id/rows` for schema `zeta, 10, alpha` (+ one extra key) is not schema order on unmodified code; record red output
- [x] 1.2 Frontend test: an unfocused server-resolved displayed Output keeps "Select this step to update it" after a draft edit settles; record red output

### Backend

- [x] 2.1 Shared schema-order function (schema names, then extras code-point ascending) returning a `VectorMap`-backed `JsObject`
- [x] 2.2 Apply it and add `columns` in `OutputRowReads.rows` and `PublicPanelRowsResolver`
- [x] 2.3 Apply it and add `columns` on the history-payload rows route
- [x] 2.4 Draft-preview decoder/planner: optional `rowsStepIds` (max 8, distinct, in request) with 400s
- [x] 2.5 Draft-preview service: widen `retainOnly` to the extra ids; extra `rows` lines in list order (`available: false` when no outcome); `QueueCapacity` +8
- [x] 2.6 Schemas: draft-preview request and line (description), output rows, public panel rows, history payload responses
- [x] 2.7 Update CLAUDE.md's draft-preview endpoint line and rows-route lines for the new behaviour

### Frontend

- [x] 3.1 `buildDraftPreviewRequest` takes `outputNodeStepIds`; `rowsStepIds` = server-resolved [focus, displayed], deduped; key includes it
- [x] 3.2 Transport: `TransportView.rows` map of `{rows, truncated}`; `mapServerResolved` reads its own entry; `draftPreviewClient.ts` comment
- [x] 3.3 Lift the Output pick into `PipelineSpineLayout` and `PipelineMobileLayout` (column controlled; phone resolves against the Preview tab's step chain); pass the displayed node id
- [x] 3.4 `orderLiveColumns` extras code-point order; `recordsToPanelRows(records, columns?)` without `Object.values`
- [x] 3.5 Tables: `deriveKeys`/`useTableRows` take `columns` (natural sort fallback); history-payload `TableRenderer`, `PanelInspectView` (columnOrder still leads), `usePanelData` -> `OutputPanelContent` -> `TableRenderer` pass it
- [x] 3.6 Saved-path plumbing of `columns`: `fetchPanelPage`, `panelsSlice` window + page merge, `WARM_WINDOW_KEYS`/`StoredWindow`, `usePublicPanelData`, `useSavedOutputRows`
- [x] 3.7 Extract the `groupedPlot` guard and `selectMetricHistoryView` validity guards; port `deltaAndPct`; `selectDraftMetricComparison`
- [x] 3.8 Live column: overlay to `ChartRenderer` (rowsTruncated incl. rows-line `truncated`), comparison to `MetricRenderer`
- [x] 3.9 Live column: `LATEST <Y>` tile per D5 using the chart time plan's order
- [x] 3.10 Types for `columns` and `rowsStepIds`; helio-mcp types if `check:helio-mcp-types` requires

### Tests

- [x] 4.1 Turn 1.1 green; public panel rows and history-payload wire-order tests; integer-like key and an extra key in each
- [x] 4.2 Decoder/service specs: two rows lines in order, primary not repeated, 400 on >8 / duplicate / unknown id, old-client stream unchanged
- [x] 4.3 `DraftPreviewHeapSpec` adversarial shape: 8 extra ids on separate branches, each <= 1,000 rows near the text budget, sequential; later ones hit the memory limit; peak <= 96 MB recorded
- [x] 4.4 Turn 1.2 green; `draftStepView`/`draftPreviewRequest` unit tests incl. a truncated rows line with an untruncated sample
- [x] 4.5 Request-count measurement mounting `usePipelineDraftPresentation` (or the layout) with `postDraftPreview` mocked: 10-edit burst with vs without a non-focus Output displayed, equal counts; a mid-burst Output switch adds at most one; plus a phone case with an explicit pick of a non-focus Output; mutation (key churn) turns it red; record numbers
- [x] 4.6 `deltaAndPct` parity: shared JSON fixture asserted by ScalaTest and jest; null-latest-value case
- [x] 4.7 Extend `LiveOutputColumn.parity.test.tsx`: identical chart overlay and metric comparison vs the saved panel path
- [x] 4.8 Order tests: saved table panel and live table both `zeta, 10, alpha`; chart headers; warm-store round trip keeps `columns`; page merge; no-`columns` fallback
- [x] 4.9 `LATEST <Y>` tests: record order differs from plot order; last y null walks back; absent for pie, scatter, series field, aggregated, no y
- [x] 4.10 Running-app check: unfocused refresh, overlay, tile, saved table order at 1280 and 375, light and dark; screenshots in scratch
- [x] 4.11 Full gates: jest (maxWorkers 3), lint, typecheck, `sbt testFull` (read the summary), pre-commit hook
