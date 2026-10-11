## Standing Constraints

- [C1] Red first: every behaviour test in group 3 is shown failing on the pre-change code, with the red output saved under `.concertino/runs/HEL-1305/evidence/`; a GUARD is labelled as such and mutation-proven.
- [C2] Non-timestamp charts are unchanged: an option built with `fieldTypes` absent or a non-`timestamp` x type is deep-equal to main's, except the ruling-2 multi-series `0 -> null` change.
- [C3] No new `eslint-disable`; no `color-mix()` or other non-hex-resolvable colour reaches an ECharts option; heavy jobs under `nice -n 19`, jest via the repo's local caps.

## 1. Timestamp parsing and its parity guard

- [x] 1.1 Add `shared-test-fixtures/chart-timestamp-parsing.json` (design D3 case list, including every boundary shape). Verify: file parses as JSON; every case has `input`, `epochMillis` (number or null), `backendParseInstant`.
- [x] 1.2 Add `frontend/src/utils/chartTimeAxis.ts` with `parseChartInstant`, `isTimeXField`, `formatChartInstant` (echarts-free, UTC only, no `Date.parse` on tz-less strings). Verify: `chartTimeAxis.test.ts` asserts every fixture case and the TZ-independence case (D11k); red first (module absent).
- [x] 1.3 Add a ScalaTest parity spec asserting `TimestampParsing.parseInstant` against every `backendParseInstant: true` fixture case. Verify: `sbt "testOnly <Spec>"` green; mutation evidence per D3 saved (GUARD).

## 2. Plumbing field types

- [x] 2.1 Add optional `fieldTypes` to `BuildChartOptionParams`, `UseChartOptionParams` (memo deps), `ChartPanel` and `ChartRenderer` props (D1). Verify: typecheck; existing chart tests unchanged and green.
- [x] 2.2 Wire `fieldTypes` at all three `ChartRenderer` callers (D1): `OutputPanelContent` -> `ChartOutputPanel` from `output.schema` (authenticated + public; confirm the fullscreen path), `OutputPreviewPane` from the editor sheet's `capabilities.columns[].dataType`, `HistoryChart` from `output.schema` keyed by `series.x`. Verify: a component test per site shows a timestamp-typed x yields a time axis.
- [x] 2.3 Add optional `groupBy` to `GroupedAggregate`, set beside `seriesName` in `ChartOutputPanel` and `OutputPreviewPane`; pass `fieldTypes` to `buildAggregateDataOption` (D8). Verify: typecheck; existing aggregate tests green.

## 3. Option builder behaviour (red first)

- [x] 3.1 Multi-series gaps on a category axis: `null` not `0` (D5; D11a). Verify: unit test red on main, green after.
- [x] 3.1a Gap tooltip text is `—`, not `0`/`undefined`, on category and time axes (D7a; D11l). Verify: unit tests red first.
- [x] 3.2 Time branch for line / vertical bar / scatter / multi-series / auto-detect in `buildDataOptionCore` (D2, D4, D5; D11b, c, e, i, i2). Verify: unit tests red first, green after.
- [x] 3.3 `buildChartOption` merge keeps `type: "time"`, drops `data`, sets `useUTC` only on a time axis; tooltip + axis-pointer formatter per D7 with HTML escaping (D6, D7; D11j). Verify: unit tests red first.
- [x] 3.4 Aggregate time branch (D8; D11f). Verify: unit test red first.
- [x] 3.5 `toPercentShares` reads/writes pair items and keeps `null` (D5; D11h). Verify: unit test red first.
- [x] 3.6 `applyChartOverlay` time alignment by instant (D9; D11g). Verify: unit test red first; existing overlay tests unchanged and green.
- [x] 3.7 Scatter click mapping prefers `params.name` (D4; D11i). Verify: unit test red first; existing click tests green.
- [x] 3.8 Reference marks on a time axis pinned (D10). Verify: unit test (guard; may be green on first run — label it).
- [x] 3.9 Unchanged-path regression (C2; D11d). Verify: deep-equal tests for string-typed x and absent `fieldTypes` across line/bar/scatter/pie/aggregate/heatmap/histogram.

## 4. Verification and evidence

- [x] 4.1 Gates: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` (local caps), backend parity spec. Verify: transcripts saved to the evidence dir.
- [x] 4.2 Running-app check per design D12 (light + dark, 1440 + 375, overlay + reference marks on a time axis, pixel-spacing measurement, gap visible). Verify: screenshots + measurement notes in the evidence dir; every created dev-DB entity id recorded up front and deleted by exact id.
- [x] 4.3 Write `openspec/changes/chart-time-axis-gaps/files-modified.md`: one full repo path per line, no braces, no prose. Verify: every line is an existing path in the diff.
