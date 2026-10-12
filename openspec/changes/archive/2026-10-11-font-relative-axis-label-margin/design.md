## Context

See proposal.md. On main (2e02b7951) `buildChartOption.ts` builds the x/y `axisLabel` with only `color` (plus
`hideOverlap` for HEL-1305 time axes) and the compact path overrides `fontSize` to `COMPACT_AXIS_LABEL_FONT_SIZE`
(10). Heatmap/histogram category axes therefore get ECharts' `interval: auto`. HEL-1487's branch head 8fb843d1b
(reachable in this repo) carries a complete show-all implementation (`categoryLabelShowAll`,
`categoryXLabelShowAll`, `categoryLabelLineHeight`, `showsEveryCategoryLabel`, `fontSizeOf`) whose only defect was
the fixed `textMargin [0, 8]` and the compact path carrying the normal-mode margin. ECharts is 6.1.0
(`frontend/package-lock.json`).

## Goals / Non-Goals

Goals: every label that fits is shown on heatmap x/y and histogram x; shown x labels keep a font-relative gap.
Non-goals: see proposal.md. The heatmap y (row) axis gets show-all + lineHeight but no extra margin (rows stack).

## Decisions

1. **Restore 8fb843d1b's helpers (correcting its margin comment to the real mechanism: ECharts widens each label box by
   the margin on both sides, so the hide threshold is 2 x margin) into `heatmapHistogramOptions.ts`, with a font-relative margin.**
   `axisLabel` gets `interval: 0`, `hideOverlap: true`, `lineHeight: ceil(fontSize * 1.2)`; x additionally gets
   `textMargin: [0, fontSize * CATEGORY_X_LABEL_MARGIN_PER_PX_FONT]` with the factor `0.6`. ECharts hides a label
   whose free gap is under about 2 x margin, so 0.6 gives a hide threshold of ~1.2 em: 14.4 px at 12 px, 12 px at 10 px,
   matching the AC's 14/12 px floors. Alternative: fixed margin - rejected, measured 4/7 days at 375 (HEL-1487
   evaluation-4). Alternative: a custom `interval` callback measuring text - rejected, duplicates ECharts' layout
   and cannot see real rendered widths.
2. **The compact path recomputes the margin and lineHeight for `COMPACT_AXIS_LABEL_FONT_SIZE`**, overriding the
   normal-mode values it inherits through its `axisLabel` spread (the evaluation-4 CR1 defect).
3. **The font size is read from the axis' resolved `axisLabel.fontSize`, defaulting to 12** (ECharts' default), via
   `fontSizeOf`, so a future appearance font size scales the gap too.
4. **Time axes are untouched**: the show-all spread is gated on `showsEveryCategoryLabel(chartType)` (heatmap,
   histogram), and a heatmap/histogram never has `timeInstants`. Other chart types keep `interval: auto`.
5. **e2e**: land the handoff spec as `e2e/hel1512-category-axis-labels.spec.ts` (naming/prefix/log tags HEL-1512).
   Add a `heat8X` read (the handoff reads only heat8's y axis) and include it in the gap loop. Assert: `heatX.shown`
   and `heat8X.shown` both equal `DAYS` at 375 AND 1440; `hist10` length 10 at 1440; overlaps none; hist12 single
   precision. The gap floor is chosen by the label font the card actually renders (read from the label element's
   font size), not the viewport: >= 14 px for 12 px labels, >= 12 px for 10 px compact labels (epsilon 0.05 px, see
   Risks). At 1440 heat8 is h:3 and may render compact; every card at 375 is compact (`MobilePanelStack`). The
   executor records which cards render compact at 1440. heat8X at 375 is the threshold-edge chart that catches a
   compact path inheriting the 7.2 margin. It must be shown red on main (2e02b7951, thinning) and green after;
   unit-test red must be an assertion failure, not a missing-import error.
6. **hist20 at 1440 (w:6)**: measured 13.95 px at margin 7; at 7.2 the hide threshold is ~14.4 px, so the expected
   outcome is fewer shown labels with every gap >= 14. The executor records the measured shown count and min gap at
   7.2. If the gap floor can only be met by a different factor that breaks 7/7 at 375 or 10/10 at 1440, STOP and
   escalate (owner product call) with the measurements - do not tune the factor per chart silently.

## Risks / Trade-offs

- [heat8 (6-row, "heat6" in HEL-1487 evaluation-4) x at 375 measured exactly 12.0 px at margin 6 - a threshold edge]
  -> the e2e asserts the floors (14 px for 12 px labels, 12 px for 10 px compact labels) with at most a 0.05 px
  epsilon (the only measured ECharts-box vs real-text-width difference: 13.95 vs 14.0 at margin 7), stated in a test
  comment. No larger tolerance on either floor. Run the spec x5; if not stable, that is the C5 escalation.
- [Snapshot churn in `chartUnchangedPath.main.snapshot.json`] -> only heatmap/histogram entries may change; the
  executor diffs the snapshot and justifies every changed entry.
- [ECharts private-view probe in e2e (`_componentsViews`)] -> already noted in the spec header; pinned to 6.1.0.
- [No CJK font on CI either] -> the explicit lineHeight removes the dependence.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or hook-invoked script is touched.

## Planner Notes

- Self-approved: restoring 8fb843d1b's helper names; e2e spec file name hel1512-*. The driver's "run hel1487 e2e"
  instruction maps to this landed spec (no hel1487 spec exists on main).
- Evaluator and final skeptic MUST themselves run e2e hel1311, hel1305, hel1306 and hel1512 specs.
