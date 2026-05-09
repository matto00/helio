## 1. Backend

- [x] 1.1 Add `dataTypeId: Option[String]` field to `CreatePanelRequest` case class in `JsonProtocols.scala`; update `jsonFormat4` to `jsonFormat5`
- [x] 1.2 In `PanelRoutes` POST handler, set `typeId = request.dataTypeId.map(DataTypeId(_))` when constructing the `Panel` domain object

## 2. Frontend — Redux

- [x] 2.1 Add `dataTypeId?: string` to the `createPanel` thunk argument type in `panelsSlice.ts`
- [x] 2.2 Pass `dataTypeId` to the `createPanelRequest` service call when present

## 3. Frontend — Modal

- [x] 3.1 Add `"datatype-select"` to the `Step` union type in `PanelCreationModal.tsx`
- [x] 3.2 Define `DATA_BOUND_TYPES` constant (`["metric", "chart", "text", "table"]`) and helper `isDataBound(type)`
- [x] 3.3 Add `selectedDataTypeId: string | null` state; include it in dirty-state check
- [x] 3.4 In `handleTemplateSelect`, advance to `"datatype-select"` for data-bound types, else `"name-entry"`
- [x] 3.5 Add `handleBackFromDataType` that sets step to `"template-select"` and clears `selectedDataTypeId`
- [x] 3.6 Render the DataType picker step: dispatch `fetchPipelines` and `fetchDataTypes` on mount if not loaded; compute registry set from `pipelines.items`; filter `dataTypes.items`; show empty state with pipeline link when no registry types exist
- [x] 3.7 Render DataType list items as clickable cards with highlight on selection; disable Next button until a DataType is selected
- [x] 3.8 Add Next button that calls `setStep("name-entry")` when a DataType is selected
- [x] 3.9 In `handleCreate`, pass `dataTypeId: selectedDataTypeId ?? undefined` to the thunk; disable Create button if `isDataBound(selectedType)` and `selectedDataTypeId` is null
- [x] 3.10 Reset `selectedDataTypeId` in modal state on close
- [x] 3.11 Update `getStepTitle()` to return "Choose a data type" for the `"datatype-select"` step

## 4. Tests

- [x] 4.1 Unit test `panelsSlice.ts`: `createPanel` thunk includes `dataTypeId` in request when provided
- [x] 4.2 Component test `PanelCreationModal.test.tsx`: DataType step renders after template selection for metric type
- [x] 4.3 Component test: DataType step is skipped for markdown type (goes directly to name-entry)
- [x] 4.4 Component test: Next button disabled when no DataType selected; enabled after selection
- [x] 4.5 Component test: Create panel call includes `dataTypeId` from the DataType step
- [x] 4.6 Component test: empty state shown when no registry DataTypes available
