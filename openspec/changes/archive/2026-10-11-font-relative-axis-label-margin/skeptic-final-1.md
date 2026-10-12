## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `a3fe652583618763b1344893d610084037bfdd69`. The review base was resolved live with `resolve-review-base.sh` (exit 0) as `2e02b79511fab222ac2bc73a142fc61e0979f192`. Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1512/evidence/` (abbreviated `EV/` below).

### What I verified (with evidence)

**Diff (ground truth).**
- `heatmapHistogramOptions.ts` adds `categoryLabelShowAll`, `categoryXLabelShowAll`, `categoryXLabelMargin` (`fontSize * 0.6`), `categoryLabelLineHeight` (`ceil(fontSize * 1.2)`), `fontSizeOf` and `showsEveryCategoryLabel`. There is one global factor (C5 holds).
- `buildChartOption.ts` gates the show-all spread on heatmap/histogram for x and on heatmap for y.
- The compact path recomputes the margin and line height for the 10px font.
- In the snapshot diff, only the `heatmap`, `histogram`, `timestamp x: heatmap` and `timestamp x: histogram` entries change, and every changed line adds an axisLabel key.
- I found no hardcoded colours or tokens in the diff.

**e2e specs, run by me** (servers via `start-servers.sh` on 6944/9851, `assert-phase servers` PASS, `DEV_PORT=6944`, 1 worker, `nice -n 19`):

| Spec | Result | Transcript |
|---|---|---|
| hel1512 | 4/4 passed (light/dark × 1440/375) | `EV/skeptic-final-1-e2e-hel1512-category-axis-labels.txt` |
| hel1311 | 9/9 passed | `EV/skeptic-final-1-e2e-hel1311-heatmap-histogram-charts.txt` |
| hel1305 | 6/6 passed, incl. time-axis legibility at 375 in light and dark | `EV/skeptic-final-1-e2e-hel1305-chart-time-axis.txt` |
| hel1306 | 8/8 passed (light/dark × 1440/375) | `EV/skeptic-final-1-e2e-hel1306-chart-reference-lines.txt` |

The hel1512 measurements I logged:
- **1440:** heatX 7/7 (gap 91.36), heat8X 7/7 (gap 88.36), hist10 10/10 (gap 16.75), hist20 5/20 (gap 15.75), fontPx 12.
- **375:** heatX 7/7 (gap 14.57), heat8X 7/7 (gap 12.000), hist10 4/10 (gap 13.04), hist20 3/20 (gap 17.20), fontPx 10.
- No overlaps at either width.

These match the evaluator's numbers.

**AC traced.**
1. *7 of 7 days at 375 on both heatmaps.* Met: heatX and heat8X show exactly `DAYS` at 375, light and dark, in my e2e run and in my own probe.
2. *10 of 10 bins at 1440.* Met: hist10 shows 10 labels at 1440 in light and dark. Main shows 5 (`EV/hel1512-e2e-red-main.txt`, assertion failure "Received length: 5").
3. *Font-relative minimum gap.* Met. The minimum gap at 1440 (12px font) is 15.75 (hist20), against a floor of 14. At 375 (10px font) it is 12.000 (heat8X), against a floor of 12.
4. *No HEL-1305/HEL-1306 regression.* Met: the hel1305 and hel1306 specs are green, and the time-axis path is untouched (`showsEveryCategoryLabel` gates only heatmap and histogram).
5. *Light and dark at 1440 and 375.* Met: all four combinations were run and screenshotted.
6. *hist20 at margin 7.2.* Met with evidence: 5 of 20 shown, minimum gap 15.75 ≥ 14, so no owner call was needed (main shows 4, gap 28.4, per `EV/hel1512-measurements.md`).

**Adversarial check that the e2e is not vacuous.** I wrote my own probe (`EV/skeptic-final-1-probe.spec.ts`, transcript `EV/skeptic-final-1-probe.txt`). It reads each chart's `getOption()` and the raw zrender label elements, and records:
- the label style font;
- whether `ctx.font` actually took the assignment;
- ECharts' own box width against the real `measureText` width;
- the transform scale;
- hidden and shown counts.

It found:
- **Font-size detection, which picks the floor.** `el.style.font` is present, for example `normal normal 12px "JetBrains Mono", …`. The `ctx.font` assignment was applied in every case (`fontApplied: true`), not left at the canvas default of `10px sans-serif`. The option's `axisLabel.fontSize` is 12 at 1440 and 10 at 375. So the 14/12 floor is selected from the real rendered font, not a fallback. A failed font assignment would have silently weakened the 1440 floor to 12, and that is not happening.
- **Gap computation.** Transform scale is 1. On warm runs ECharts' box widths equal the real text widths (`widthDiff` 0). My box-to-box gaps reproduce the spec's real-width gaps exactly (heat8X 375: 12, 12, 12…; hist10 1440: 16.75; hist20 1440: 15.75). The centred-span method is therefore sound for these centre-aligned x labels.
- **The heat8X 12.000 threshold edge.** This is a true measurement equal to the floor (ECharts box and real width agree), so it passes without needing the 0.05 epsilon. It is also the chart that guards the compact path. The evaluator's mutation that makes compact inherit 7.2 fails both 375 cases (`EV/eval1-e2e-mut-compactInherits72.txt`: "2 failed": the day arrays shrink). The main-equivalent mutation fails both 1440 cases on hist10 (5 vs 10). The no-mutation control is 4/4 green.
- **Cold webfont load.** This is an extra risk the spec does not exercise. I loaded the dashboard directly at its final width with Google Fonts requests delayed by 4 s (`EV/skeptic-final-1-probe-fontdelay.txt`); JetBrains Mono was `unloaded` when the page rendered.
  - At 1440, ECharts laid labels out on fallback metrics (box 0.6–2.0 px wider than the real text). It still showed 10/10 and 7/7, and the real gaps were larger, not smaller.
  - At 375, both heatmaps still showed 7/7 (gap 12, `widthDiff` 0).
  - Three separate fresh-browser runs at 375 in each theme were 7/7 (`EV/skeptic-final-1-probe-cold-*-375-*.txt`).

**Gates.**
- Jest: 568 suites / 6209 tests / 19 snapshots, all passing.
- `npm run typecheck` and `npm run lint` are clean (`EV/skeptic-final-1-unit-gates.txt`).
- `buildChartOption.categoryAxisLabels.test.ts` asserts concrete values: margin 7.2 and 6, line height 15 and 12, and an untouched `bar`.

**UI judgment** (screenshots I took and looked at, persisted):
- `EV/e2e-evidence/HEL-1512/heat8-light-375.png`
- `EV/e2e-evidence/HEL-1512/heat8-dark-375.png`
- `EV/e2e-evidence/HEL-1512/hist10-light-1440.png`
- `EV/e2e-evidence/HEL-1512/hist20-dark-1440.png`
- `EV/e2e-evidence/HEL-1512/skeptic-final-1-page-dark-375.png`
- `EV/e2e-evidence/HEL-1512/skeptic-final-1-page-light-1440.png`

What they show:
- At 375, the day labels read as separate words in both themes.
- At 1440, the hist10 bin ranges are clearly separated, with no "133 to 148 194 to 209" run-on.
- Label colour comes from the existing theme text token in both themes, and light/dark parity holds.
- No new UI elements or components were introduced, so DESIGN.md token and component rules are not engaged beyond the label colour, which is unchanged.

**Cleanup.**
- Every user was a throwaway `@example.test` address, created by the spec or my probe, with email cross-checked against `/api/auth/me`. Examples: `skeptic-hel1512-light-1440-1791784593790-67922@example.test`, id `baf24437-…`. Teardown reported "deleted N recorded throwaway user(s)" on every run, and the source, pipeline and dashboard were deleted by exact id.
- I stopped my servers by exact PID (2660242, 2660227, 2659309, 2658408, 2658347). Ports 6944 and 9851 are free and no process has its cwd in this worktree. The other sbt process present (`testFull`) belongs to the HEL-1511 worktree and was not touched.

### Verdict: CONFIRM

### Change Requests

None.

### Non-blocking notes

- **Uneven label positions under greedy `hideOverlap`.** The 20-bin histogram shows bins 0, 4, 8, 13, 18 at 1440 and 0, 6, 13 at 375 (`hist20-dark-1440.png`), where main showed evenly stepped labels. Every label names its own range, so nothing is misleading, and this is the mechanism the ticket asked for. Still, an owner may want an even-interval follow-up for dense histograms.
- **heat8X at 375 sits exactly on ECharts' hide threshold** (gap 12.000 vs 2 × 6). Any label-font metric change could flip it to fewer days: a different fallback mono font on a real phone, a font-weight change, or a different `COMPACT_AXIS_LABEL_FONT_SIZE`. The e2e will catch this in CI, but there is zero headroom. This is disclosed in design.md Risks.
- **Unrelated to this change:** charts lay out on fallback-font metrics if JetBrains Mono has not loaded yet, and nothing re-lays them out on `document.fonts` load (no `document.fonts` handling exists in `frontend/src`). Harmless here, because the fallback was wider, which makes `hideOverlap` more conservative.
- `buildChartOption.ts` is now 412 lines, over CONTRIBUTING's ~400-line threshold, as the evaluator also noted.
