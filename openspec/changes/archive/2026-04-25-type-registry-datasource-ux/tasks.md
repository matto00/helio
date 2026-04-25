## 1. Backend

- [x] 1.1 Add `UpdateDataSourceRequest` case class and JSON formatter to `JsonProtocols.scala`
- [x] 1.2 Add `PATCH /api/data-sources/:id` route to `DataSourceRoutes.scala` with ACL guard and name validation
- [x] 1.3 Verify `DataSourceRepository.update` correctly persists the name field (no changes needed if it does)

## 2. Frontend — Redux

- [x] 2.1 Add `deleteDataType` thunk to `dataTypesSlice.ts` calling `DELETE /api/types/:id`; handle 409 via `rejectWithValue` with server error message
- [x] 2.2 Add `deleteDataType` extra reducer to remove the type from `items` on success
- [x] 2.3 Add `deleteDataType` API call to `dataTypeService.ts`
- [x] 2.4 Add `updateSource` thunk to `sourcesSlice.ts` calling `PATCH /api/data-sources/:id` with new name
- [x] 2.5 Add `updateSource` extra reducer to update the matching item's name in `items` on success
- [x] 2.6 Add `updateSource` API call to `dataSourceService.ts`

## 3. Frontend — Components

- [x] 3.1 Update `TypeRegistryBrowser`: remove toggle-deselect behavior so clicking a type always sets selection (never clears it on re-click)
- [x] 3.2 Add delete button and inline confirmation to each `TypeRegistryBrowser` row; dispatch `deleteDataType` on confirm; show 409 warning message
- [x] 3.3 Replace `TypeRegistryBrowser` empty state with proper empty state including guidance message
- [x] 3.4 Update `TypeDetailPanel`: add editable name input field; include `name` in the `updateDataType` dispatch call
- [x] 3.5 Add inline edit (rename) affordance to `DataSourceList` rows: pencil button toggles an input; confirm dispatches `updateSource`; Escape cancels
- [x] 3.6 Add bound-DataType warning message to `DataSourceList` delete confirmation flow (check if associated DataType is bound to panels before surfacing standard confirm)
- [x] 3.7 Update `DataSourceList` empty state: replace plain text with proper empty state and CTA button that opens AddSourceModal (accept `onAddSource` callback prop)
- [x] 3.8 Thread `onAddSource` callback from `SourcesPage` into `DataSourceList` so the empty-state CTA opens the modal

## 4. Tests

- [x] 4.1 Add unit tests to `dataTypesSlice.test.ts` for `deleteDataType` fulfilled and 409 rejection cases
- [x] 4.2 Add unit tests to `sourcesSlice.test.ts` for `updateSource` fulfilled case
- [x] 4.3 Update `SourcesPage.test.tsx` to cover: empty DataSource state CTA, non-toggle DataType selection, DataType delete confirm and 409 warning
