## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD a369a9cb84a0966adb3c8c9d515838ebfbf6bb15 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/footnoted-chart-card-canvas/HEL-1444`.
- **Repro numbers match the raw data.** I tabulated all 72 cards in `.concertino/runs/HEL-1444/evidence/repro/measurements.json`
  (bar/hist/time x light/dark x 1440/1900 x w2/w4/w6 x plain/ctl). Canvas is 102 / 94.4 / 33 / 25.4 (two footnotes) and
  85.2 / 69.6 / 16.2 / 0.6 (three). Bar 57, footer overrun 0 everywhere, `titleAttr` null, `headingByFullNameCount` 1.
  These are identical across themes and viewports, as ticket.md claims.
- **Overprint is real.** Screenshots `bar-dark-1440-w2-ctl.png` ("150"/"0" overprinted) and `hist-light-1440-w2-ctl.png`
  ("30"/"0" overprinted) show it. In `time-light-1900-w4-ctl.png` the canvas has collapsed completely.
- **Design arithmetic checks out against the CSS and the measurements.** Footnote rule `PanelContent.css:205-221`:
  padding 4/12/8, line-height 1.4 x text-xs = 16.8. Annotation 28.8, note 24.8 (padding-top 0 via L421/L427). The
  third note shares the `chart-panel__truncation-note` class (`ChartRenderer.tsx:150`), so D1's selector covers it.
  The bar is 13 + 4 + 32 + 8 = 57 (`OutputViewerControlBar.css`: padding 0 0 space-2, column gap space-1). Content
  box: w4 148, w2 135.6, with a 12px article gap between bar and content. My recomputation:
  w4/6 no bar 114.4 / 97.6; with D1+D2+D3 83.2 / 66.4; w2 with D2+D3 70.8 / 54. These match the design's figures.
- **The floors are honest but not uniformly ~10px slack.** w2 with no bar and three footnotes is 85.2 today and D1
  does not change it, so the 84 floor has 1.2px slack. w2 with a bar and three footnotes has 6px (54 vs 48). The
  floors stay red-first where they should be: w4/6 no bar (94.4 < 96, 69.6 < 84) and every ctl case.
- **The HEL-1398 block exists as described** (`PanelContent.css:450-496`, width+height query). The `panel-card`
  container is `container-type: size` on `.panel-grid-card` (`PanelGrid.css:28-30`), so a height-only query cannot
  match the mobile stack. Comment lines over 100 chars are at L44, 46, 431, 438-440, 448, 449, 477 and 493 (awk),
  matching D6.
- **D4 code claims hold.** `ChartPanel.tsx:83-85` measures height but passes only the boolean `effectiveCompact`.
  `hideOverlap` is used only at `buildChartOption.ts:228` (time) and `heatmapHistogramOptions.ts:27`. The value axis
  is assembled at `buildChartOption.ts:234`, the same path histogram uses. `chartUnchangedPath.main.snapshot.json`
  and `unchangedPathCases.ts` exist. All six cited e2e specs exist under `e2e/`.
- **Spec delta mechanics.** The MODIFIED requirement name matches the base spec (`chart-panel-truncation-notice`
  L69) exactly. The ADDED names do not collide. `openspec validate footnoted-chart-card-canvas --strict` reports
  "has issues" (see CR 3).

### Verdict: REFUTE

### Change Requests

1. **D2 makes multi-control bars taller, which is a regression, and the design doesn't account for it.** Today a
   control is a column whose width is max(label, input). In the repro dropdown the label is 66px and the trigger is
   66px, so the control is 66px wide (`measurements.json` → `bar-light.1440-w2-ctl.barTree`). Inline, the same
   control is about label + gap + input (~136-140px). Two dropdowns at w=2 (174px content) fit on one stacked row
   today: 66 + 12 + 66 = 144, a 57px bar. Inline they wrap to two rows: 32 + 12 + 32 + 4, about 80px. Three controls
   at w=4 (408px) regress the same way. The design waves through only range controls wrapping, and states floors only
   for a one-control bar. Revise D2 so the inline form can never be taller than the current stacked bar, for example
   by scoping it to a bar with exactly one control (`.output-viewer-control-bar:has(> :only-child)`) or by another
   mechanism you justify. Add a spec scenario and an e2e assertion: a two-control bar at w=2 and w=4, h=4, has a bar
   height no greater than the unmodified-main measurement and nothing overlaps.
2. **D2's scope contradicts the spec.** D2 applies the inline bar to `.panel-grid-card:has(.panel-content--chart)`,
   which is every h=4 chart card. The MODIFIED requirement covers only charts "that show one or more footnotes" and
   says "a chart with no footnote ... keep their current layout". The scenario "other cards keep their chrome" says
   a chart panel with no annotation and no truncation note keeps "labels above inputs". Pick one:
   - narrow D2's selector to footnoted chart cards, e.g. `:has(.chart-panel__annotation, .chart-panel__truncation-note)`
     as HEL-1398 already does; or
   - widen the spec and scenario on purpose (it is an OWNER REVIEW call).

   Then make design.md, the spec, and task 2.2 agree. Also state whether a chart that is still in its loading or
   error state (`.panel-content--state`, no `--chart`) is meant to flip bar layout when the data arrives.
3. **`tasks.md` fails strict OpenSpec validation.** "Frontend" and "Tests" are `###` subsections under `## 1. Tests`,
   so `openspec validate --strict` warns on every task from 2.1 to 3.2. There is also an empty
   `## Standing Constraints` heading. Rename the groups to `## 2. Frontend` and `## 3. Tests`, and remove or fill the
   empty heading. Re-run `openspec validate footnoted-chart-card-canvas --strict` until it is clean.

### Non-blocking notes

- **D2 misstates the label markup.** D2 says the label "stays the input's `<label for>`". That is true only for the
  text control. The dropdown, which is the control in the repro, renders `<span aria-hidden>` plus a Select
  `ariaLabel`. Range controls use a span plus sr-only `<label>`s (`OutputViewerControlBar.tsx`). The change is
  CSS-only and should leave this markup untouched. Correct the wording so the executor doesn't "fix" the markup.
- **D3 at wide widths is optional, not required by the floors.** By the arithmetic, at w4/6 with D1+D2 and the
  annotation still visible, the canvas is about 66px (two footnotes) and about 50px (three footnotes). Both are above
  the 60 and 48 floors. Only w=2 needs the annotation to yield. Say this in the PR's OWNER REVIEW note: "hide only
  at narrow width" is a lower-impact alternative the owner may prefer. D2 and D3 are otherwise reasonable and
  reversible: the change is CSS-only, the text stays in the a11y tree via the canonical sr-only recipe, the data
  honesty notes stay visible, and fullscreen/detail are unaffected. Rejecting a minimum card height is the right
  call.
- **State the slack honestly.** "~10px slack" is not uniform: the w2 three-footnote floors have 1.2px (no bar) and
  6px (bar). Fix the Planner Note so a reviewer doesn't assume headroom that isn't there.
- **The e2e fixture's annotation is short.** It already fits on one line at w4/6 (`lines: 1` in the measurements),
  so the wide "each footnote renders on one line" scenario never exercises the clamp. Use an annotation long enough
  to wrap at w=4 on main.
- **D4's "guarded by the unchanged-path snapshot" holds only if the test supplies a height.** The snapshot cases
  carry no measured height. If the new parameter defaults to "no cap", the snapshot cannot exercise the >=180px path.
  Task 1.3's tall-height unit test should compare the option at, say, 180 and 400px against the no-height option.
- **The value-axis requirement covers every cartesian chart, but the scenario tests only "a bar chart".** The
  three-footnote cases at the 48px floor are histogram and time-axis line charts, so include at least one of them in
  the e2e overprint assertion.
