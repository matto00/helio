## 1. Backend: New Infer Endpoints

- [ ] 1.1 Add `InferredFieldResponse(name, displayName, dataType, nullable)`, `InferredSchemaResponse(fields)`, and `FieldOverridePayload(name, displayName, dataType)` case classes to `JsonProtocols.scala`
- [ ] 1.2 Add Spray JSON formats for all three new types
- [ ] 1.3 Add `InferSourceRequest(config: RestApiConfigPayload)` case class and format
- [ ] 1.4 Implement `POST /api/sources/infer` route: parse config → `connector.fetch` → `SchemaInferenceEngine.fromJson` → `InferredSchemaResponse`; return 502 on fetch error
- [ ] 1.5 Implement `POST /api/data-sources/infer` route: multipart `file` field → UTF-8 decode → `SchemaInferenceEngine.fromCsv` → `InferredSchemaResponse`; 400 on encoding/missing file

## 2. Backend: Field Overrides on Commit

- [ ] 2.1 Add `fieldOverrides: Option[Vector[FieldOverridePayload]]` to `CreateSourceRequest` and update its JSON format
- [ ] 2.2 In `POST /api/sources` handler: after schema inference, apply any `fieldOverrides` to the DataField vector (match on `name`, override `displayName` and `dataType`)
- [ ] 2.3 In `POST /api/data-sources` multipart handler: parse optional `fields` form field as `Vector[FieldOverridePayload]`; apply overrides to inferred fields before inserting DataType

## 3. Backend Tests

- [ ] 3.1 `DataSourceRoutesSpec`: test `POST /api/sources/infer` — returns inferred schema; returns 502 on bad URL
- [ ] 3.2 `DataSourceRoutesSpec`: test `POST /api/data-sources/infer` — returns inferred schema; returns 400 on missing file
- [ ] 3.3 `DataSourceRoutesSpec`: test `POST /api/sources` with `fieldOverrides` — overridden displayName appears in returned DataType
- [ ] 3.4 Run `sbt test` in `backend/` — all tests pass

## 4. Frontend: Bug Fixes and Model Alignment

- [ ] 4.1 Fix `dataTypeService.ts`: change URL `/api/datatypes` → `/api/types`
- [ ] 4.2 Fix `DataTypeField` in `models.ts`: replace `{ name, fieldType }` with `{ name, displayName, dataType, nullable }`
- [ ] 4.3 Fix `DataType` in `models.ts`: remove spurious `sourceType` field (source name will be joined via `sourceId` in the component layer)
- [ ] 4.4 Add `DataSource` interface to `models.ts`: `{ id, name, sourceType, createdAt, updatedAt }`

## 5. Frontend: Data Source Service and Slice

- [ ] 5.1 Create `frontend/src/services/dataSourceService.ts` with: `fetchDataSources`, `createRestApiSource`, `createCsvSource`, `deleteDataSource`, `refreshDataSource`, `testDataSource`, `inferRestSchema`, `inferCsvSchema`
- [ ] 5.2 Create `frontend/src/features/sources/sourcesSlice.ts` with state `{ items, status, error }` and thunks: `fetchSources`, `createRestApiSource`, `createCsvSource`, `deleteSource`, `refreshSource`
- [ ] 5.3 Register `sourcesReducer` in `store.ts`

## 6. Frontend: DataTypes Slice Extension

- [ ] 6.1 Add `updateDataType(id, payload)` thunk to `dataTypesSlice.ts` (calls `PATCH /api/types/:id`)
- [ ] 6.2 Add `updateDataType` service function to `dataTypeService.ts`
- [ ] 6.3 Handle `updateDataType.fulfilled` in `dataTypesSlice` extraReducers (replace item in `items`)

## 7. Frontend: Routing and App Navigation

- [ ] 7.1 Install `react-router-dom` (and `@types/react-router-dom` if needed)
- [ ] 7.2 Wrap `main.tsx` in `<BrowserRouter>`
- [ ] 7.3 Define routes: `/` → existing dashboard view, `/sources` → `SourcesPage`
- [ ] 7.4 Add `<NavLink to="/sources">Data Sources</NavLink>` to the sidebar; update existing tests to use `MemoryRouter`

## 8. Frontend: SourcesPage Component

- [ ] 8.1 Create `frontend/src/components/SourcesPage.tsx`: dispatches `fetchSources` and `fetchDataTypes` on mount; renders `DataSourceList` and `TypeRegistryBrowser` sections
- [ ] 8.2 Create `frontend/src/components/SourcesPage.css`

## 9. Frontend: DataSourceList Component

- [ ] 9.1 Create `frontend/src/components/DataSourceList.tsx`:
  - List row: name, source type badge (`rest_api` → "REST API", `csv` → "CSV"), `updatedAt` timestamp, inline test/status indicator
  - Per-row actions: "Test", "Refresh", "Delete" (with confirm)
  - "Add source" button opens `AddSourceModal`
- [ ] 9.2 Create `frontend/src/components/DataSourceList.css`

## 10. Frontend: AddSourceModal Component

- [ ] 10.1 Create `frontend/src/components/AddSourceModal.tsx` — two-step modal:
  - Step 1 "Configure": source type selector (REST/CSV); REST fields: URL, method, auth type, auth credentials, headers editor; CSV fields: file input, name; "Fetch & Infer" / "Parse & Infer" button calls infer service and advances to step 2 on success
  - Step 2 "Preview Schema": editable table of inferred fields (displayName input, dataType select); "Save" commits via `createRestApiSource` or `createCsvSource` with field overrides; "Back" returns to step 1
- [ ] 10.2 Create `frontend/src/components/AddSourceModal.css`

## 11. Frontend: TypeRegistryBrowser and TypeDetailPanel

- [ ] 11.1 Create `frontend/src/components/TypeRegistryBrowser.tsx`: lists DataTypes with name, source name (joined by sourceId against sources.items), field count, version; clicking expands `TypeDetailPanel`
- [ ] 11.2 Create `frontend/src/components/TypeDetailPanel.tsx`: renders field table with `displayName` inputs and `dataType` selects; on blur calls `updateDataType` thunk with full updated fields
- [ ] 11.3 Create `frontend/src/components/TypeRegistryBrowser.css`

## 12. Frontend Tests

- [ ] 12.1 `sourcesSlice.test.ts`: `fetchSources` pending/fulfilled/rejected; `deleteSource.fulfilled` removes item; `createRestApiSource.fulfilled` adds item
- [ ] 12.2 `dataTypesSlice.test.ts`: `updateDataType.fulfilled` replaces item in `items`
- [ ] 12.3 `SourcesPage.test.tsx`: renders both sections; dispatches `fetchSources` and `fetchDataTypes` on mount
- [ ] 12.4 `DataSourceList.test.tsx`: renders source items with type badge; confirm-delete flow
- [ ] 12.5 `AddSourceModal.test.tsx`: step 1 form renders; advances to step 2 after infer; step 2 shows editable fields; save calls create thunk
- [ ] 12.6 `TypeRegistryBrowser.test.tsx`: renders DataType list; expand shows TypeDetailPanel with fields

## 13. Verification

- [ ] 13.1 `npm run lint` — zero warnings
- [ ] 13.2 `npm run format:check` — clean
- [ ] 13.3 `npm test` — all tests pass
- [ ] 13.4 `npm run build` in `frontend/` — clean build
- [ ] 13.5 `sbt test` in `backend/` — all tests pass
