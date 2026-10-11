## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `8ff998eab665f6a7415857a252e18f91e1a1c973`. The base was resolved live with `resolve-review-base.sh` as `a29a7e5ce` (origin/main). The diff is 83 files.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/heatmap-histogram-chart-types/HEL-1311`.

**Gates I re-ran myself** (MemAvailable about 55 GB, nice 19):
- Targeted frontend jest (19 suites: every `*heatmapHistogram*` test, histogramBins, the chartTypes guard, histogramNote, buildOutputConfig, outputConfigTypes, the openingState snapshot, buildChartOption*, chartOverlay*, chartClickSelection*, HistoryChart*, ChartCompareField): **19 suites, 349 tests passed**.
- MCP guard, run with the root `jest.config.cjs`: **8/8 passed**.
  - My first run used helio-mcp's own directory and reported "0 tests" from a Babel parse error. That was my invocation, not the code. Re-running it the way the repo is configured gave a stable pass.
- `npm run check:helio-mcp-types`: exit 0.
- `npm run check:schemas`: in sync (14 assistant surfaces, 9 panel-type surfaces).
- Backend `sbt testOnly` (OutputHeatmapHistogramSpec, ChartTypesSchemaGuardSpec, OutputConfigValidationSpec, OutputSummaryReducerSpec): **56 succeeded, 0 failed**.

**Acceptance criteria traced to code:**
- **AC1, heatmap x/y/value with a colour scale:**
  - `heatmapHistogramOptions.ts` `buildHeatmapDataOption`: columns and rows in first-appearance order, summed cells, no column-0 fallback.
  - `applyHeatmapTheme`: visualMap colours come from `--app-accent`.
  - It renders in both themes, but **the colour-scale legend does not match the cells** (see CR-1). This AC is only partly met.
- **AC2, histogram with configurable bin count:**
  - `utils/histogramBins.ts`: Sturges' rule clamped to 1-50, equal width, last bin inclusive, a single bin when min == max.
  - Backend `validateBinCount` accepts 2-100 whole numbers under the tolerance rule.
  - Editor: `HistogramBinCountField` blocks Save on an invalid draft.
  - Live run: `binCount: 10` drew 10 bins. Automatic over 72 numeric values drew 8 bins (ceil(log2 72) + 1 = 8, correct).
- **AC3, editor / JSON schema / MCP enums with tests:**
  - Code sets: `ChartTypes.scala`, `utils/chartTypes.ts`, `helio-mcp/src/tools/chartTypes.ts`.
  - The six schema enums are pinned by three guards (backend, frontend, MCP). The guards walk `schemas/**` and fail on a count mismatch.
  - `ApiRoutesSpec` PATCHes panel appearance. The editor offers Heatmap and Histogram (`OutputKindFields.tsx` `CHART_TYPE_OPTIONS`).
  - The client/server seam is transitive: every side is pinned to the same schema files. That is acceptable.

**Spec scenarios:**
- The overlay is skipped for these types in `selectChartOverlay` (chartType blocker first). `applyChartOverlay` also gates on line/bar, so a panel-level type override cannot leak an overlay either.
- Clicks select nothing: `mapChartClickToSelection` checks `isSelectableChartType`.
- History shows a muted note (`HistoryChart.tsx`), and `OutputSummaryReducer` only swaps scatter for the NonAggregating set.
- `aggregation` and `binCount` are validated in `OutputConfigValidation`.

**Red-first claims, read against the evidence files:**
- Genuinely red before implementation:
  - backend `OutputHeatmapHistogramSpec` (`red-backend-route.txt`: 5 failed)
  - `buildOutputConfig` (2 failed)
  - `histogramBins` (module absent)
  - cycle-2 CR-1 (Save not disabled)
- Red by mutation only, and labelled honestly as "authored after their implementation": the frontend overlay, click, History, yAxis, cursor, numeric-picker, skipped-note and sanitise tests.
- Guards are labelled GUARD and shown red by mutation. The frontend code-side mutation is caught by the compiler, not the guard, and the evidence file says so.
- One honest oddity: "mutation did not apply: (n/a) placeholder" in `red-by-mutation-frontend.txt`. It is labelled, and other mutations cover the same tests. Not load-bearing.

**Running app.** I ran it myself: `start-servers.sh` on 6743/9650, and `assert-phase servers` returned PASS. My own script used throwaway users and CI-health-shaped data:
- a 10-day x 8-test heatmap with duplicates and one empty cell
- a histogram on 79 rows with 7 unusable cells
- a 450-row histogram, truncated
- an aggregated bar with `compare: previous_run` as the line/bar control

All screenshots and the probe log are already in the durable dir `/home/matt/Development/helio/.concertino/runs/HEL-1311/evidence/skeptic-final-1/`. The script wrote them there directly, so no `persist-evidence.sh` copy was needed. sha256 checksums are listed under CR-1.

What I saw:
- The heatmap renders at 1440 and 375 in light and dark. The empty cell shows the card surface. The tooltip escapes HTML.
- The histogram bars touch. "7 non-numeric values skipped." shows. On the truncated panel, "Based on the first 200 of 450 rows." stacks above "4 non-numeric values skipped.", in that order.
- The bar control still draws its "vs previous" overlay in both themes, so line/bar is unchanged. Heatmap and histogram with `compare: previous_run` draw no overlay.
- Editor:
  - The Compare help text and the per-type note ("The vs overlay doesn't show for heatmap charts.") show.
  - The aggregation hint replaces the aggregation pickers.
  - The slot pickers use the shared `Select`, and the 375 layout holds.
  - A stored string column shows as "duration (not numeric)", which matches the spec.
- History for a heatmap shows the muted note with no canvas. History for the bar draws its canvas (`probe-log.txt`).
- Console errors were only a 401 before login and the existing schedule 404.
- My first dark pass hit the per-user rate limit ("Rate limit exceeded" cards). That was my measurement, not the work. I re-ran with a fresh user and got a clean pass.

**DESIGN.md.** No new `theme.css` token. Shared `Select`/`TextField` are used. The CSS additions are a 44px touch floor and a footnote spacing rule. Exception: the heatmap legend leaks a non-token ECharts default colour (CR-1).

### Verdict: REFUTE

### Change Requests

1. **The heatmap's colour-scale legend does not show the colours the cells are painted with. It is badly wrong in dark theme, the scale is inverted in luminance. Fix in `frontend/src/features/panels/ui/heatmapHistogramOptions.ts` `applyHeatmapTheme`.**

   **Cause** (ECharts 6.1.0):
   - `ContinuousView` stacks a full-length `outOfRange` polygon under the `inRange` gradient (`lib/component/visualMap/ContinuousView.js:154-155`).
   - With no `outOfRange` option, `completeController` fills it with `inactiveColor` = `tokens.color.disabled`, about `#ccc` (`VisualMapModel.js:345-355, 443`).
   - The ramp's low stop is `accent` at 0.25 alpha, so the legend composites it over that grey. The cells composite over the card surface.

   **Measured** (`legend-vs-cell-pixels.txt`, self-authenticating pixel values):

   | Theme | Legend low end | Lowest cell | Accent at 0.25 over the card | Accent at 0.25 over `#ccc` |
   | --- | --- | --- | --- | --- |
   | Dark | (219,183,161), a pale tan | (81,47,22), near-black brown | (82,47,22) | (215,182,158) |
   | Light | (215,176,158) | (248,211,190) | (252,218,193) | (215,182,158) |

   In dark theme the legend reads "low = light", while the matrix reads "low = dark". A reader maps values backwards.

   **Reproduced** in two separate runs of mine (light run 1, dark run 2). It is also visible in the executor's own `evidence/screenshots/heatmap-card-dark-1440.png`: legend low end pale peach, low cells dark brown.

   This contradicts the documented deviation in files-modified.md and design D4: "the ramp makes the bar show what the cells show". The e2e only asserts `inRange.color` values, never the drawn legend, so no test catches it.

   **Fix:** make the legend's low stop match the cells. Either:
   - set `outOfRange: { color: ['rgba(0,0,0,0)'] }` (or the card-surface token) so nothing opaque sits under the gradient, or
   - use opaque stops pre-mixed from `--app-accent` and the card surface token at 25% / 100%. This also makes cells and legend identical by construction.

   Add a test that reads the rendered legend's low-end pixel, or at least asserts `visualMap.outOfRange.color` (or opaque stops), in both themes. Re-capture the dark and light screenshots.

   Evidence (sha256):
   - `.../evidence/skeptic-final-1/dash-dark-1440.png` (5e10eaa0…)
   - `.../dash-light-1440.png` (a5ce3cbb…)
   - crops `heatmap-crop-dark.png` (2ddafa7e…) and `heatmap-crop-light.png` (a1d07ff9…)
   - `legend-vs-cell-pixels.txt` (7bc360e6…)

### Non-blocking notes

- With the default `interval`, ECharts hides alternate category labels. Histogram bins then go unlabelled (e.g. only "30 to 79", "128 to 177", …), and heatmap columns and rows are skipped (Oct 02/03 missing at 1440; only 4 of 8 row labels at 375). For a matrix and a distribution that is a real readability cost. Consider an explicit label interval or rotation, or note it as a follow-up.
- Bin labels mix precisions ("0.3 to 10.14", "39.66 to 49.5"). This is correct under the [min, max] rule; rounding is a polish item.
- The aggregation hint "it plots the rows as they are" is inaccurate for a histogram, which counts rows into bins. The "Field field" accessible name in `ChartSlotFields.tsx` (evaluator note) still stands.
- The heatmap option still carries `cursor: "pointer"` on its series. It is harmless because HeatmapView ignores it, and the zr handler enforces `default`.
- Residue: probe users `ceb06f98-e16d-469d-90b1-c67e995eecb2`, `25071af2-373e-43d0-9bfd-1e1b071b8b52` and `12d9c5ee-5155-4646-83cd-7d76ca4cfa8d` remain, because there is no user-delete API. Their dashboards, pipelines and sources were deleted by exact id (all 204).
- Servers I started were stopped by exact PID (vite 1692647 / npm 1692631, java 1692137 / sbt launcher 1691549); ports 6743/9650 are free.
