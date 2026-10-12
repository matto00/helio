## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD: 3699d2f53cdadde86cc21f94ec9c639700c91418 (branch task/chart-axis-label-polish/HEL-1487).
Diff base, resolved live: `resolve-review-base.sh` printed 41db49cee08f358a491253a1021e594b74d9dd6a. That is
origin/main, and it is an ancestor of HEAD.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/chart-axis-label-polish/HEL-1487`.
- **Owner ruling:** `.concertino/runs/HEL-1487/events.jsonl` line 66 records `escalation.answered`
  `answer: "ship-items-2-5-revert-label-showing-file-followup"` with `answer_source: "human"` and
  `resolution_channel: "chat"`. It answers escalation HEL-1487-1791770421862-f72581 (line 64). The discarded answer on
  line 65 was the auto-path, which the human answer superseded. Scope is therefore items 2-5 plus bin-label precision,
  with axis thinning kept as on main. Show-all is out of scope (HEL-1512).
- **Code diff vs the live base** (`git diff 41db49cee...HEAD -- e2e frontend openspec/specs`):
  - `heatmapHistogramOptions.ts`: `histogramBinLabel` is replaced by `histogramBinLabels`, and
    `buildHistogramDataOption` uses it. No axisLabel, interval, hideOverlap, textMargin or lineHeight line changes.
  - `buildChartOption.ts` has an empty diff. `git grep hideOverlap|textMargin` in `frontend/src` (non-test) finds only
    HEL-1305's existing time-axis `hideOverlap` at `buildChartOption.ts:214`. There is no hel1487 e2e spec under `e2e/`.
  - No dead export: `histogramBinLabel` has zero references left.
  - The snapshot `chartUnchangedPath.main.snapshot.json` differs from main by exactly one line, the 3-bin histogram
    labels `"1.0 to 3.7", "3.7 to 6.3", "6.3 to 9.0"`. `unchangedPathCases.ts` documents that difference.
- **Gates, re-run myself at HEAD:** `npm run lint` exit 0, `npm run typecheck` exit 0 and `npm run format:check` exit 0
  ("All matched files use Prettier code style!"). The jest run (`HELIO_JEST_MAX_WORKERS=3`) ran the full suites:
  frontend 562/562 suites and 6162/6162 tests pass, helio-mcp 48/48 suites and 454/454 tests pass.
- **AC1, precision:** `heatmapHistogramLabels.test.ts` covers every spec scenario: 2.5 width gives 1 place, 2 width
  gives 0, no -0, epoch gives 2 places, 1e-6 and 0.01 stay distinct, a single bin gives "1700000000.5", and the
  width comes from the full span. These tests pass in the run above. In the running app every histogram's labels
  share one precision (e.g. `10.0 to 13.6 ... 49.8 to 53.4`).
- **AC1, axis thinning in the running app** (throwaway user bea2d57c-eb6e-41fe-87d3-b0179448b7e1, verified via
  `/api/auth/me` before each probe; location.href re-checked each time). I built one heatmap (7x4) and histograms
  with 5, 10, 12 and 20 bins on non-integer data. I measured rendered labels from the ECharts display list and
  simulated main live by `setOption`-ing main's exact labels (the per-edge `formatChartNumber` of the raw bin edges).
  This is the only option difference, per the snapshot.
  - **Heatmap:** the code path is byte-identical to main. 7/7 day labels and 4/4 row labels, 0 overlaps, at 1440
    and 375.
  - **Histogram, 1440** (light and dark, reproduced on two fresh loads):

    | Bins | Branch labels | Main-sim labels | Overlaps (both) | Branch min gap |
    | --- | --- | --- | --- | --- |
    | 5 | 3 | 3 | 0 | 71.1 px |
    | 12 | 3 | 3 | 0 | 44.8 px |
    | 10 | 4 | 3 | 0 | 31.7 px |
    | 20 | 4 | 3 | 0 | 31.7 px |

  - **Histogram, 375:** every histogram shows 3 labels on the branch and 2 on main-sim. 0 overlaps. Branch min gaps
    are 22.7 to 26.0 px.
  - **Why the counts differ.** The thinning mechanism is unchanged: it is ECharts' auto interval in both cases. The
    new labels are up to 2 characters shorter (`10.0 to 14.3` vs `10 to 14.34`), so the same auto-interval
    computation fits one more label. No new overlap anywhere, and every gap is at least 22.7 px. That is well clear
    of the 6-7 px run-together defect the owner rejected, and comparable to main's own 30.4 px (12-bin at 1440).
  - **Measurement caveat (disclosed).** ECharts caches the last auto interval (hysteresis). After a main-sim
    `setOption`, the restored chart kept main's larger interval. `s3-light-1440-AFTER-mainsim-cached-interval.png`
    shows that artefact, not the shipped state. The fresh-load screenshots below are the shipped state.
- **AC2:** `OutputKindFields.tsx:155` reads "Aggregation isn't available for heatmap — rows with the same column and
  row are summed into one cell." The test in `OutputEditorSheet.heatmapHistogram.test.tsx` asserts it (passing), and
  canonical spec scenario "Heatmap hint describes summing" matches it.
- **AC3:**
  - `ChartPanel.tsx:7` now defers to "the `ChartType` set registered in `echartsCore.ts`". `echartsCore.ts:18,29-36`
    registers Bar, Line, Pie, Scatter and Heatmap, with histogram as a BarChart.
  - The `applyChartOverlay` doc (`chartOverlayOption.ts:72`) says "any chart type other than line/bar". The code at
    `:84` is `chartType !== "line" && chartType !== "bar"`, so the comment is accurate.
- **AC4:**
  - `settleSheetOpenAnimation` filters the dialog's own `ui-modal-in` animations (not subtree) and runs before both
    measurements. Both sites assert `>= 43.5`.
  - The evaluator's pasted e2e output (`evidence/hel1487-c5-e2e.txt`, 23 passed) shows heights `[44,44,44]` and
    bin-count `44` at 375 in light and dark. HEL-1490 (9e51550f1) is an ancestor of 609b0bba0, and the only later
    e2e/frontend diff to HEAD is the comment in `unchangedPathCases.ts`.
  - Red evidence: `hel1487-e2e-hel1311-RED-b-undersized-css.txt` and `...RED-b2-undersized-bincount-css.txt` both
    show "Expected >= 43.5, Received 40" at the two assertion sites.
  - I did not re-run Playwright: there is no scripts/concertino entry point for it, and a bare `npx playwright` is
    barred. The pasted output is unambiguous, so I relied on it.
- **AC5:** The comment above the legend probe names ECharts 6.1.0 and `frontend/package-lock.json`. The lock file
  has `node_modules/echarts` at `"version": "6.1.0"`.
- **Specs and archive vs the ruling:**
  - The canonical spec and the archive delta contain no "every label that fits" requirement.
  - ticket.md AC1 is restated per the ruling.
  - tasks.md marks 1.2, 2.4, 3.2, 4.1 and 4.2 as reverted or dropped by 5.1.
  - proposal.md and design.md D1 state the ruling and the HEL-1512 split.
- **Other checks:**
  - No `eslint-disable` and no `color-mix` in any changed frontend or e2e file.
  - `git log --format=%B 41db49cee..HEAD` has no `claude.ai` link and no `Claude-Session` trailer (grep exit 1).
  - HEL-1305/1306: `buildChartOption.ts` is unchanged, and the c5 e2e run (23 passed) includes the 1305/1306 specs.
- **Squash:** the branch was not re-squashed after 5df333a1f and carries the reverted show-all commits. With a
  `--squash` merge the net tree is what I reviewed, so this is not a defect.
- **Console:** 0 errors during the measured runs. The ECharts "Can't get DOM width or height" warnings appear only
  across a viewport resize plus reload; there is no layout change in this diff. One error came after I deleted the
  open dashboard (my own cleanup).

Screenshots (durable, in `.concertino/runs/HEL-1487/evidence/skeptic3/`):
- `s3-dark-1440-fresh.png`
- `s3-dark-375-fresh.png`
- `s3-light-375-fresh.png`
- `s3-light-1440-AFTER-mainsim-cached-interval.png` (hysteresis artefact, see the caveat above)

### Verdict: CONFIRM

### Non-blocking notes

- **Not literally "the same labels shown".** The orchestrator's brief asked for the same labels as main. Taken
  literally, that does not hold for histograms whose labels got shorter: 10 and 20 bins at 1440 show 4 vs 3, and
  every histogram at 375 shows 3 vs 2. The thinning mechanism is main's, unchanged, as the owner ruled ("keep main's
  thinning"). The extra label comes only from the shorter text, with no overlap and gaps of at least 22.7 px. Forcing
  main's exact label set would mean adding a new axis option, which the ruling rejects. I judge this inside the ruling.
  If the owner reads "same labels" as an exact label set, that belongs to HEL-1512.
- **Long comment line.** `chartOverlayOption.ts:72` is now about 150 characters. Prettier does not wrap comments, so
  it passes, but a wrap would match the file's style.
- **User row not deleted.** Its data (source, pipeline, 5 outputs, dashboard) was deleted by exact id via the API.
  Deleting the user itself means a direct DB delete with backend/.env credentials, which I did not touch. Leftover:
  user `bea2d57c-eb6e-41fe-87d3-b0179448b7e1`, `s3-1791772410378-hel1487-skeptic3@example.test`.
