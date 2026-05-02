## Why

The metric panel content (value, label) remains at static font sizes across all panel heights. HEL-159
established CSS container queries on `.panel-grid-card` and added a first-pass scaling rule for the metric
value only; the label and trend indicator element are not yet responsive. Users resizing metric panels to
spacious heights see a disproportionately small label, and compact heights still render an oversized label
relative to the scaled-down value.

## What Changes

- `panel-content__metric-label` gains container-query-driven font-size rules at compact (< 180px) and
  spacious (>= 280px) heights so it stays proportional to the value
- A `panel-content__metric-trend` element is introduced: a small directional indicator (up/down/flat arrow)
  with a numeric delta, rendered below the label when a `trend` field is present in `MappedPanelData`
- The trend indicator font-size and icon size respond to the same compact/spacious container breakpoints
- `MappedPanelData` remains `Record<string, string>`; `trend` is a conventional field name rendered
  when present (same pattern as `value` and `label`)

## Capabilities

### New Capabilities
- `metric-panel-trend-indicator`: Renders a trend arrow + delta below the metric label when the `trend`
  field is populated in bound data. Scales proportionally with the panel container.

### Modified Capabilities
- `panel-container-queries`: Add label and trend-indicator container-query scaling rules to the existing
  compact/spacious breakpoints established in HEL-159.
- `panel-type-rendering`: Metric panel now renders a third line (trend indicator) when `data.trend` is set.

## Non-goals

- Introducing a new backend field or schema change for trend data — trend is a conventional string field
  in the existing `MappedPanelData` map
- Changing any panel type other than metric
- Implementing trend data computation or aggregation logic

## Impact

- `frontend/src/components/PanelContent.tsx` — `MetricContent` renders trend indicator
- `frontend/src/components/PanelContent.css` — add label + trend container query rules
- `openspec/specs/panel-container-queries/` — delta spec for label + trend scaling rules
- `openspec/specs/panel-type-rendering/` — delta spec for trend indicator render requirement
