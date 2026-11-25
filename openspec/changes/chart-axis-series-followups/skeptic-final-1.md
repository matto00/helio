## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `e75f34f0dacf9b1b624164dc04c73113b69e4014` against the live-resolved base
`60909ebd4c5e756dafe1bb49e109b4cb8ee568d9` (`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY`.

### What I verified (with evidence)

**Diff read in full** (`git diff 60909ebd4...HEAD`): production changes are confined to `buildChartOption.ts` (1 line),
`chartDataOptions.ts`, `chartTimeDataOptions.ts`, `echartsCore.ts`, `ChartRenderer.tsx`, `utils/chartSeriesNotes.ts`
(new), `utils/chartTimeAxis.ts`, `utils/chartTypeOptions.ts`. No backend, schema or migration file. This matches the
proposal's Impact list.

**AC tracing**
- Item 1, tick floor: `timeAxisMinInterval` (`utils/chartTimeAxis.ts:69-77`), applied at `buildChartOption.ts:218`
  inside the time-only spread, after the appearance spread. ECharts 6.1.0 honours it: `node_modules/echarts/lib/scale/Time.js:560-563`
  clamps `approxInterval` to `minInterval`. Live check (browser TZ America/Los_Angeles, so this is not UTC
  by coincidence): every time chart on my dashboard had `minInterval: 86400000`, every live tick `% 86400000 === 0`,
  and the view labels were day numbers only (`Sep,3,5,...,13,14` for 14 days; `Sep,2,3,4` for 4 days). Checked at 1440 px
  and 375 px, in light and dark.
- Item 2, sum plus footnote (owner ruling): both multi-series builders (`chartDataOptions.ts:208-223`,
  `chartTimeDataOptions.ts:60-75`) call `sumBySeriesAndKey`. `summedRowsNote` uses the same helper with the same keys:
  raw x, or the plan's `timed` instants. On a category-fallback plan it keys by raw x, which is also what the builder
  does there. Live:
  - Category bar Mon/A plots 7 (3+4), with the footnote "2 rows with the same x value and series were added together."
  - Two spellings of one instant (`2026-09-01` + `2026-09-01T00:00:00Z`) plot 7 at 1 Sep.
  - A time line shows "2 rows with the same time and series were added together."

  The click-selection filter for bar/line (`chartClickSelection.ts`) returns every row at that x and series, so it
  still agrees with the summed point.
- Item 3: the scatter `plotted` filter requires a numeric x, and the `x -> 0` fallback is gone. Live: rows x=`1,abc,3,5`
  drew 3 points, none at 0, with "1 row with no numeric x value not shown." Click selection for scatter is value-based,
  not index-based, so the shorter `plotted` list cannot misroute a click.
- Item 4: `applyLine` adds a `silent` `emptyCircle` markPoint on numeric points with no numeric neighbour. On a category
  axis the coord is the index; on a time axis it is the instant. `applyLine` runs (`buildChartOption.ts:256`) after the
  `type: "time"` override, so the time detection is reliable. `MarkPointComponent` is registered in `echartsCore.ts`.
  There is no line stacking option (`LineChartOptions` has only smooth/showPoints/areaFill), so a raw-y coord cannot be
  displaced by a stack. Live:
  - Single-series markers-off line: marker at the isolated 3 Sep value.
  - Multi-series markers-off line: series A's isolated 8 Sep value (itself a sum, 7) is marked. Series B's line ends
    next to its gap are not marked, which is correct (each has a numeric neighbour).
  - This also closes the evaluator's "no multi-series item-4 unit case" gap at the rendered level.
- Item 5:
  - The GUARD row `x+series without a yAxis` is in `chartTimePlan.test.ts:224-239`, labelled, and goes red under M2 per
    `mutations-1.txt`.
  - The hel1508 positive control (`e2e/hel1508-chart-time-axis-followups.spec.ts:301-316`) runs `hideTip`, then `showTip`
    on a real point, and asserts a non-empty tooltip containing `5`. A wrong locator goes red
    (`e2e-mutation-wrong-tooltip-locator.txt`).
- Item 6: not split (design D6). This matches the owner ruling's "otherwise leave it and raise a follow-up triage".
  **The follow-up triage is owed at Delivery.**
- Changed existing assertion (`buildChartOption.timeAxis.test.ts:55`, `[2,null,null]` -> `[4,null,null]`): the
  fixture at line 51 really does contain two `(Mon, 2, B)` rows (`rows[1]` plus the appended one), so 4 is the ruled
  behaviour and not a fixture edited to make the test pass.

**Gates re-run fresh by me** (after `nice -n 19 npm ci` in `frontend/`, 3 workers):
- Targeted (`chartFollowups|chartSeriesNotes|minInterval|chartTimePlan|followupNotes|buildChartOption|chartTypeOptions|ChartRenderer`):
  `Test Suites: 18 passed, 18 total`, `Tests: 990 passed, 990 total`, exit 0.
- Full frontend jest: `Test Suites: 947 passed, 947 total`, `Tests: 11043 passed, 11043 total`, exit 0. The output is
  in `.concertino/scratch/HEL-1517/skeptic-final-jest-full.out`.
- I did not re-run lint, typecheck, format or e2e. I rely on the evaluator's run for those; their stated results are
  consistent with the committed `e2e-hel1517-run.txt` and `e2e-hel1508-run.txt`.

**UI judgment** (servers via `start-servers.sh` on `helio_hel1517`, `assert-phase.sh servers` PASS, stopped with
`stop-servers.sh`). I seeded my own dashboard: a 14-day line with markers off, a summed multi-series line, a
multi-series line with markers off, a two-note chart, a category summed bar and a scatter. I viewed it at 1440 and
375 px in both themes. Screenshots (persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1517/evidence/.concertino/scratch/HEL-1517/skf/dark-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1517/evidence/.concertino/scratch/HEL-1517/skf/dark-1440-lower.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1517/evidence/.concertino/scratch/HEL-1517/skf/light-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1517/evidence/.concertino/scratch/HEL-1517/skf/light-375.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1517/evidence/.concertino/scratch/HEL-1517/skf/light-375-twonotes.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1517/evidence/.concertino/scratch/HEL-1517/skf/dark-375.png`

Findings:
- **Dark-theme marker fill.** The isolated marker's white fill is not an outlier. In the same dark screenshot, the
  default (markers-on) line markers of the sibling "summed by region" chart are the same white-filled ring at the same
  size. The isolated marker is therefore visually identical to every other line marker in the app, in both themes. It
  reads correctly as "a point", in its series colour.
- **Footnotes.** They reuse the existing `chart-panel__skipped-note` element; no new CSS, so tokens are unchanged.
  - At 375 px the two-note line wraps to two lines and is not clipped (`scrollHeight 46 == clientHeight 46`).
    `title` holds the full text.
  - The wording sits in the same register as HEL-1508's "N rows with no readable date not shown." It is short,
    concrete, uses no jargon beyond "x value", and is consistent with sibling notes. It meets DESIGN.md §5 (plain
    language).
- Item 1 at 375 px: day labels only, no time-of-day, including the short 4-day range.
- Console: 0 errors during the session.

**Owner-rulings claim:** the rulings section was relayed by the driver. The implementation matches it as written
(item 2: sum plus a footnote reusing the HEL-1508 pattern; item 3: excluded with a footnote, derived; item 6: no
split). I did not independently confirm the rulings' provenance. That is the driver's/orchestrator's to own, and
nothing in the code depends on it beyond the item-2 behaviour.

**Gate-defect check (CON-160):** I accepted no mtime-ordering claim. My evidence is content-based: live option
values, tick arithmetic, footnote text and DOM measurements.

**Test residue:** my throwaway user `d452411a-81e4-4e1a-a42f-fbb1a3689ad6` is gone. Its dashboard, 4 pipelines and
4 sources were deleted by exact id through the API (all 204). The user was then removed with `buildUserDeleteSql` on
`helio_hel1517` only: COMMIT, and the post-check count is 0.

### Verdict: CONFIRM

### Non-blocking notes
- On a horizontal multi-series bar, "x value" in the summed footnote names the axis that is drawn vertically. This is a
  minor wording mismatch. A future pass could name the field ("same weekday and region") instead of the axis. It is
  not a product question the rulings leave open: the wording is the planner's self-approved choice and is acceptable.
- tasks.md 1.4 claims a multi-series unit case for item 4 that does not exist (the evaluator flagged this too). The
  behaviour is verified live above. Adding the unit case, or correcting the task wording, is optional.
- The item-6 follow-up triage must be raised at Delivery (design D6).
- No product question is left unsettled by the ticket and rulings. Nothing needs escalating.
