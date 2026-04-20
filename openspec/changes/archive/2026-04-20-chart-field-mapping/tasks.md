## 1. Frontend

- [x] 1.1 Update `ChartPanel` to accept `rawRows`, `headers`, and `fieldMapping` props
- [x] 1.2 Implement column-index lookup transform in `ChartPanel` to build ECharts `xAxis.data` and `series[0].data` from mapped fields
- [x] 1.3 Add empty-state render path in `ChartPanel` when `fieldMapping.xAxis` or `fieldMapping.yAxis` is absent/empty
- [x] 1.4 Update `PanelContent` to accept and forward `fieldMapping` prop to `ChartPanel`
- [x] 1.5 Update `PanelCardBody` in `PanelGrid.tsx` to pass `panel.fieldMapping` through to `PanelContent`

## 2. Tests

- [x] 2.1 Write `ChartPanel` unit tests: renders with mapped xAxis+yAxis data, renders empty state when fields missing, renders placeholder when `fieldMapping` is null
- [x] 2.2 Update `PanelContent` tests to verify `fieldMapping` and `rawRows` are forwarded to `ChartPanel` for chart type panels
