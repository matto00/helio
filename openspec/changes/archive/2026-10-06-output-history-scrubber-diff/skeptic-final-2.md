## Skeptic Report — final gate (round 2, skeptic-final-2.md)

**Reviewed HEAD:** `51c206485be452aa8e27c9d335b6ef47e5923e4e`. This is the merge of main `659eec305` (HEL-1326) into `b2a04a7e8`.
**Review base:** resolved live with `resolve-review-base.sh main origin` as `659eec3056a180d3accf83438a2c5e66de8152d6`.

**Evidence:** `EV/` means `/home/matt/Development/helio/.concertino/runs/HEL-1277/evidence/openspec/changes/archive/2026-10-06-output-history-scrubber-diff/screenshots/final-2/`. Each file was persisted with `persist-evidence.sh` when it was captured, and worktree copies are in `screenshots/final-2/`. No claim below depends on mtime ordering.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/pipeline-run-scrubber-overlay/HEL-1277`.

#### 1. Merge resolution (the priority)

**Delta equivalence, checked mechanically.**
- I compared the approved delta `git diff 3962e6eb2 bb70d8472` (round 1 CONFIRM) with the current delta `git diff 659eec305 51c206485`, excluding `openspec/`.
- Both touch the same 61 files.
- For each file I compared the sorted multiset of `+`/`-` lines. They are identical in every file except five:
  - `OutputHistoryProtocol.scala`
  - `OutputHistoryService.scala`
  - the two history schemas
  - the e2e spec, where only the `SHOTS` path changed to the archived dir.
- Everything else, the merge left byte-for-byte as approved. That includes `outputHistoryService.ts`, `usePublicPanelData.ts`, `PublicDashboardViewerPage.tsx` and `helio-mcp/src/types.ts`.

**The 8 conflict resolutions (`git show --remerge-diff 51c206485`).** Every one is a union that drops nothing from HEL-1326:
- **Protocol `resolved()`:** emits `metric` (HEL-1326) and then `series`. Both are explicit `null` when absent.
- **`ResolvedHistoryPoint`:** `(…, metric: Option[StoredMetricIdentity] = None, series: Option[JsValue] = None)`.
  - `resolve()` passes both `metricIdentity(summary)` and `summary.series`.
  - `StoredMetricIdentity` and `metricIdentity` are kept.
- **Both schemas:** `metric` (HEL-1326's oneOf) and `series` (`$ref seriesSummary`) are both defined, and `required: [capturedAt,rowCount,value,metric,series]`. `additionalProperties:false` is kept.
- **Frontend `HistoryResolvedPoint` and helio-mcp `OutputHistoryResolvedPoint`:** both have `series?` and `metric?`.
- **`usePublicPanelData`:** returns `rowsTruncated: rows === null || total > rows.length` (still fails closed) alongside `filteredMetric`. `PublicDashboardViewerPage` passes both props.
- **MCP strip:** `getOutputHistoryHandler` deletes only `series` from `current`/`baseline`, plus `points[].summary`. `metric` passes through. Test: `outputsHandlers.test.ts:433`.

#### 2. Gates (re-run by me at 51c206485)

| Gate | Result |
|---|---|
| `npm run lint` / `typecheck` / `format:check` | exit 0 / 0 / 0 |
| `npm run check:schemas` | exit 0 ("in sync") |
| `npm run check:helio-mcp-types` | exit 0 |
| Targeted frontend jest (`--maxWorkers=2`, `nice -n 19`): outputHistory, diffRows, triggerSourceLabel, chartOverlay, formatCaptureTime, outputHistoryService, rowsTruncated, ChartPanel, PanelContent, buildChartOption, TableRenderer, DataGrid, OutputsGalleryTab, RunHistoryModal, token guards, plus HEL-1326's MetricOutputPanel, filteredMetric, metricHistory and usePublicPanelData | 39 suites, 554 tests, all pass |
| Root jest `outputsHandlers` | 20/20 pass |
| `nice -n 19 sbt "testOnly *OutputHistory* *OutputFilteredMetric* *OutputSummaryReducer* *PipelineRunServiceOutputHistory*"` (`HEL924_TEST_GROUP_CONCURRENCY=2`) | exit 0. 197 succeeded, 0 failed, 1 canceled, 17 suites, 0 aborted |
| `e2e/hel1277-output-history-scrubber.spec.ts` (`DEV_PORT=6709`, `--workers=2`, `nice -n 19`) | 4 passed (21.8s) |

- **The sbt run** included the three HEL-1277 series route tests ("carry series on resolved points and still leak no id…", which schema-validates against the merged public schema, plus the two `resolved-point series` tests) and HEL-1326's `OutputHistoryMetricIdentityRoutesSpec` and `OutputFilteredMetricRoutesSpec`.
- **The canceled test** is `OutputFilteredMetricMeasurementSpec`. It is opt-in, behind `HELIO_MEASURE=1`, and is main's own unmodified file.
- **Heap and FirstRunRoutesSpec.** There were 0 "Java heap space" lines. I did not run `FirstRunRoutesSpec` (targeted run). The evaluator's full `testFull` at this SHA reports no timeout, and CI on PR #806 is green.
- **Shutdown.** `sbt --client shutdown` was run as its own call.

#### 3. Acceptance criteria, on the running app

Servers were started via `start-servers.sh` on 6709/9616, and `assert-phase servers` returned PASS. I used my own headless Chromium scripts, with a fresh beta user, a source, and one pipeline carrying a table Output (payloads on), a bar chart Output and a metric Output (both `compare: previous_run`). A dashboard holds the chart and metric panels and is shared with a share token.

**AC1: scrubbing shows the summary, and rows when a payload exists.**
- **Newest point (auto-run, 4 rows) compared with the next-older point.**
  - East 180, north 220 and south 90 are flagged "New or changed". West 250 is unflagged.
  - The note reads "2 rows from Oct 6, 03:47 PM no longer present", which is correct: east 100 and north 300 were removed.
  - The summary grid shows count 4, sum 740, min 90, max 250.
  - Evidence: `EV/history-view-diff-{light,dark}.png`.
- **The earlier pair** (run 2 compared with run 1) flagged exactly west 250 and north 300 and reported "2 rows … no longer present", as expected: west 200 and south 50 were removed (`EV/probe-1.log`).
- **Summary-only Output.** The chart Output has no payload and shows "Rows weren't stored for this run — summary only." (`EV/history-view-chart-*.png`).

**AC2: the overlay series is labelled.**
- **History chart:** the legend reads "vs Oct 6, 03:47 PM".
- **Dashboard 6×5 panel:** the legend reads "vs previous" in both themes. The dashed comparison line reflects the baseline series east 100, west 250, north 300 (`EV/dashboard-overlay-{light,dark}.png`).
- **HEL-1326 next to it:** the metric headline renders "740 ▲ 13.8% vs previous", which is correct (740/650).

**AC3: light and dark.** I captured every view above in both themes, and they are at parity. The changed-row wash is a tint in both themes, the text stays legible, and the comparison series is subordinate and legend-labelled.

#### 4. Contract and driver constraints after the merge (live wire)

- **Authenticated history:**
  - Chart `current` has keys `capturedAt,metric,rowCount,series,value`, with baseline series points `[[east,100],[west,200],[south,50]]` and `metric: null`.
  - Metric Output: `metric {field: amount, agg: sum}`, `series: null`, value 650, baseline 350, delta 300.
- **Public `/dashboards/:d/panels/:p/history?token=`:** returns 200.
  - Resolved points carry `capturedAt,metric,rowCount,series,value`.
  - Points carry only `capturedAt|rowCount|summary`.
  - The raw body contains none of `"id"`, `hasPayload`, `runId`, `triggerSource` or `outputId`.
- **Public payload route `/api/outputs/:o/history/:pt/rows`:** **401** with the token and **401** without it.
- **Public viewer (cookie-less, both themes):** the only history calls are `/panels/:p/history?token=`. There is no payload request, and the overlay label is present (`EV/public-dashboard-{light,dark}.png`).
- **No "previous run" copy** appears in the History dialog text (checked in the probe) or on the dashboard card (checked by the e2e).
- **C1–C4 and D1–D10 still hold:**
  - The History view opens from the Output card.
  - The diff is a whole-row multiset and runs only when both points have payloads.
  - The comparison is labelled by capture time.
  - The overlay is summary-only and hidden under filters, because `filterActive` still feeds `selectChartOverlay`.
  - There is no migration and no `historyPayloads` UI.
- **Console.** The only failed resource was the pre-existing `404 /api/pipelines/:id/schedule` for a pipeline with no schedule. There were no page errors.
  - My second probe also triggered 429s in dark mode on the pipeline page's background requests. That was my own request volume against the 120/min limiter, not a defect, and the screenshots rendered fully.

#### 5. Gate-defect check

Evaluation-3 reports no unsound evidence mtimes, and this report does not rely on mtime ordering. No gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes

1. **Two points in the same second get identical labels.** When the selected and comparison points were captured within the same second (two API-triggered runs), the header and "vs" label are both "Oct 6, 03:47:17 PM", so the row tells the user nothing. Real runs rarely collide, so this does not block. A relative "N s earlier" hint would fix it.
2. **Chart type can differ between the History view and the dashboard.** The History chart takes its chart type from the Output's `config.chartType` (bar). The dashboard panel takes it from panel appearance, which defaults to line (`resolveChartType`). For the same Output, the History view can show bars while the dashboard shows a line. This is pre-existing panel behaviour and not a merge regression, but worth a follow-up so the two read alike.
3. **Notes carried over from round 1** (compact legend label, History button radius and weight, "no row changes" state, and the PR body stating the `-n` bypasses) are unchanged.

### Hygiene

- **Scratch:** kept in `.concertino/skeptic-f2/` and removed by exact path.
- **Residue:** the exact ids from my probe and my e2e re-run (5 users, sources, pipelines, outputs, dashboards, panels and one share token) are appended to the archived `residue.md`.
  - All were deleted by exact id, and counts were verified at 0.
  - `matt@helio.dev` was excluded in SQL and is still present.
- **Servers:** stopped by exact PID (2018247, 2018231, 2017981, 2017672, 2017630), and both ports are confirmed free.
