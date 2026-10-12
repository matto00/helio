## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `c90df4304642978e12318efe47197f01737769db`. There are no tracked changes; the untracked files are evaluation-2.md, evaluation-3.md and skeptic-final-1.md.
- The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=task/chart-axis-label-polish/HEL-1487`.
- The diff base was resolved live with `resolve-review-base.sh <wt> main origin` (exit 0): `d6aef6c46cfd3fcd47ebddd5519497d0f58c562b`. `origin/main` is an ancestor of HEAD.
- Commits in range: 5df333a1f (squash), e0737d63a (archive), 17bb3e99d (merge), c90df4304 (round-1 fix).

Evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1487/evidence/skeptic2/`. That is the durable main-checkout run dir, outside the worktree. My Playwright MCP files were moved into `mcp/` there. No claim below depends on mtime ordering. Every claim rests on probe output, screenshots and line numbers.

### What I verified (with evidence)

**Gates.** I ran these myself under `nice -n 19`, from `frontend/`:
- `npm test -- --testPathPatterns='features/panels/ui|OutputEditorSheet.heatmapHistogram|histogramBins'` gave 138 suites and 1433 tests passed, exit 0 (`jest.txt`).
- `npm run lint` exited 0 (`lint.txt`).
- `npm run typecheck` exited 0 (`tc.txt`).

I relied on the evaluator's pasted e2e transcripts, which are unambiguous:
- `hel1487-c3-e2e-RED-on-17bb3e99d.txt`: 375 light and dark are red, with heat8Y at 6/6 and 5 overlapping pairs.
- `hel1487-c3-e2e-GREEN.txt`: 27 passed.
- `hel1487-e2e-hel1311-RED-b-undersized-css.txt`: Expected >= 43.5, Received 40.

**Hygiene.**
- `+` lines under `frontend/` and `e2e/` contain no `eslint-disable` or `color-mix` (grep exit 1).
- `git log --format=%H%n%B base..HEAD` contains no `claude.ai`, `Claude-Session` or "session" (grep exit 1).
- No colour changes.

**Round-1 change requests, verified independently.**
- **CR1 (heatmap rows overlap at 375): met, in the running app.** I used my own fixture (12 months × 6 services, w:6), plus a long-label variant.
  - At 375 the heatmap row axis shows 3 of 6 labels (`inventory, billing, search`), `lineHeight` 12, fontSize 10, in both light and dark (`s2-light-375-top.png`, `s2-dark-375-top.png`).
  - Ink-box gaps between the shown rows are 1.0 and 2.5px, with no ink overlap. The labels read cleanly.
  - At 1440 all 6 rows are shown (`lineHeight` 15).
  - Line and bar charts carry no `lineHeight`. The bar chart's x axis is still `type: time` with `hideOverlap` and `textMargin [0,3]`.
- **CR2 (e2e can see the defect): met.**
  - `e2e/hel1487-category-axis-labels.spec.ts:65-80` uses canvas `measureText` heights, not zrender's.
  - Its 6-row `heat8` fixture is red on 17bb3e99d and green on HEAD (transcripts above).
- **CR3 (unit tests): met.**
  - `buildChartOption.heatmapHistogram.test.ts` (HEL-1487 describe) covers `lineHeight` 15 and 12 for heatmap x/y and histogram x.
  - It checks the histogram y axis and line/bar x stay untouched.
  - The snapshot edits are limited to heatmap and histogram entries (diff read in full).

**AC2, AC3, AC5: met** (diff read).
- `OutputKindFields.tsx:155` has the summing copy, and the test asserts it.
- `ChartPanel.tsx:7` now defers to `echartsCore.ts`.
- `chartOverlayOption.ts:72` names line/bar only.
- `e2e/hel1311-heatmap-histogram-charts.spec.ts:305-307` names ECharts 6.1.0.

**AC4: met.**
- `settleSheetOpenAnimation` filters the dialog's own `ui-modal-in` animation, and both sites assert 43.5.
- The undersized-CSS red is recorded at 40px.

**HEL-1305 / HEL-1306: no regression.**
- The time-axis line and the bar chart with the "SLO 60" line and "Healthy" band render correctly at 1440 dark (`s2-dark-1440-refbar.png`) and at 375 light and dark.
- Their x labels and plot rects are unchanged: both are 143px tall at 1440, and the time labels Sep, 3…13 have gaps of 22 to 31px.

**Orchestrator's specific judgments.**
1. **1440 heatmap plot 7.8px shorter, x labels about 4px lower: acceptable.**
   - Before, `containLabel` reserved a label row 7.2px tall for 12px text. That was the '国' under-measurement, so main was under-reserving.
   - At `lineHeight` 15 the heatmap plot is 144px tall, which now matches its sibling line, bar and histogram plots in the same grid (143px).
   - It is a correction toward consistency, not a regression.
2. **The e2e detector's ink box (not the line box): adequate for what it checks.**
   - Measured against the font box (13px), the shown compact rows at a 12px pitch would count as overlapping. Their real ink gaps are 1.0 and 2.5px, and they read cleanly in the screenshots. The font box would therefore raise false reds.
   - The ink box is the right definition of a visible vertical overlap, and it went red on 17bb3e99d.
   - Its blind spot is that it has no *horizontal minimum-gap* check. That is exactly why the defect below passes it.
3. **Remaining cases: one real legibility regression, the histogram bin axis (below).** Heatmap x with long labels (`region-…`, 8 columns) shows 2 labels at a 44px gap at 1440 and 13.5px at 375, which is legible.

### Defect: histogram bin labels run together (AC1 intent; main was more legible)

`interval: 0` + `hideOverlap` lets ECharts pack shown labels down to its default `axisLabel.textMargin: [0, 3]`. That leaves about a 6px gap between labels, a single character width (7.2px) in the monospace axis font.

A histogram range label already contains internal single spaces ("133 to 148"). Packed this way, adjacent labels read as one continuous run, and a reader cannot tell which numbers belong together.

Fixture: latency 12.345–314.743, w:6 and w:4 cards. Reproduced on four separate loads: 1440 light, 1440 dark, 375 dark and 375 light.
- **1440, hist20 (w:4):** renders `12 to 27   73 to 88   133 to 148 194 to 209 254 to 269`. Measured gaps are 21.1, 13.9, 6.7 and 6.7px (`s2-light-1440.png`, `s2-dark-1440.png`).
- **1440, hist12 (w:6):** renders `12 to 38 63 to 88   138 to 164 …`, with a first gap of 8.0px.
- **375, hist12:** renders `88 to 113 164 to 189`, with a gap of 6.0px, in light and dark (`s2-light-375-top.png`, `s2-dark-375-top.png`).

**Main, simulated on the same live charts.** I set `interval: 'auto'`, no `hideOverlap`/`lineHeight`, and main's 2-dp `formatChartNumber` labels.
- It showed 3 labels at 1440 with 46 to 56px gaps (`s2-light-1440-hist-mainsim.png`).
- It showed 2 labels at 375 with 37 to 47px gaps (`s2-dark-375-hist-mainsim.png`).
- Main showed fewer labels, but every one of them was unambiguous. The change shows more labels that cannot be reliably read, which defeats the purpose of item 1 on its main target, the histogram.

ECharts' own comment on `textMargin` (`echarts/lib/coord/axisDefault.js:113-119`) says it exists "to prevent the text from appearing visually joined". The 3px default does not achieve that for multi-word labels.

**Fix probe, live.** I set `xAxis.axisLabel.textMargin: [0, 10]` on the histogram and heatmap x axes.
- Minimum gap went from 6.7 to 21.1px at 1440 and from 6.0 to 22.1px at 375.
- hist20 still shows 5 labels at 1440; hist12 shows 4 labels at 1440, 3 at 375.
- Heatmap months at 1440 are unchanged (Jan, Mar…Nov); at 375 they show Jan/Apr/Jul/Oct, evenly spaced.
- Every label reads as its own range (`s2-light-1440-hist-textmargin-probe.png`, `s2-light-375-textmargin-probe.png`).

### Verdict: REFUTE

### Change Requests

1. **Give the show-all category x axes enough horizontal separation that adjacent labels cannot read as one run.** Applies to the histogram x axis, and to the heatmap x axis for consistency.
   - Where: `heatmapHistogramOptions.ts` `categoryLabelShowAll` / `CATEGORY_LABEL_SHOW_ALL` and its x-axis call sites in `buildChartOption.ts` (normal path :225-227; compact path :385-387).
   - What: set an explicit `textMargin` with a zero vertical component and a horizontal component of at least about one character width each side, for example `[0, 10]` at 12px. It may be font-relative, such as `[0, Math.ceil(fontSize * 0.8)]`, applying to both normal and compact.
   - Keep the vertical component 0 so the heatmap row axis (CR1's fix) is unaffected. Alternatively, apply it to x axes only.
   - Verify in the running app, light and dark, at 1440 and 375, with a 12-bin and a 20-bin histogram over non-round data (e.g. 12.345–314.743) on w:6 and w:4 cards:
     - every pair of shown x labels has a gap of at least about 2 character widths (≥ 14px at 12px, ≥ 12px at 10px);
     - the e2e's 1440 "all labels shown" assertions (7 days, 3 tests, hist5 = 5, hist10 = 10) still hold;
     - the heatmap rows at 375 still show fewer than all rows with no ink overlap.
2. **Make the e2e able to see this, red on c90df4304.**
   - In `e2e/hel1487-category-axis-labels.spec.ts`, extend `axisLabels` to return the horizontal gaps between consecutive shown x labels.
   - Assert a minimum gap (the same threshold as CR1) for every histogram and heatmap x axis.
   - Add a fixture that packs at the current 3px margin: non-round data and a 12+ bin histogram, at a width where `hideOverlap` must hide some labels.
   - Record red on c90df4304 (gap ≈ 6px) and green after fix 1.
3. **Cover the new `textMargin` in the HEL-1487 unit describe** (`buildChartOption.heatmapHistogram.test.ts`), in normal and compact modes.
   - Line/bar must stay untouched.
   - Limit any `chartUnchangedPath.main.snapshot.json` edit to the heatmap and histogram entries, as before.

### Non-blocking notes

- **Histogram value axis (y) at 375 is crushed.** It shows 8 ticks in a 61px plot, with ink gaps of 0.7px ("7 6 5 4 3 2 1 0" in `s2-light-375-top.png`). This change does not touch that axis (the unit test asserts no `interval`, `hideOverlap` or `lineHeight` on it), so it predates this change. It is worth a follow-up ticket.
- **Carried over:**
  - wrap the long comment lines at `chartOverlayOption.ts:72` and `unchangedPathCases.ts:2`;
  - `PanelDetailModal.mobile.css:216` still lists bar/line/pie/scatter.
- **Console.**
  - At 375 there are 14 ECharts "Can't get DOM width or height" warnings, from the hidden desktop grid on the mobile stack.
  - There are two 502s on `/run-events` (SSE) after about 110s.
  - Neither is on this change's code path.
- **Gate audit:** no report I drilled into disclosed unsound evidence-directory mtimes, and no gate accepted an mtime-ordering claim.
- **Residue and servers:**
  - Throwaway user `84a72cbe-89ea-43f5-a651-43f81c8c08fc` (`s2-1791768052594-hel1487-skeptic2@example.test`) was checked via `/api/auth/me` before seeding and before deletion.
  - Dashboard `68d80880-…`, pipelines `f9f7ff48-…` and `93a7bdeb-…`, and sources `352be04a-…` and `356975ef-…` were deleted via the API (204 each). A re-list returned 0/0/0.
  - The user was deleted by exact id and email via the harness's `buildUserDeleteSql`; a follow-up count returned 0.
  - Servers were stopped by exact PID: 1232620/1232605 (vite/npm) and 1232394/1232257 (java/sbt launcher). I confirmed their cwd was this worktree first; the ports are free afterwards.
- `location.href` was re-read in every probe and was always `localhost:6919/dashboards/68d80880-…`. No hijack was observed.
