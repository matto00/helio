## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD a369a9cb84a0966adb3c8c9d515838ebfbf6bb15. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/footnoted-chart-card-canvas/HEL-1444`.
- **Strict validation:** `openspec validate footnoted-chart-card-canvas --strict` prints "Change 'footnoted-chart-card-canvas' is valid".
- **The ticket's source.** The Linear HEL-1444 description matches ticket.md items 1-4. Linear has no AC section,
  so the ACs in ticket.md were derived by the orchestrator. They cover every item in the Linear description.
- **The defect is real.** In `evidence/repro/bar-dark-1440-w2-ctl.png`, the "150" and "0" value-axis labels
  overprint on a canvas of roughly 30px.
- **Round-2 CR1 (range controls) is resolved consistently in all three artifacts.**
  - Spec: one-row and floors apply only to a lone text or dropdown control. A lone numeric-range or date-range
    control, and any bar with two or more controls, stays stacked and is "no taller than today".
  - design.md D2: the selector excludes `.output-viewer-control-bar__control--range`. Both range kinds carry
    that class (`OutputViewerControlBar.tsx`, NumericRangeControl and DateRangeControl).
  - Task 1.1 and the scenario "a multi-control bar is never taller than today" both add the lone numeric-range
    bar at w=2 and w=4.
  - `:only-child` holds: the bar renders one child per non-orphaned control and returns null when there are none.
- **Round-2 CR2 is answered.** design.md has a "Load-time shift (accepted)" paragraph. It states the about 21px
  stacked-to-inline flip when data lands, and why it is accepted.
- **Round-2 non-blocking notes were taken.**
  - D2 now overrides the text input's fixed `width: 160px` (`OutputViewerControlBar.css`). `TextField` puts
    `className` on the `<input>` itself (`shared/ui/TextField.tsx:18-21`), so the override reaches the input.
  - The value-axis scenario now checks that the axis minimum and maximum are labelled when two labels fit.
- **Height-only query isolation, recomputed from grid config.**
  - Grid config is `rowHeight` 52 and margin 18 (`panelGridConfig.ts`).
  - h=4 gives a 262px card. h=5 gives 332px.
  - Card padding is `clamp(12px, 2vw, 20px)` plus a 1px border (`PanelGrid.css:28-41`). So the h=5 content box
    is at least 290px, which is over 260. `@container panel-card (max-height: 260px)` therefore matches only h=4.
  - Mobile stack `--output` items are `container-type: inline-size` (`MobilePanelStack.css:78-82`), so a height
    query cannot match them.
  - Fullscreen and detail views do not sit inside a `panel-card` container. The only `container-name` is
    PanelGrid.css:30.
- **D1 and D3 mechanics hold.**
  - The third footnote (skipped or time) carries `chart-panel__truncation-note` (`ChartRenderer.tsx`), so D1's
    selector and HEL-1398's `:has()` scope cover it.
  - Every footnote already has `title` = full text.
  - The base footnote rule is at `PanelContent.css:205-221`. The HEL-1398 width+height block is at L450-496,
    as cited.
- **D5:** the desktop `<h3 className="panel-grid-card__title">` has no `title` (`PanelCardHeader.tsx`, non-editing
  branch). The edit-mode `TextField` branch is untouched, so the change is a one-attribute addition.
- **D4:** the value axis is assembled at `buildChartOption.ts:233-241`. No `splitNumber` exists, and
  `hideOverlap` is used for the time x axis only. The heatmap's y axis is a category axis (`mergeHeatmapYAxis`).
  The "value axis of cartesian charts" wording therefore excludes it, which is consistent.
- **D6:** awk finds over-100-character lines at 44, 46, 431, 438-440, 448, 449, 477 and 493. These match D6.
- **Floors arithmetic:** I re-derived the round-2 figures from the CSS and the repro table and got the same
  numbers: w2 bar 70.8/54, w4/6 bar 66.4/49.6, w4/6 no bar 114.4/97.6, w2 no bar 102/85.2. Each is at or above
  its floor (96/84/60/48). The thin margins (1.2 and 1.6) are disclosed, with an escalate-not-loosen rule.
- **Scope:** D2 and D3 are reversible, CSS-only product calls. They are flagged OWNER REVIEW and the PR is
  parked, per the driver's overnight rules. A minimum card height is rejected with a sound reason (it rewrites
  stored layouts). Nothing from HEL-1424, HEL-1500 or HEL-1438 is pulled in.

### Verdict: CONFIRM

### Non-blocking notes

1. **`e2e/hel1398-chart-narrow-footnotes.spec.ts:345` will go red under D3, by design.** The line is
   `expect(annotation!.height, "the annotation stays visible").toBeGreaterThan(8)`. It runs for both
   `controls=false` and `controls=true`. Under D3 the w=2 annotation with a control bar becomes sr-only, about
   1px tall.
   - design.md says to update hel1398 "only where this change intentionally improves them (never loosen)". An
     evaluator could read this edit as a loosening.
   - The executor should replace the assertion for `controls=true` only, with "hidden but present in the
     accessibility tree", and cite D3 in the commit. It must not delete the assertion.
2. **Long control labels at w=2.** `.output-viewer-control-bar__label` has no `white-space: nowrap`. In the
   inline row a long label can shrink and wrap to two or more lines. Two lines of micro text still fit in the
   32px row, but three would not.
   - The e2e uses "Region". Consider asserting the bar height for the inline form, or giving the label
     `flex-shrink: 0` plus ellipsis.
3. **Add an explicit test for the value-axis min/max promise.** The design's Testing section asserts "no
   overlap" at the shortest canvas. The spec also promises that the axis min and max are both labelled when two
   labels fit.
   - Assert this at a 60px or taller canvas.
   - `hideOverlap` alone may drop the max label, so a probe should check that it does not.
4. The PR's OWNER REVIEW section should carry the before/after card screenshots. The Linear ticket says "escalate
   with screenshots" for the item-1 product call.
