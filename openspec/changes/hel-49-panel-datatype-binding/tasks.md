## 1. Models — extend Panel type and add DataType

- [x] 1.1 Add `DataTypeField`, `DataType` interfaces to `frontend/src/types/models.ts`
- [x] 1.2 Add `typeId`, `fieldMapping`, `refreshInterval` to `Panel` interface in `models.ts`

## 2. DataType service and Redux slice

- [x] 2.1 Create `frontend/src/services/dataTypeService.ts` with `fetchDataTypes(): Promise<DataType[]>` calling `GET /api/datatypes`
- [x] 2.2 Create `frontend/src/features/dataTypes/dataTypesSlice.ts` with `fetchDataTypes` thunk and `idle/loading/succeeded/failed` status
- [x] 2.3 Add `dataTypes: dataTypesReducer` to `frontend/src/store/store.ts`

## 3. Panel binding service and thunk

- [x] 3.1 Add `updatePanelBinding(panelId, typeId, fieldMapping, refreshInterval)` to `frontend/src/services/panelService.ts` — PATCH `/api/panels/:id`
- [x] 3.2 Add `updatePanelBinding` thunk to `frontend/src/features/panels/panelsSlice.ts`; update panel in store on success

## 4. Field slot definitions

- [x] 4.1 Create `frontend/src/features/panels/panelSlots.ts` exporting slot config per `PanelType`: metric (value, label, unit), chart (xAxis, yAxis, series), table (columns), text (content)

## 5. Data tab UI

- [x] 5.1 Replace Data tab placeholder in `PanelDetailModal.tsx` with the binding form: searchable DataType dropdown (filtered `<input>` + `<ul>`), "Add a new source →" link, field mapping section (conditional on DataType selected), refresh interval `<select>`
- [x] 5.2 Dispatch `fetchDataTypes` when Data tab becomes active (only if status is `idle`)
- [x] 5.3 Initialise Data tab state from `panel.typeId`, `panel.fieldMapping`, `panel.refreshInterval`
- [x] 5.4 Add `dataDirty` flag tracking changes to binding state; merge with existing `isDirty` for discard warning
- [x] 5.5 Add Save button to footer when Data tab is active; dispatch `updatePanelBinding` on submit; show `InlineError` on failure
- [x] 5.6 Add CSS for new Data tab elements to `PanelDetailModal.css`

## 6. Tests

- [x] 6.1 `dataTypesSlice.test.ts`: fetchDataTypes fulfilled populates items; rejected sets error
- [x] 6.2 `panelsSlice.test.ts`: updatePanelBinding fulfilled updates the matching panel in state
- [x] 6.3 `PanelDetailModal.test.tsx`: Data tab shows type selector; selecting a type shows field slots; saving dispatches updatePanelBinding; unsaved data changes trigger discard warning

## 7. Verification

- [x] 7.1 Run `npm run lint` in `frontend/` — zero warnings
- [x] 7.2 Run `npm run format:check` in `frontend/` — no issues
- [x] 7.3 Run `npm test` in `frontend/` — all tests pass
- [x] 7.4 Run `npm run build` in `frontend/` — clean build
