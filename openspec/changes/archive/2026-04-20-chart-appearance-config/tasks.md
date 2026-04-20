## 1. Backend

- [x] 1.1 Add `ChartAppearance` case class (seriesColors, legend, tooltip, axisLabels) to `model.scala`
- [x] 1.2 Add `chart: Option[ChartAppearance]` field to `PanelAppearance` case class with a default of `None`
- [x] 1.3 Add Spray JSON formatters for `ChartAppearance` sub-types in `JsonProtocols.scala`
- [x] 1.4 Update `PanelAppearance` JSON formatter to handle optional `chart` field
- [x] 1.5 Update `RequestValidation` / `PanelAppearancePayload` to accept and pass through the optional `chart` field
- [x] 1.6 Update repository `panelRowToDomain` and appearance update path to round-trip `chart` through the JSON blob

## 2. Schema

- [x] 2.1 Add optional `chart` property to `schemas/panel-appearance.schema.json` with nested legend, tooltip, axisLabels, and seriesColors definitions

## 3. Frontend — Types and State

- [x] 3.1 Add `ChartAppearance` interface (seriesColors, legend, tooltip, axisLabels) to `frontend/src/types/models.ts`
- [x] 3.2 Extend `PanelAppearance` interface with `chart?: ChartAppearance`
- [x] 3.3 Update `updatePanelAppearance` thunk payload type and service call to include the `chart` field

## 4. Frontend — ChartPanel

- [x] 4.1 Add optional `appearance` prop to `ChartPanel` component
- [x] 4.2 Build an `appearanceToEChartsOption` utility that maps `ChartAppearance` fields to ECharts option fields (color, legend, tooltip, xAxis/yAxis)
- [x] 4.3 Merge appearance-derived options with the base `defaultOption` in `ChartPanel`
- [x] 4.4 Pass `panel.appearance` from `PanelContent.tsx` to `ChartPanel` so grid renders use saved settings

## 5. Frontend — PanelDetailModal

- [x] 5.1 Initialize draft chart appearance state from `panel.appearance.chart` (with defaults) in `PanelDetailModal`
- [x] 5.2 Add a "Chart" section to the Appearance tab form, rendered only when `panel.type === "chart"`
- [x] 5.3 Implement series color swatches (up to 8 `<input type="color">` inputs) bound to draft state
- [x] 5.4 Implement legend show/hide toggle and position selector
- [x] 5.5 Implement tooltip enabled/disabled toggle
- [x] 5.6 Implement X-axis label show/hide toggle with optional custom label text input
- [x] 5.7 Implement Y-axis label show/hide toggle with optional custom label text input
- [x] 5.8 Pass draft `appearance` (including chart sub-object) to `ChartPanel` inside the modal for live preview
- [x] 5.9 Include `chart` sub-object in the `updatePanelAppearance` dispatch on save
- [x] 5.10 Extend `isDirty` to account for changes to chart appearance fields

## 6. Tests

- [x] 6.1 Unit test `appearanceToEChartsOption` utility — verify each field maps correctly (seriesColors, legend, tooltip, axisLabels)
- [x] 6.2 Update `PanelDetailModal.test.tsx` — verify Chart section renders for chart panels and is absent for non-chart panels
- [x] 6.3 Update `PanelContent.test.tsx` or `ChartPanel` tests — verify appearance prop is forwarded correctly
