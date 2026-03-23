## Architecture

### Navigation Model

`react-router-dom` is added as a new dependency. `main.tsx` is wrapped in `<BrowserRouter>`. Two routes are defined:

- `/` — dashboard view (existing `App` shell with `DashboardList` + `PanelGrid`)
- `/sources` — sources page (`SourcesPage`)

The top-level `App` component is split: shared shell (header, theme toggle) wraps `<Outlet />` or rendered routes. The sidebar gets a `<NavLink to="/sources">` entry using React Router's `NavLink` for active styling. The existing `DashboardList` collapse toggle is preserved.

Routing is tested via `MemoryRouter` in Jest tests.

### Source Creation Flow (Two-Step Modal)

```
User opens "Add source"
  ↓
Step 1: Configure
  REST API: URL, method, auth type, headers
  CSV:      file upload, name
  ↓ "Fetch & Infer" / "Parse & Infer"
    → POST /api/sources/infer   (REST)
    → POST /api/data-sources/infer (CSV)
  ↓
Step 2: Preview Schema
  Editable table: displayName (user-editable), dataType (dropdown), nullable (read-only)
  ↓ "Save"
    REST → POST /api/sources   { name, sourceType, config, fieldOverrides }
    CSV  → POST /api/data-sources  multipart { name, file, fields (JSON) }
  ↓
Success: source added to list, DataType registered
```

If "Fetch & Infer" fails (4xx/5xx, network error), the error is shown in the modal and the user stays on step 1.

### Test Connection

Uses the preview endpoint as a side-effect-free connectivity check:
- REST: `GET /api/sources/:id/preview`
- CSV:  `GET /api/data-sources/:id/preview`

"Test" button shows a spinner, then "ok" or "error" indicator in local component state. Status is not persisted; it resets on page reload (matching current backend model which has no status column).

### Refresh

Routes by sourceType:
- REST: `POST /api/sources/:id/refresh` — re-fetches URL, updates DataType
- CSV:  `POST /api/data-sources/:id/refresh` — re-reads stored file, updates DataType

### Delete

Always `DELETE /api/data-sources/:id` (unified endpoint for all source types). Confirmed via inline confirm/cancel buttons, matching the existing `DashboardList` delete pattern.

### Type Registry Browser

- `GET /api/types` loads all DataTypes into Redux (`dataTypes.items`)
- Displayed as a list: name, source name (joined by sourceId against `sources.items`), field count, version
- Click a DataType → expands `TypeDetailPanel` with an editable field table
- On field blur, calls `PATCH /api/types/:id` with the full updated fields vector

### Frontend State

```
store.sources: {
  items: DataSource[]
  status: "idle" | "loading" | "succeeded" | "failed"
  error: string | null
}

store.dataTypes: {          ← already exists; gain updateDataType thunk
  items: DataType[]
  status: ...
  error: ...
}
```

### DataSource Service Routing

```ts
fetchDataSources()         → GET  /api/data-sources
createRestApiSource(...)   → POST /api/sources
createCsvSource(...)       → POST /api/data-sources  (FormData)
deleteDataSource(id)       → DELETE /api/data-sources/:id
refreshDataSource(id, type)→ POST /api/sources/:id/refresh   (rest_api)
                           → POST /api/data-sources/:id/refresh (csv)
testDataSource(id, type)   → GET  /api/sources/:id/preview    (rest_api)
                           → GET  /api/data-sources/:id/preview (csv)
inferRestSchema(config)    → POST /api/sources/infer
inferCsvSchema(file)       → POST /api/data-sources/infer  (FormData)
```

### Backend: Infer Endpoints

**`POST /api/sources/infer`**
- Request: `InferSourceRequest { config: RestApiConfigPayload }`
- Parses config → fetches URL via `RestApiConnector` → runs `SchemaInferenceEngine.fromJson`
- Returns: `InferredSchemaResponse { fields: Vector[InferredFieldResponse] }`
- On fetch failure: `502 { message: "..." }`
- No DB writes

**`POST /api/data-sources/infer`**
- Request: multipart with `file` field
- Decodes UTF-8 → runs `SchemaInferenceEngine.fromCsv`
- Returns: `InferredSchemaResponse`
- On parse error / encoding error: `400`
- No DB writes, no filesystem writes

### Backend: FieldOverridePayload

```scala
final case class FieldOverridePayload(name: String, displayName: String, dataType: String)
```

Applied after inference on commit: for each inferred field, if a matching override exists (by `name`), the `displayName` and `dataType` from the override replace the inferred values.

### CSS Conventions

Follow existing patterns:
- BEM-like class names: `sources-page__*`, `add-source-modal__*`, `type-detail-panel__*`
- Co-located `.css` files beside component `.tsx`
- Design tokens from `theme.css`
