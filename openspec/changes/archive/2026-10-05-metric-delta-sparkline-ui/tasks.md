## Standing Constraints

- [C1] Do not modify .github/workflows/ci.yml or playwright.config.ts; no Flyway migration (ask the driver first).
- [C2] E2E seeding happens only after page.goto("about:blank"); deletions/updates target only exact ids this run created and recorded.
- [C3] Local Playwright: at most 2 workers under nice -n 19, own ports (DEV_PORT/BACKEND_PORT) and own headless context; never another lane's server.
- [C4] No UI copy may contain "previous run"; L3's API is consumed as-is (no backend change).
- [C5] The e2e exit-criterion proof sets compare by choosing it in the Output editor UI, never by seeding it through the API.
- [C6] Metric test fixtures must use the config shape the editor actually writes (aggregated metric: fieldMapping {} plus aggregation {value, agg}), not a hand-made shape.

## 1. Frontend — history data

- [x] 1.1 Add `features/panels/history/outputHistoryService.ts` (typed authenticated + public fetchers) — verify with a service unit test asserting both URLs and `token` param
- [x] 1.2 Add `outputHistoryCache.ts` + `useOutputHistory` (shared in-flight, generations, authenticated-only pipeline-terminal invalidation, one delayed retry when `current.capturedAt` did not advance; design D1) — verify with a cache unit test (one request for two consumers, refetch after invalidation, public key never subscribes, retry once)
- [x] 1.3 Add `resolveServerMetricField` + `selectMetricHistoryView` pure helpers (design D2: head guard, sparkline identity filter, baseline-in-points identity check, note suppression) — verify with unit tests mirroring `OutputSummaryReducer.metric` cases and each guard
- [x] 1.4 Add `metricComparisonStore.ts` (per-publisher, keyed `<variant>:<panelId>`, design D5) — verify with a unit test (publish, unmount removes, latest live publisher wins)

## 2. Frontend — rendering

- [x] 2.1 Extend `MetricRenderer` with structured `comparison` + `sparkline` props (delta glyphs, labels, aria, available-from note, filtered marker, design D6) — verify via RTL in 4.1
- [x] 2.2 Add the SVG sparkline component + CSS using DESIGN.md tokens incl. compact container query — verify via RTL in 4.1 and the visual check in 4.5
- [x] 2.3 Wire the `PanelContent` metric branch to the history hook + server headline + comparison store; add `viewerFilterActive` (= built control filter ops non-empty, or cross-filter narrowing; design D3) and `historySource` (design D4) props, set from PanelCard, PanelFullscreenOverlay, PanelDetailModal, PublicDashboardViewerPage — verify via RTL in 4.2
- [x] 2.4 Add the Compare `Select` to metric fields; metric `buildOutputConfig` always emits `compare` (literal null for None), `buildAggregateTailConfigs` takes the picker value (design D7) — verify via 4.3
- [x] 2.5 Add the provenance "Compared with" row: ProvenanceTrigger reads the comparison store, ProvenancePopover/ProvenanceContent render it (design D5) — verify via 4.4

## 3. Frontend — e2e support

- [x] 3.1 Add `e2e/support/historySeed.ts` (psql backdate by exact output_id-selected row ids, env or worktree backend/.env, `SET LOCAL app.current_user_id`, asserts affected row count, fails loudly if psql/env missing; design D8) — verify by running it against the worktree DB

## 4. Tests

- [x] 4.1 RTL `MetricRenderer` tests: ▲/▼/flat, zero-baseline absolute delta, custom/previous labels (no "previous run"), available-from note, sparkline presence/absence — `npm test -- --testPathPatterns=MetricRenderer`
- [x] 4.2 RTL `PanelContent` metric tests: server headline vs loaded-rows fallback (no history, config mismatch), delta hidden + marker under an applied filter, empty control value keeps the delta, public fetch path via `historySource` — mutation-check that removing the filter guard turns a test red
- [x] 4.3 RTL/unit tests for the Compare picker and config build: payload has `compare: "7d"`; None sends literal `compare: null` (assert the key is present and null); custom value kept; chart omits the key; aggregate-tail metric config carries the picker value
- [x] 4.4 RTL tests for the provenance "Compared with" row (shown with delta, absent without, absent under an applied filter, public variant)
- [x] 4.5 Playwright `e2e/hel1275-metric-delta-sparkline.spec.ts` (design D8; compare chosen via the editor UI, C5) in light + dark: "1,204", "▲ 12% vs 7d", sparkline, compared-with row; screenshots saved to the change dir — run with `nice -n 19 npx playwright test e2e/hel1275-metric-delta-sparkline.spec.ts --workers=2`
- [x] 4.6 Full gates: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`; record outputs in the change dir
