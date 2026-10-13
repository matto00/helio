## Why

HEL-1398 kept a w=2, h=4 footnoted chart usable only when the card has no viewer-control bar. Re-measured on main
(a369a9cb8), every h=4 desktop chart card still starves its canvas once footnotes and a control bar stack up: 33px at
w=2 with a one-control bar, 25px at w=4/6, and 0.6px when a third footnote (HEL-1311 histogram / HEL-1508 time-axis)
joins. Y-axis labels overprint at these heights. Clamped card titles also have no tooltip.

## What Changes

- Short (h=4) chart cards at ANY width compact their footnotes to one tight line each (today only w=2 does).
- On a short footnoted chart card, a one-control viewer bar goes inline (label beside input); at w=2 with a control
  bar the annotation footnote yields (visually hidden, kept in the accessibility tree). **Product calls, OWNER REVIEW.**
- A chart's value-axis labels never overprint, however short the canvas.
- Desktop panel titles carry their full text as a native `title` tooltip.
- PanelContent.css comment lines over 100 characters are rewrapped. The ticket's footer-overrun claim did not
  reproduce (0px), so the footer is not changed.

## Capabilities

### New Capabilities

### Modified Capabilities
- `chart-panel-truncation-notice`: "Footnotes never collapse a narrow chart" widens to every short chart card, with
  and without a viewer-control bar, with canvas floors.
- `echarts-chart-panel`: value-axis labels never overlap, however short the canvas.
- `panel-container-queries`: a desktop panel card title exposes its full text as a tooltip when clamped.

## Impact

Frontend only: `PanelContent.css`, `OutputViewerControlBar.css`, the chart option builder, `PanelCardHeader.tsx`,
plus unit and e2e tests. No API, schema or backend change.

## Non-goals

- The mobile stack card (HEL-1438). Blank categories (HEL-1424). Reference-line follow-ups (HEL-1500).
- A minimum card height for charts with controls (rejected: it changes stored layouts of existing dashboards).
- Fullscreen and detail-modal surfaces, which are not short cards.
