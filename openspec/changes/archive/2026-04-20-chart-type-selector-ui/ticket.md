# HEL-66: Chart panel: chart type selector UI

## Context

Once ECharts is integrated (HEL-65), users need a way to choose which chart type a panel renders. This ticket adds the chart type selector to the panel detail modal.

## What changes

* Add a chart type selector in the panel detail modal (Appearance or Chart tab)
* Supported types: line, bar, pie, scatter (minimum); area and stacked bar are stretch goals
* Selecting a type updates the chart preview immediately
* Selection is persisted to the panel's appearance config in the backend
* Each option has a clear label and an icon or mini-preview

## Acceptance criteria

- [ ] The panel detail modal shows a chart type selector for chart panels
- [ ] Selecting a chart type changes the rendered chart type in real time (preview)
- [ ] The selected chart type persists across page reloads
- [ ] At least 4 chart types are available: line, bar, pie, scatter
- [ ] The selector is clearly labeled and visually distinct from non-chart appearance controls
