# HEL-1512: Show every heatmap/histogram axis label that fits, with a font-relative label margin (split from HEL-1487)

## Description

Split out of HEL-1487 by owner ruling: HEL-1487 shipped items 2-5 plus histogram bin precision and kept main's
axis-label thinning.

**Goal:** heatmap and histogram axes show every category or bin label that fits, without labels running together.

**What HEL-1487 learned** (evidence in `.concertino/runs/HEL-1487/evidence/`, including
`openspec/changes/archive/2026-10-11-chart-axis-label-polish/evaluation-4.md` and skeptic-final-2.md):

- Showing every label with no margin left histogram bin labels only 6-7 px apart, so they read as one run
  ("133 to 148 194 to 209"). Main shows fewer labels, 37-56 px apart.
- A fixed 8 px `textMargin`: ECharts hides a label whose gap is under about 2 x the margin, so this re-thinned the
  375 px heatmap day axis to 4 of 7, where main shows 7 of 7.
- Measured working value: a font-relative margin of `fontSize * 0.6` (7.2 at 12 px, 6 at the 10 px mobile font) gave
  7 of 7 days at 375 and 10 of 10 bins at 1440. The 20-bin histogram at 1440 measured a 13.95 px gap at margin 7, so
  re-check it at 7.2.
- Font metrics: the machine has no CJK font, so ECharts under-measured label height; HEL-1487's c90df4304 added an
  explicit `lineHeight` (reverted with the rest of the show-all change in #964).
- The HEL-1487 e2e spec is handed off at `.concertino/runs/HEL-1487/evidence/hel1512-handoff/hel1487-category-axis-labels.spec.ts`
  (not on main).

## Acceptance Criteria

- e2e: 7 of 7 days at 375 on both heatmaps.
- e2e: 10 of 10 bins at 1440.
- e2e: a font-relative minimum gap between labels (>=14 px at 1440, >=12 px at 375).
- No regression to HEL-1305's time-axis labels or HEL-1306's reference marks.
- Checked in light and dark, at 1440 and 375.
- If the 20-bin histogram at 1440 cannot meet the gap at margin 7.2, decide with evidence and say so (possibly an
  owner product call, escalated).
