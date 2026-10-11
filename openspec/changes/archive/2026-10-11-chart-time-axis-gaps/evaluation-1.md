## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: aa8b4f4ea0c94a38f9b6c0599f72e8dedd326594. Diff base resolved live: 3eb0cc893 (merge-base with origin/main).
Fresh evidence from this review: `.concertino/runs/HEL-1305/evidence/eval-1/`.

### Phase 1: Spec Review — FAIL

- AC1 (irregular dates, proportional, sorted): met. Unit tests pass, and the fresh e2e run measures 17.1 px per day at 1440 and 10.7 px per day at 375 for day gaps of 1,1,7,1,13 (`eval-1/e2e-run.log`).
- AC2 (gap, not 0, with a unit test on the option builder): met. `chartDataOptions.ts:184` (category axis) and `chartTimeDataOptions.ts:401` (time axis). The running app shows `bValues [4,5,null,6,null,7]`, and the tooltip reads `B: —`.
- AC3 (non-date category x unchanged): met in the code, verified independently (see Phase 2, C2).
- Owner rulings 1-5: honored. The axis is chosen from the schema type only (`isTimeXField`). Time labels and tooltip use UTC (`useUTC: true`, scoped to time axes). The tooltip shows date-only versus date-time. The chart types in scope are line, scatter and vertical bar, raw and aggregated; horizontal bar, pie, heatmap and histogram are excluded. The overlay is aligned by instant. Reference marks are untouched, and cross-filter click works.
- CONSTRAINTS: C1 is honored (red output is in `HEL-1305-red-group3-results.txt` and `HEL-1305-red-1.2-chartTimeAxis.txt`, mutation outputs are saved). C2 is honored in behaviour (see Phase 2). C3 is honored: the diff adds no `eslint-disable`, `@ts-ignore` or `color-mix`, and no new colour reaches an option.
- **Issue (spec divergence, tasks.md 3.9 / design D11d):** task 3.9 is marked `[x]` but does not do what it specifies. It requires "deep-equal tests for string-typed x and absent `fieldTypes` across line/bar/scatter/pie/aggregate/heatmap/histogram", and D11d says to "snapshot the main output in the test as the expectation". The GUARD block that was shipped (`buildChartOption.timeAxis.test.ts:335-417`) is partial in three ways:
  - it uses `toMatchObject({type:"category"})` plus series `data` checks, not deep equality of the built option;
  - it has no heatmap or histogram case at all;
  - it has no case for heatmap/histogram, or for line/bar/scatter under stacked/normalized/overlay/reference-mark options, with a `timestamp` x.

  A future drift in legend, tooltip, axis or series keys of a non-time chart would pass this guard. The constraint holds today (verified below), but the planned regression guard for it is missing.

### Phase 2: Code Review — PASS (one test-coverage item carried as the Phase 1 CR)

Gates were re-run fresh in `WORKTREE_PATH`. All were green, and the logs are in `eval-1/`:
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0.
- `npm test`: exit 0. Frontend: 548 suites and 5965 tests passed. Root: 48 suites and 453 tests passed.
- `npm --prefix frontend run build`: exit 0.
- `cd backend && sbt testFull`: exit 0. 7133 succeeded, 0 failed, 4 canceled (pre-existing). This includes `ChartTimestampParsingParitySpec` (2 cases green).
- `npm run check:e2e-user-cleanup`: clean (76 files).

On the executor skipping `sbt testFull`: the backend change is one new test-only spec that reads a shared fixture. The risks are compile breakage or a vacuous run, and neither touches production code. I ran the full suite anyway; it is green, and the new spec executed with its non-empty assertion. The executor's own targeted `testOnly` plus mutation evidence (`HEL-1305-mutation-1.3-scala-fixture.txt` shows a red result on a 1 ms fixture change) was adequate for this diff. My full run removes the question.

C2 was verified independently with a differential that compares the base build against the head build. I wrote a scratch Jest harness (`eval-1/c2-differential.test.ts.txt` with its config) that imports `buildChartOption` from base 3eb0cc893 (extracted with `git archive`) and from HEAD. It ran the two over **4675 configurations**:
- chart types: line, bar, scatter, pie, heatmap and histogram;
- datasets: with gaps and without gaps;
- mappings: single, multi, auto-detect and heatmap;
- chart options: none, stacked, normalized, horizontal, line smooth/area, scatter size/colour;
- `fieldTypes`: absent, null, string-typed x, and timestamp on a non-x field;
- with and without an overlay, and with and without reference marks;
- a timestamp x on pie, heatmap, histogram and horizontal bar (incl. stacked/normalized);
- aggregate line/bar/pie with every groupBy/type combination except timestamp-typed groupBy on line/bar (the intended time path).

The comparison is JSON with functions masked. Result: **0 unexpected differences**. The 195 configurations that differed are all multi-series datasets with gaps, and each differs only by `0 -> null`, which ruling 2 permits. The only other change is the tooltip `valueFormatter` function, which now renders null, undefined and non-finite values as `—` (D7a, intended).

Checks the orchestrator asked for:
- `ChartOutputPanel.aggregate.test.tsx:85`: the added `groupBy: "region"` is the new `GroupedAggregate.groupBy` field (D8), set in `ChartOutputPanel.tsx:126`. This is a legitimate expectation update for a new field; no existing value changed.
- e2e cleanup: the spec records every id and deletes dashboard, pipelines and sources by exact id in `finally`. Users go through `registerUser` and `recordRegisteredUser`, and the global teardown deletes them. The fresh run logged 20 exact-id DELETEs and `deleted 4 recorded throwaway user(s)`.
- HTML escaping: `timeAxisOption.ts:40-41` escapes the series name and the value text with the shared `escapeHtml`. In the running app, a series named `<b>B</b>` rendered as `&lt;b&gt;B&lt;/b&gt;` with no `<b>` element injected. The header is built from a number only.
- `chartTimeAxis.ts` imports no echarts, so the HEL-512 lazy chunk is intact. The new `timeAxisTestSupport.ts` follows existing precedent (`chartPanelTestHelpers.tsx`, `tapTargetTestUtils.ts`).
- Click mapping: the scatter path prefers `params.name`. The executor's probe (`HEL-1305-probe-scatter-name.txt`) shows a category-axis scatter point has `name: ""`, so the non-time path is unchanged. In the running app, a click on a time-axis scatter point filtered to `day: 2026-09-10` (both rows).
- File sizes are within the soft budgets (largest new source file is `chartTimeDataOptions.ts` at 202 lines). There is no dead code and no TODO.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` on ports 6737/9644 after the sbt run finished. Both were fresh processes started from this worktree after commit aa8b4f4ea, and I stopped them by exact PID afterwards.

- Fresh run of the executor's e2e spec (`DEV_PORT=6737`): **4 passed** (light/dark at 1440/375). It checks the time axis, `useUTC`, gap nulls, proportional pixel spacing, the gap tooltip `2026-09-03 A: 16 B: —`, overlay plus reference marks on a time axis, a stacked bar sharing one stack with equal-length series, bar/aggregate/scatter on time axes, and a string x on a category axis.
- Running-app probe as a throwaway user (`hel1305-eval-…@example.test`, id e683d455-…; identity verified with `/api/auth/me` before any action, and the MCP browser was logged out at the start):
  - multi-line, bar and scatter on a time axis;
  - the gap is visible as a line break;
  - the escaped tooltip renders correctly;
  - scatter cross-filter selects the raw x;
  - the 1100 px desktop grid and 768 px mobile stack screenshots (`eval-1/mcp/`) show no breakage;
  - at 320 px, `scrollWidth == innerWidth` (no horizontal overflow).

  There were no console errors in tested flows. The only errors were the 401s on `/api/auth/me` before login, and the ECharts "Can't get DOM width" warnings during the desktop-to-mobile remount, which is pre-existing layout behaviour. Every created entity (source, pipeline, 3 outputs, dashboard, 3 panels) was deleted by exact id. The user was deleted by exact id and email through `userCleanupCore` (`eval-1/eval-probe-created-ids.txt`).

### Overall: FAIL

### Change Requests
1. `frontend/src/features/panels/ui/buildChartOption.timeAxis.test.ts:335-417`: make the unchanged-path GUARD what task 3.9 / D11d specify, a **deep-equal** against main's built option.
   - Capture main's (3eb0cc893) `buildChartOption` output for a fixed set of inputs as the expected value. An inline or checked-in JSON snapshot generated on the pre-change tree is fine; mask functions with `expect.any(Function)` per D13f.
   - Assert `toEqual` on the whole option for each of these, each with `fieldTypes` absent, `null`, and a string-typed x:
     - line, vertical bar, scatter (incl. size/colour), pie, heatmap and histogram;
     - an aggregate bar/line/pie whose `groupBy` is not a timestamp;
     - a stacked bar and a horizontal bar;
     - one overlay case and one reference-mark case.
   - Add timestamp-x cases for pie, heatmap, histogram and horizontal bar (ruling 5 says unchanged).
   - Keep the multi-series gap rows as the one documented exception: the expected value has `null` where main had `0`.
   - Mutation-prove the guard: change one non-time branch (e.g. the category `xAxis` merge) and show it go red, with the output saved under `.concertino/runs/HEL-1305/evidence/`.

   A working base-vs-head harness that does this over 4675 configurations is at `.concertino/runs/HEL-1305/evidence/eval-1/c2-differential.test.ts.txt` for reference. A committed test cannot import main's code, so freeze the expected options instead.

### Non-blocking Suggestions
- `timeAxisOption.ts:40`: `!p.seriesName.includes("\u0000")` is an unexplained magic check. It works around ECharts' auto-generated `series\u00000` names for unnamed series. Name it, e.g. `ECHARTS_AUTO_SERIES_NAME_MARK`, with a one-line comment.
- `buildChartOption.timeAxis.overlay.test.ts:99`: the reference-marks block is labelled "GUARD … green on first run", but `HEL-1305-red-group3-results.txt` shows it FAILED on main (no time axis existed there). Relabel it as a behaviour test, or explain the label.
- `ChartTimestampParsingParitySpec.scala:37-42`: design D3 says the spec asserts nothing about `backendParseInstant: false` cases, but it asserts `None` for them. That is arguably better, since it pins that the backend really rejects `MM/dd/yyyy`; record the deviation in the PR body.
- Running-app observation for the skeptic or a follow-up: a single-series bar over raw rows with repeated x values (two rows on the same day) now draws the bars at one instant, overlapping. The smaller bar is hidden behind the larger (EvalBar at 1100 px, `eval-1/mcp/hel1305-eval-1100.png`). On a category axis they were separate bars. This comes with a time axis plus raw rows, and is not covered by any ruling.
- `chartTypeOptions.ts:99`: `raw === undefined ? raw : …` changes how undefined holes are treated in normalized shares (they were 0 before). No current builder emits undefined, and the differential found no change, but a short comment would help.
