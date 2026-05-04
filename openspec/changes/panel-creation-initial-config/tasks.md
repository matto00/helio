## 1. Frontend — Modal State & Types

- [x] 1.1 Define a TypeConfig union type (MetricConfig, ChartConfig, ImageConfig, DividerConfig) in the panel types module
- [x] 1.2 Add typeConfig local state to PanelCreationModal alongside existing title/selectedType state
- [x] 1.3 Extend the "is dirty" check in PanelCreationModal to include non-empty typeConfig values
- [x] 1.4 Reset typeConfig state when the modal closes (success or cancel)

## 2. Frontend — Type-Specific Config Fields UI

- [x] 2.1 Add a MetricConfigFields component (value label + unit text inputs) rendered in step 3 for metric type
- [x] 2.2 Add a ChartTypeField component (line/bar/pie selector) rendered in step 3 for chart type
- [x] 2.3 Add an ImageConfigField component (image URL text input) rendered in step 3 for image type
- [x] 2.4 Add a DividerConfigField component (horizontal/vertical selector) rendered in step 3 for divider type
- [x] 2.5 Wire all per-type components into PanelCreationModal step 3 behind a selectedType switch
- [x] 2.6 Pass typeConfig values into PanelCreationPreview so the preview reflects entered config live

## 3. Frontend — Creation Payload

- [x] 3.1 Update the createPanel thunk call in PanelCreationModal to include typeConfig fields in the payload
- [x] 3.2 Update the createPanel thunk / panelsSlice to accept and forward optional type-specific config fields in the API request body

## 4. Tests

- [x] 4.1 Update PanelCreationModal.test.tsx: verify metric config fields appear in step 3 for metric type
- [x] 4.2 Update PanelCreationModal.test.tsx: verify chart type selector appears in step 3 for chart type
- [x] 4.3 Update PanelCreationModal.test.tsx: verify image URL field appears in step 3 for image type
- [x] 4.4 Update PanelCreationModal.test.tsx: verify orientation selector appears in step 3 for divider type
- [x] 4.5 Update PanelCreationModal.test.tsx: verify Text/Table/Markdown show no extra fields in step 3
- [x] 4.6 Update PanelCreationModal.test.tsx: verify typeConfig values are included in the creation payload on submit
- [x] 4.7 Update PanelCreationModal.test.tsx: verify entering a config value sets dirty state (discard prompt shown)
- [x] 4.8 Update PanelCreationModal.test.tsx: verify typeConfig state resets after modal close
