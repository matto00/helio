## Why

The `panel-content-sizing` spec (HEL-158) defines chart panels as filling the full available content area
via `height: "100%", width: "100%"` and `autoResize: true`. While `ChartPanel.tsx` already sets these
props, it is returned bare from `PanelContent` without the `panel-content` flex wrapper that supplies
`flex: 1` and `min-height: 0`. Without that wrapper, the chart cannot reliably fill the card body in
all flex layouts and may overflow or collapse at small heights.

## What Changes

- Wrap the chart panel render path in `PanelContent` with a `panel-content panel-content--chart`
  container that carries `flex: 1`, `min-height: 0`, `width: 100%`, and `height: 100%` so ECharts
  has a well-defined fill target.
- Add `panel-content--chart` CSS rule to `PanelContent.css` — removes default padding (chart fills to
  card edge) and ensures `height: 100%` propagates to the `ReactECharts` div.
- No API changes. No backend changes. No new external dependencies.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `echarts-chart-panel`: wrapper element added so chart fill requirement is satisfied via explicit CSS
  rather than relying solely on implicit flex behaviour; `autoResize` still triggers ECharts reflow.
- `panel-content-sizing`: chart panel sizing requirement (`height: 100%, width: 100%`) now achieved
  through the new `panel-content--chart` CSS rule in addition to the ReactECharts `style` prop.

## Impact

- `frontend/src/components/PanelContent.tsx` — chart case gains a wrapping `<div>`.
- `frontend/src/components/PanelContent.css` — new `.panel-content--chart` rule.
- No backend, schema, or API changes.

## Non-goals

- Visual appearance customisation of chart axes or labels.
- Responsive ECharts font-size scaling via container queries (deferred to a follow-on ticket).
- Changes to any panel type other than `chart`.
