## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: aa754f29df6b8d9607ec0ec801bf16af6cafdd06. The base was resolved live with `resolve-review-base.sh`: a606a9833910e36ad544e6aff6e4b87049245559, which is an ancestor of HEAD. The diff is 3 commits and 61 files, all frontend, e2e or openspec. There are no backend, schema or migration changes.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/chart-overlay-coverage-gaps/HEL-1351`.

**Acceptance criteria, traced to code and to the running app**

- **Item 1 (aggregated chart Outputs).** Fixed, as the owner ruled (client-aggregate).
  - `ChartOutputPanel.tsx` calls `chartAggregationSpec(config)` and groups the cross-filter-narrowed records with `utils/aggregate.groupAndAggregate`.
  - `OutputPreviewPane.tsx` now gates on the same `chartAggregationSpec` and calls the same function. That satisfies C2: there is one grouping implementation and one condition.
  - The spec condition (not scatter, and groupBy/yField/a valid agg present) mirrors `OutputSummaryReducer.scala:109-118` (`agg.filter(Aggs)`, `chartType != "scatter"`).
  - `selectChartOverlay` accepts a `grouped` series only when x/y/agg all match.
  - Live, with real runs and a 7d1h-backdated history, both themes:
    - Bar Output `sum(amount)` showed east 15, north 6, west 7, with "vs 7d" baselines 11, 4, 9. These are correct for the seeded rows (10+5, 6, 7 now; 8+3, 4, 9 then).
    - Line Output `avg(amount)` showed 7.5, 6, 7 against 5.5, 4, 9, drawn as a dashed overlay.
    - The values were read from the live ECharts option (`probe2.log` / `probe3.log`).
    - The same chart showed correctly on the card, in fullscreen, and in the mobile stack.
  - Click-select and Inspect worked live in both themes. A click on the east bar showed "Showing rows for region: east / sum(amount)" and listed exactly the two east records (10, 5).
- **Item 2 (more than 200 rows).** Escalated with a recommendation, and the owner chose defer-standalone (`events.jsonl` seq 4/5). HEL-1358 exists and is in Backlog.
  - C1 holds live. A 250-row aggregated Output with compare 7d showed no "vs 7d" series in either theme.
  - In code, `rowsTruncated !== false` returns null before the mode branch, for both modes.
- **Item 3 (compact legend).** Fixed.
  - In `buildChartOption.ts`, the compact legend is hidden only when `effectiveCompact && !overlayApplied`. An explicit `show:false` stays hidden. The legend is a scroll legend at 10px, with a grid inset on the legend's side.
  - Live in the mobile stack (100px canvases), both themes: legendShow was true for the compact charts that had an overlay and false for the compact charts without one (the 250-row bar and the pie).
  - Visually the legend is legible and does not collide with the plot (see screenshots).
- **Item 4 (chart-type source mismatch).** Fixed.
  - `resolvePanelChartType` resolves the panel's stored type, then the Output's `chartType`, then `line`.
  - It drives the render (`ChartOutputPanel`), the click mapping (via the injected `resolvedAppearance` that `useChartClickHandler` reads), and `chartInspectConfig` in `PanelCard.tsx`.
  - Live: placements that store no chart type rendered the Output's bar, line and pie types, not the old default of line.
- **"Check against the running app in both themes".** Done independently. I used a lane-private Playwright run with its own config and browser context, against dev 6783 and backend 9690. I did not use the shared MCP browser or shared cookie jars.

**Gates, re-run by me on aa754f29d (all under `nice -n 19`)**

- Targeted jest, `--maxWorkers=3`: 53 suites and 574 tests passed. This covers chartOverlay, buildChartOption, OutputEditorSheet.compare, useCrossFilteredPanelData, usePanelData, ChartOutputPanel, PanelCard*, PanelFullscreenOverlay*, PanelDetailModal*, MobilePanelStack*, aggregate and rawElementGuard.
- Frontend `tsc --noEmit` exited 0.
- ESLint `--max-warnings=0` on every changed ts/tsx file exited 0.
- Prettier `--check` on every changed file passed.
- `openspec validate --strict` reports the change as valid.
- I relied on the evaluator's persisted mutation evidence (`.eval-hel1351/c3/`: mutA, mutB and the guard mutation, each going red). The pasted output is specific and unambiguous, and my live probe independently reproduced the legend behaviour that mutA and mutB guard.
- C2 has a direct unit test: `ChartOutputPanel.aggregate.test.tsx:90`, "renders the SAME aggregate as the editor preview on the same records (C2)", which includes a null group cell.

**Design judgment (DESIGN.md, both themes)**

- The grouped bars and the "vs 7d" overlay use the existing HEL-1277 overlay styling: a muted translucent fill with an opaque outline, or a dashed muted line. I found no new hardcoded colours or one-offs. The diff adds only the numeric legend and inset constants, sized off the existing `COMPACT_AXIS_LABEL_FONT_SIZE` / `COMPACT_GRID_INSET_PX`.
- Light and dark are at parity on the card, fullscreen, Inspect and mobile.
- The compact legend sits cleanly above the plot at 100px without crowding the axis.
- Naming the primary series `sum(amount)` makes the legend and tooltip read correctly.

**Console:** the only errors were two 401s from `/api/auth/me` on the pre-login page, which is expected. The app raised no errors.

**Test data:** all created dashboards (3), pipelines (6) and sources (6) were deleted by exact id. A DB recount of those exact ids returns 0/0/0. Three throwaway `hel1351-skeptic-*@example.test` users remain: 3ad951c4-…, 159514ea-…, e9f440b2-…. That is the repo-wide pattern. matt@helio.dev was not touched.

**Persisted evidence**

- `/home/matt/Development/helio/.concertino/runs/HEL-1351/evidence/.skeptic-hel1351/shots/{dash,fullscreen,inspect,mobile}-{light,dark}.png`, plus `line-hover-light.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1351/evidence/.skeptic-hel1351/{probe2.log,probe3.log,jest.log,probe/skeptic.spec.ts}`

The light-theme probe run timed out after its last screenshot, while moving to the dark loop; it was a probe-script issue. The dark theme was then re-run on its own and passed. All the data cited above was logged before the timeout.

**Gate-defect check:** none of the evaluator reports I read discloses unsound evidence mtimes, and nothing here rests on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes

- **Partial totals on truncated aggregated panels.** A 250-row aggregated Output now shows partial totals as if they were the whole: east 100 and west 100, where the true values are 125 and 125. There is no on-chart notice. This was implicitly accepted by the owner's "client-aggregate, truncated case follows item 2" ruling, and design.md lists it as a risk. However, HEL-1358's description talks only about "plot just the first 200 rows". I recommend adding a line to HEL-1358 saying that aggregated Outputs now sum and average only the loaded 200 rows, which makes the truncation notice more urgent there.
- **Inspect column order.** On an aggregated chart, Inspect orders its columns by record key (amount, region), not by the Output's header order (region, amount) as the non-aggregate path does. This is cosmetic. `PanelInspectView.tsx` gridRows aggregate branch could map over `headers` when they are present.
- **Overlay legend symbol (pre-existing, HEL-1277).** The line overlay's legend symbol shows a filled marker even though the series draws `symbol: "none"`. Not introduced here.
