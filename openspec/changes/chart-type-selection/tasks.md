## 1. Backend

- [x] 1.1 Add `chartType: Option[String]` field to `ChartAppearance` case class in `model.scala`
- [x] 1.2 Update `chartAppearanceFormat` in `JsonProtocols.scala` from `jsonFormat4` to `jsonFormat5`
- [x] 1.3 Add `chartType` property (enum: bar, line, pie, scatter) to the `chart` object in `panel-appearance.schema.json`

## 2. Frontend — Model

- [x] 2.1 Add `chartType?: "bar" | "line" | "pie" | "scatter"` to `ChartAppearance` interface in `models.ts`

## 3. Frontend — Chart rendering

- [x] 3.1 Extend `appearanceToEChartsOption` in `chartAppearance.ts` to return `chartType` in the result so `ChartPanel` can consume it
- [x] 3.2 Update `buildDataOption` in `ChartPanel.tsx` to accept a `chartType` param and branch: scatter uses `[[x,y]]` coordinate pairs; pie reshapes to `[{name, value}]`; bar/line use existing logic with the correct series type
- [x] 3.3 Update `ChartPanel` option merge to suppress `xAxis`/`yAxis` when `chartType === "pie"`; pass `chartType` into `buildDataOption`
- [x] 3.4 Update `defaultOption` fallback series type to `"line"` (currently no series type is set there; ensure line is the no-chartType default)

## 4. Frontend — Modal UI

- [x] 4.1 Add `chartType: "line"` default to `DEFAULT_CHART_APPEARANCE` in `PanelDetailModal.tsx`
- [x] 4.2 Initialise `chartAppearance.chartType` from `panel.appearance.chart?.chartType ?? "line"` in `initialChart`
- [x] 4.3 Add chart type radio group (`<fieldset>`) to the chart section in the Appearance tab with options: bar, line, pie, scatter; bind to `chartAppearance.chartType`

## 5. Tests

- [x] 5.1 Update `chartAppearance.test.ts` to cover `chartType` propagation in `appearanceToEChartsOption`
- [x] 5.2 Update `ChartPanel.test.tsx` to assert pie and scatter series shapes; assert axes are absent for pie
- [x] 5.3 Update `PanelDetailModal.test.tsx` to assert the chart type radio group is present for chart panels and absent for non-chart panels; assert selecting a type updates the preview
