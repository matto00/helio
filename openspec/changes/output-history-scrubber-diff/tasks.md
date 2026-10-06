## Standing Constraints

- [C1] Q1=A: scrubber is a per-Output History view opened from each Output card in the Outputs tab; not in RunHistoryModal
- [C2] Q2=A: changed-rows diff = whole-row content multiset match; highlight new-or-changed rows + count of comparison rows no longer present; no cell-level highlight; only when BOTH points have payloads
- [C3] Q3=A: a scrubbed point compares against the next-older retained point, labelled by capture time (e.g. 'vs 5 Oct, 14:02'); never 'previous run' copy
- [C4] Q4=B: dashboard chart panels with config.compare draw the baseline point's summary series as a labelled 'vs' overlay (summary-only, public-safe); hidden while a viewer filter is active; changed-rows highlight is scrubber-only

## 1. Backend: series on resolved points (D10)

- [x] 1.1 `ResolvedHistoryPoint` gains `series: Option[JsValue]` from the point's `summary.series`; serialize `series` (JSON null when absent) on `current`/`baseline` in authenticated and public responses
- [x] 1.2 Update `resolvedPoint` in `schemas/outputs/output-history-response.schema.json` and `schemas/outputs/public-output-history-response.schema.json`: required `series`, `oneOf [null, seriesSummary]`, `additionalProperties:false` kept
- [x] 1.3 Route specs (extend `com.helio.testkit.HelioRouteTest`): window baseline older than the returned points carries `baseline.series`; metric Output → `current.series` null; public response carries `series` and still no id/hasPayload/runId/triggerSource; existing statement-count spec unchanged and green; the three schema-seam specs (OutputHistoryRoutesSpec, OutputHistoryPayloadRoutesSpec, OutputHistoryPublicRoutesSpec) pass against the updated schemas
- [x] 1.4 helio-mcp: `getOutputHistoryHandler` omits `current.series`/`baseline.series` unless `includeSummaries`; `types.ts` `OutputHistoryResolvedPoint` gains `series?`; handler test for both modes; tool description notes `includeSummaries` also governs resolved-point series (still no "previous run")

## 2. Frontend history client + pure helpers (D3, D7, D9)

- [x] 2.1 Extend `HistoryPoint`/`HistoryResolvedPoint` types (`id?`, `hasPayload?`, typed `summary.series`/`columns`, `series?`); `fetchOutputHistory(outputId, {limit?})`; `fetchHistoryPointRows(outputId, pointId)`
- [x] 2.2 `diffRows(selected, comparison)` pure helper + unit tests (added/changed, multiset duplicates, key-order irrelevance, type-sensitivity, empty sides)
- [x] 2.3 `selectChartOverlay(...)` pure helper + unit tests for every omission rule in D9 (incl. aggregation set + matching grouped baseline → null; rows-mode x/y mismatch → null) and the label (`vs 7d`, `vs previous`, generic custom → `vs <baseline date>`, never "previous run")
- [x] 2.5 `selectPointOverlay(selected, comparison)` pure helper + unit tests (mode/x/y/agg mismatch → null, rows-mode repeated x → null, downsampled allowed, null comparison series → null)
- [x] 2.4 `triggerSourceLabel` shared helper (manual/scheduled/external/auto-run + sentence-cased fallback) used by RunHistoryModal and the History view; unit test incl. `auto-run` and an unknown value

## 3. Chart overlay (D8, D9)

- [x] 3.1 `buildChartOption` `overlay` param + `ChartThemeTokens.textMuted`; unit tests (a null / >256-char-truncated x gets a null overlay value — known behaviour pinned; line/bar alignment with nulls, pie/scatter/multi-series/normalized-stacking/horizontal-bar ignored, no-match ignored, legend name, not stacked, tooltip/hover passes see it)
- [x] 3.2 New `ChartOutputPanel` child (holds `useOutputHistory`, after the loading early-return) → thread `overlay` → ChartRenderer → ChartPanel → useChartOption (memo deps); PanelContent chart branch uses `useOutputHistory` + `selectChartOverlay` with filterActive/rowsComplete; `usePublicPanelData` returns `rowsTruncated` (`total > loaded`) and `PublicDashboardViewerPage` passes it; `selectChartOverlay` fails closed on `rowsTruncated === undefined`; tests incl. public `historySource`, a truncated public chart (total 350, 200 loaded) → no overlay, public `total` 0 before first load never yields an overlay, viewer-filter hide

## 4. History view (D1, D2, D4, D5, D6, D7)

- [x] 4.1 `OutputGalleryCard` wrapper + "History" sibling action; `OutputsGalleryTab.onOpenHistory`; `usePipelineDetailPage` `historyOutput` state; `PipelineDetailPage` renders `OutputHistoryModal`; existing gallery tests still pass with unchanged open-button selector
- [x] 4.2 `OutputHistoryModal`: fetch (limit 100), loading/empty/error states, range scrubber + older/newer buttons, keyboard, selected-point header, "vs <time>" caption, 100-point note
- [x] 4.3 Summary block (metric value + comparison value, column stats grid), chart-from-series with overlay for chart Outputs
- [x] 4.4 Rows section: payload fetch memo + stale-selection guard; read-only `TableRenderer` (no `ownerId`); `DataGrid.rowClassName` + `TableRenderer` pass-through; `TableRenderer.leadingColumns?: ColumnDef[]` (render-only, excluded from sort/filter/pin/columnOrder/width/persistence, rows never mutated) supplying the "Change" column; series points with null y omitted from the History chart; "no longer present" count; unavailable/not-stored notes; payload fetch error state
- [x] 4.5 Component tests: summary-only point (no rows request, no highlight, no removal count), both payloads (highlight + count, survives a sort), comparison without payload (no highlight/count, unavailable note), oldest point (no comparison), incompatible comparison series (different y) → no overlay/legend entry, copy never contains "previous run"
- [x] 4.6 CSS with DESIGN.md tokens only; light/dark parity

## 5. e2e + verification

- [x] 5.1 `e2e/hel1277-output-history-scrubber.spec.ts` using `isolateLivePage` (no API seeding while a post-login `/` is live): table Output with `config.historyPayloads` set via PATCH on a freshly registered user whose tier is set to `beta` by a new `historySeed.ts` helper `setUserTierForTest(userId, tier)` (psql `UPDATE users SET tier=… WHERE id=<exact id>`, asserts exactly 1 row; never by email/pattern; never matt@helio.dev), two runs with changed rows → scrub, highlight, count; summary-only point → no highlight; chart Output with `compare` → labelled overlay on a dashboard panel; record every created id
- [x] 5.2 Gates: lint, typecheck, format, jest, `nice -n 19 sbt testFull` (timeout 600000, ≤2 workers), local Playwright ≤2 workers under `nice -n 19`
- [x] 5.3 Screenshots of the History view (diff state) and an overlay chart panel in light and dark, saved inside the worktree
- [x] 5.4 PR body lists the noted, unfiled follow-ups (chart Compare picker; editor preview groups by aggregation while dashboards don't)
