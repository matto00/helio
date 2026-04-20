## 1. Schema

- [x] 1.1 Add optional `chartType` enum (`line | bar | pie | scatter`) to `schemas/panel.json` appearance object

## 2. Frontend — Types and Models

- [x] 2.1 Add `chartType?: "line" | "bar" | "pie" | "scatter"` to `PanelAppearance` interface in `frontend/src/types/models.ts`

## 3. Frontend — ChartPanel

- [x] 3.1 Add `appearance` prop to `ChartPanel` component accepting `PanelAppearance`
- [x] 3.2 Implement `getChartOption(chartType, data?)` helper returning the correct `EChartsOption` per type (line, bar, pie, scatter), omitting axes for pie
- [x] 3.3 Update `ChartPanel` to call `getChartOption` with `appearance.chartType ?? "line"` and pass result to `ReactECharts`
- [x] 3.4 Update `PanelContent.tsx` to pass `appearance` prop to `ChartPanel`

## 4. Frontend — Panel Detail Modal

- [x] 4.1 Add `chartType` local state to `PanelDetailModal`, initialised from `panel.appearance.chartType ?? "line"`
- [x] 4.2 Include `chartType` in the `isDirty` check
- [x] 4.3 Render chart type selector (radio group or segmented control) in Appearance tab, visible only when `panel.type === "chart"`
- [x] 4.4 Wire selector to `chartType` state so selection updates preview immediately (pass draft `chartType` to a preview `ChartPanel` instance)
- [x] 4.5 Include `chartType` in the `updatePanelAppearance` dispatch payload on Save

## 5. Tests

- [x] 5.1 Unit test `getChartOption` — verify each of the four types returns the correct `series[0].type` and correct presence/absence of xAxis/yAxis
- [x] 5.2 Update `PanelDetailModal` tests — chart type selector visible for chart panels, hidden for non-chart panels
- [x] 5.3 Update `PanelDetailModal` tests — selecting a type marks form dirty; Save payload includes `chartType`
- [x] 5.4 Update `PanelContent` tests if needed to pass appearance prop through to ChartPanel
