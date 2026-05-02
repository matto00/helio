## Context

`PanelContent.tsx` renders panel type content via a switch statement. All non-chart types return a
`<div className="panel-content panel-content--<type>">` wrapper that provides `flex: 1; min-height: 0;`
for flex-fill behaviour. The chart case currently returns `<ChartPanel .../>` bare — no wrapper div.

`ChartPanel.tsx` passes `style={{ height: "100%", width: "100%" }}` to `ReactECharts`, which requires
a measurable ancestor with an explicit height. In the current layout, the panel card (`article.panel-grid-card`)
uses `display: flex; flex-direction: column; justify-content: space-between;` with a top bar and footer.
`PanelCardBody` renders as the middle flex child but has no explicit `flex: 1` or `min-height: 0` since
those come from `.panel-content`. Without a `.panel-content` wrapper, the chart's `100%` height resolves
against an indeterminate ancestor, causing ECharts to fall back to its default 300px height.

## Goals / Non-Goals

**Goals:**
- Chart fills available card body height and width via a well-defined flex-fill wrapper.
- No regressions on resize: ECharts `autoResize` continues to fire correctly.

**Non-Goals:**
- Container-query breakpoints for ECharts font sizes (deferred).
- Changes to metric, text, table, or state-overlay sizing paths.

## Decisions

**D1 — Add `.panel-content--chart` wrapper in `PanelContent.tsx`**
Wrap the `<ChartPanel>` return with `<div className="panel-content panel-content--chart">`. This
mirrors the pattern used by every other panel type and ensures `.panel-content`'s `flex: 1; min-height: 0`
applies to the chart slot.

Alternative considered: add `flex: 1; min-height: 0` to `PanelCardBody` directly. Rejected — that
component is not aware of its children and adding these properties would affect the outer flex container
rather than the inner content slot.

**D2 — Override default `.panel-content` padding for chart**
The base `.panel-content` rule adds `padding: 12px 16px`. Chart content should fill edge-to-edge so the
ECharts canvas occupies maximum area. Add `.panel-content--chart { padding: 0; }` to `PanelContent.css`.

**D3 — No changes to `ChartPanel.tsx`**
The existing `style={{ height: "100%", width: "100%" }}` and `autoResize={true}` are correct; the bug
is solely that the fill target was missing.

## Risks / Trade-offs

[Risk] ECharts may not detect the wrapper resize if the wrapper uses `height: 100%` without the
parent having a fixed height.
→ Mitigation: `.panel-content` already carries `flex: 1; min-height: 0` which, combined with the
  panel card's fixed pixel height from the grid layout, gives ECharts a concrete pixel value.

[Risk] Removing padding from `.panel-content--chart` may create visual inconsistency if the card
border-radius clips the chart canvas edge.
→ Mitigation: The panel card already has `overflow: hidden` which clips the ECharts canvas cleanly
  to the card boundary. Acceptable trade-off for maximum chart area.

## Planner Notes

- This is a two-file change (one `.tsx`, one `.css`) with no schema, API, or backend impact.
- Self-approved: contained UI bug fix, no cross-cutting concerns, no new dependencies.
- No migration plan required; change is purely additive to CSS and a React wrapper.
