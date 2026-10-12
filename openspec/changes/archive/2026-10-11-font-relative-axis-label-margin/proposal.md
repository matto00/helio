## Why

Heatmap and histogram category axes use ECharts' default `interval: auto` thinning, which hides labels that would
fit (main shows histogram bins 37-56 px apart, skipping every other one). HEL-1487 showed that showing every label
needs a gap tied to the font: no margin runs labels together, and a fixed 8 px margin re-thins the 375 px heatmap.

## What Changes

- Heatmap (both axes) and histogram (x) category axes show every label that fits: no interval thinning, overlap
  hiding instead, so a label is hidden only when it would collide with a neighbour.
- Shown x-axis labels keep a minimum gap proportional to the label font size (margin `fontSize * 0.6`, so about
  14.4 px at 12 px and 12 px at the 10 px compact font).
- Label collision boxes use an explicit font-relative line height so overlap hiding works without a CJK font.
- Lands the HEL-1487 handoff e2e spec (as `e2e/hel1512-category-axis-labels.spec.ts`), tightened to the ticket's
  acceptance criteria.

## Non-goals

- No change to other chart types' axes, to HEL-1305's time-axis `hideOverlap`, or to HEL-1306 reference marks.
- No rotation or truncation of labels; no change to bin label text or precision (HEL-1487).

## Capabilities

### New Capabilities

### Modified Capabilities

- `heatmap-histogram-charts`: adds a requirement that heatmap/histogram axes show every label that fits with a
  font-relative minimum gap.

## Impact

`frontend/src/features/panels/ui/buildChartOption.ts`, `heatmapHistogramOptions.ts`, their unit tests and the
unchanged-path snapshot entries for heatmap/histogram; a new e2e spec. No backend, schema or API change.
