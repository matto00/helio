## Evaluation Report — Cycle 3 (evaluation-3.md)

**Reviewed:** HEAD `51c206485be452aa8e27c9d335b6ef47e5923e4e`, the reconcile merge of main `659eec305` (HEL-1326) onto `b2a04a7e8`. The live-resolved base is `659eec305`.

**Evidence location:** `/home/matt/Development/helio/.concertino/runs/HEL-1277/evidence/openspec/changes/archive/2026-10-06-output-history-scrubber-diff/screenshots/eval-3/` (written `EV/` below). The same files are also in the worktree under `screenshots/eval-3/`.

### Phase 1: Spec Review — PASS

**Checking the merge resolution.**
- The branch's net delta against main is `git diff 659eec305 51c206485`, excluding `openspec/`.
- I compared it line by line with the cycle-2-approved delta, `git diff 3962e6eb2 bb70d8472`.
- The two are identical except for three intended adaptations:
  - **Protocol:** `"series"` is added after HEL-1326's `"metric"` entry in `resolved()`.
  - **`ResolvedHistoryPoint`:** gains `series: Option[JsValue] = None` after HEL-1326's `metric` field, and `resolve(...)` passes `metricIdentity(...)` and then the series.
  - **Both schemas:** `required` is `["capturedAt","rowCount","value","metric","series"]`.
- There are also two harmless differences:
  - one block moved within `outputHistoryService.ts`;
  - the e2e `SHOTS` path now points at the archived change dir.
- Within the conflicted files, the delta against main removes nothing from HEL-1326. No HEL-1326 line is dropped.

**Does each piece survive?**
- **Schemas:** HEL-1326's `metric` and our `series` are both present and both required in the authenticated and the public history schemas. `additionalProperties:false` is kept.
- **Protocol:** it emits both fields.
- **Frontend `HistoryResolvedPoint`:** has `series?` and `metric?`.
- **helio-mcp `OutputHistoryResolvedPoint`:** has `series?` and `metric?`.
- **MCP strip logic:** `getOutputHistoryHandler` still drops only `current.series` and `baseline.series` (plus `points[].summary`) unless `includeSummaries` is set. `metric` passes through.
- **Live wire check:** the authenticated response for a chart Output's baseline was `{series: 4 points, metric: null}`. For a metric Output it was `{metric: {field: amount, agg: sum}, series: null, value: 540}`.

**Public stays summary-only.**
- In the live public response, each point has keys `[capturedAt,rowCount,summary]` only.
- Resolved points carry `[capturedAt,metric,rowCount,series,value]`.
- In both themes, the share-token viewer's only history requests were `/panels/:p/history`. No payload route was called.

**`rowsTruncated` still fails closed alongside `filteredMetric`.**
- `usePublicPanelData` returns `rowsTruncated: rows === null || total > rows.length` next to HEL-1326's `filteredMetric`.
- `PublicDashboardViewerPage` passes both. The chart branch of `PanelContent` still passes `rowsTruncated`, plus `filterActive` covering viewer filters, server cross-filters and client cross-filters.

**Semantic interaction.** I found no break:
- HEL-1326's `filteredMetric` reaches only `MetricOutputPanel`; the chart overlay still hides under any filter.
- HEL-1326's reducer change (`metricField`) applies only to `kind == Metric` summaries. `series` is still produced only for `kind == Chart`.
- HEL-1326's baseline-identity check in `metricHistoryView` reads `baseline.metric` and ignores `series`.

Issues: none.

### Phase 2: Code Review — PASS

**Gates, run by me against `51c206485` in `WORKTREE_PATH`.**

| Gate | Result |
|---|---|
| Every pre-commit hook step (`check:repo-integrity`, `lint`, `typecheck`, `check:e2e-types`, `format:check`, `check:schemas`, `check:spec-structure`, `check:openspec` + selftest, `check:dependabot` + selftest, `check:cloud-run-cpu` + selftest, `check:scala-quality`, `check:test-temp-dir-hygiene` + selftest, `check:no-credential-leak` + selftest, `check:tokens` + selftest) | PASS |
| `check:helio-mcp-types` | **PASS** (the worktree SDK is now 1.31.0) |
| Root jest | PASS: 376 tests |
| Frontend jest (rerun) | PASS: 454 suites, 4742 tests. Log: `EV/jest-frontend-rerun.log` |
| `npm --prefix frontend run build` | PASS |
| `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` | 6084 succeeded, 0 failed, **1 canceled**, 0 aborted, 436 suites. No FirstRunRoutesSpec timeout and no "Java heap space". The three HEL-1277 history-series route tests ran. Summary: `EV/sbt-summary.txt` |
| `sbt --client shutdown` | Run as a separate call; no sbt server was left running |
| `e2e/hel1277-output-history-scrubber.spec.ts` (`DEV_PORT=6709`, `--workers=2`, `nice -n 19`) | PASS: 4/4. Log: `EV/e2e.log` |

**Why one sbt test is CANCELED.**
- The cancelled test is `OutputFilteredMetricMeasurementSpec`, "add no more than 500 ms (median of 20)". It cancels by design.
- The file's doc comment says it is opt-in and "NOT a gate". It calls `assume(enabled, "set HELIO_MEASURE=1 to run this measurement")` with `enabled = sys.env.get("HELIO_MEASURE").contains("1")`.
- The log line reads "enabled was false set HELIO_MEASURE=1 to run this measurement".
- `git diff 659eec305 HEAD` on that file is empty. It is main's own file, unmodified, so every `sbt testFull` without `HELIO_MEASURE=1` cancels it the same way, on main as well.

**A frontend jest failure on the first run, caused by load and not by this branch.**
- The first full frontend run happened while `sbt testFull` was running at the same time. Two cases in main's HEL-1345 `PipelineDetailPage.createPlacement.test.tsx` failed: "an immediate insert at gap 0/1" hit the default 5000 ms jest timeout. The file took 34.6 s under that load. The full log is kept at `EV/jest-frontend-FAILED-under-sbt-load.log`.
- **Probe on this branch:** with sbt finished, the file passed 3/3 in isolation, taking 8.0 s, 7.9 s and 8.1 s.
- **Same probe on main:** in a throwaway detached worktree at `659eec305`, with hardlinked `node_modules` (removed afterwards), it passed 3/3: 30.4 s cold, then 8.1 s and 9.8 s (`EV/createPlacement-branch-vs-main.txt`).
- The same 12 jsdom `AggregateError` XHR console errors appear on main, so they pre-date this branch.
- The full frontend rerun with no load then passed 454/454.
- Conclusion: this is a CPU-contention timeout in a test from main, and is not affected by this branch. Non-blocking: that case has no explicit timeout, while its heavier sibling in the same file sets 20000 ms.

**Code.** The merge introduces nothing new beyond the resolutions verified in Phase 1, and the cycle-2-reviewed code is byte-identical.

Issues: none.

### Phase 3: UI Review — PASS

**Setup.**
- Servers were started with `start-servers.sh` on ports 6709/9616, and `assert-phase servers` passed.
- I used my own headless Chromium scripts only (no MCP browser), in both themes.
- I seeded a table Output with payloads, a bar chart Output with `compare: previous_run`, and a metric Output with `compare: previous_run`. The chart and metric are on a dashboard, which is also shared through a share token.

**Results (`EV/probe3-{light,dark}.json`; screenshots `EV/{dash,history,public}-{light,dark}.png`):**
- **Dashboard:** the bar panel draws the outlined "vs previous" overlay. It appears in the legend and in the axis tooltip ("amount 250 / vs previous 250").
- **HEL-1326 metric headline:** renders next to the overlay ("860 ▬ 0% vs previous" with sparkline).
- **Same data on the public viewer:** both the overlay label and the metric headline render. Requests were summary-only.
- **History view:** scrubbing to the second-newest point diffs it against the oldest. 4 rows are flagged "New or changed" (east, west, south, north) and central is unchanged. The view shows "3 rows from Oct 6, 03:38:07 PM no longer present". Both labels show seconds, because the two points fall in the same minute.
- **Console:** no page errors. The only errors were the pre-login `/auth/me` 401 and the pre-existing `/schedule` 404.

Issues: none.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- The second HEL-1345 test case ("an immediate insert at gap %i") in `PipelineDetailPage.createPlacement.test.tsx` has no explicit timeout, and it timed out under concurrent `sbt testFull` load. It belongs to main's HEL-1345 test, not this ticket's code. A follow-up could give it the same 20000 ms its heavier sibling uses.
- **Lost evidence:**
  - The cycle-1 and cycle-2 untracked `screenshots/eval-1` and `screenshots/eval-2` folders were not carried into the archived change dir. Their key artifacts survive in `.concertino/runs/HEL-1277/evidence/`.
  - The cycle-2 residue section did survive: it is in the archived `residue.md`.
- **This cycle's residue:** it is appended to the archived `residue.md`, which I left **uncommitted**.
