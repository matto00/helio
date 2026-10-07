# HEL-1351: Dashboard 'vs' overlay coverage: aggregated charts, >200 rows, compact legend, chart-type source mismatch

## Description

origin_kind: followup
origin_ticket: HEL-1277

HEL-1277 left these gaps in where the chart "vs" overlay appears:

1. **Aggregated chart Outputs get no overlay.** The editor preview groups by `config.aggregation`, but dashboard chart panels plot raw rows. This mismatch predates HEL-1277.
2. **Charts with more than 200 rows never show the overlay.** This is by design today. One option is to render chart panels from the stored summary `series` instead.
3. **Compact default-size panels hide the legend,** so the overlay's label is only visible in the tooltip.
4. **Chart type can disagree between views.** The History view takes chart type from the Output config; dashboard panels take it from panel appearance, which defaults to line.

## Acceptance Criteria

- Decide and fix each item, or explicitly defer it.
- Item 2 is a design decision: escalate it with a recommendation.
- Check against the running app in both themes.
