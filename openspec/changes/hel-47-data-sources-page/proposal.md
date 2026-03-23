## Why

The backend connectors (HEL-44 REST, HEL-45 CSV), TypeRegistry (HEL-42/43), and DataType CRUD API (HEL-46) are fully implemented. HEL-47 adds the management UI so users can configure data sources, preview and override inferred schemas before committing, and browse/edit the TypeRegistry — all from a `/sources` view accessible from the sidebar.

## What Changes

### Backend

- **New**: `POST /api/sources/infer` — fetches a REST API URL using a provided config and returns an `InferredSchemaResponse` with no DB side effects (preview before commit)
- **New**: `POST /api/data-sources/infer` — accepts a CSV file upload, runs schema inference, returns `InferredSchemaResponse` with no DB side effects
- **Extended**: `CreateSourceRequest` (`POST /api/sources`) — adds optional `fieldOverrides: Vector[FieldOverridePayload]` so the user's display name and type edits from the preview step are committed atomically
- **Extended**: `POST /api/data-sources` multipart handler — adds optional `fields` JSON field for display name overrides on CSV commit
- **New types**: `InferredFieldResponse`, `InferredSchemaResponse`, `FieldOverridePayload`
- **New tests**: infer endpoints for REST and CSV, field overrides on commit

### Frontend

- **Bug fix**: `dataTypeService.ts` URL `/api/datatypes` → `/api/types`
- **Bug fix**: `DataType` and `DataTypeField` types in `models.ts` corrected to match backend response (`displayName`, `dataType`, `nullable` fields; remove spurious `sourceType`)
- **New model**: `DataSource` type in `models.ts`
- **New slice**: `sourcesSlice.ts` with thunks: `fetchSources`, `createRestApiSource`, `createCsvSource`, `deleteSource`, `refreshSource`, `testSource`
- **New service**: `dataSourceService.ts`
- **Extended slice**: `dataTypesSlice.ts` gains `updateDataType` thunk
- **Extended service**: `dataTypeService.ts` gains `updateDataType`
- **App navigation**: sidebar gains a "Data Sources" nav link; `App` gains `activeView: "dashboard" | "sources"` state (no React Router)
- **New page**: `SourcesPage.tsx` with two sections: Data Source List and TypeRegistry Browser
- **New component**: `AddSourceModal.tsx` — two-step modal: (1) configure, (2) preview/edit inferred schema fields
- **New component**: `TypeDetailPanel.tsx` — expandable field list with inline display name and type override editing
- **CSS**: new stylesheets for all new components
- **Tests**: slice unit tests, component render tests

## Capabilities

### New Capabilities

- `data-source-management-ui`: add (REST or CSV), delete, test connection, and refresh data sources from the UI
- `type-registry-browser`: browse all DataTypes with field counts/versions; inline-edit field display names and type overrides
- `schema-preview-flow`: infer schema from a source config before any DB commit; user can override display names and types before saving
- `sources-navigation`: top-level sidebar link routes to the `/sources` management view

### Modified Capabilities

- `data-source-persistence`: extended — two new infer endpoints (no side effects); create endpoints accept field overrides
- `datatype-fetch`: bug fix — correct URL and aligned TypeScript model

## Impact

**Backend:**
- `ApiRoutes.scala` — two new routes under `/api/sources/infer` and `/api/data-sources/infer`; extended create handlers
- `JsonProtocols.scala` — `InferredFieldResponse`, `InferredSchemaResponse`, `FieldOverridePayload` types and formats

**Frontend:**
- `frontend/src/types/models.ts` — `DataSource` added; `DataType`/`DataTypeField` corrected
- `frontend/src/features/sources/sourcesSlice.ts` — new
- `frontend/src/services/dataSourceService.ts` — new
- `frontend/src/features/dataTypes/dataTypesSlice.ts` — `updateDataType` thunk added
- `frontend/src/services/dataTypeService.ts` — URL fix; `updateDataType` added
- `frontend/src/store/store.ts` — `sources` reducer added
- `frontend/src/app/App.tsx` — `activeView` state, sidebar nav link
- `frontend/src/components/SourcesPage.tsx` — new
- `frontend/src/components/AddSourceModal.tsx` — new
- `frontend/src/components/TypeDetailPanel.tsx` — new
- CSS files for new components
- Tests for new slices and components
