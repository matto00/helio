## Why

`SourceType.Static` exists in the backend enum but is inert — there is no handler, no UI, and no storage contract for manually entered rows. Users who need reference tables or demo data must resort to CSV uploads or external APIs, which is overkill. Exposing a first-class static connector closes this gap without introducing new infrastructure dependencies.

## What Changes

- Backend accepts `source_type: static` on `POST /api/data-sources` with a typed columns-and-rows payload stored in the `config` JSONB column.
- Schema inference runs on the provided rows and registers a DataType automatically.
- `POST /api/data-sources/:id/refresh` replaces stored rows and re-infers the schema.
- Payloads exceeding 500 rows are rejected with HTTP 400.
- `GET /api/data-sources/:id/preview` returns the stored rows.
- Frontend `AddSourceModal` gains a **Manual / Static** tab with a two-step flow: (1) define columns, (2) enter rows inline.
- `DataSourceList` shows a "Static" badge for static sources.

## Capabilities

### New Capabilities

- `static-data-connector`: Backend handling, storage, schema inference, and refresh for manually entered tabular data; frontend tab for column/row authoring.

### Modified Capabilities

- `data-source-persistence`: Adds static source config shape to the persistence contract.
- `schema-inference`: Now triggered by the static connector in addition to the existing CSV/REST connectors.
- `frontend-data-sources-page`: `AddSourceModal` gains a new tab; `DataSourceList` gains a badge variant.

## Impact

- `backend/`: `DataSourceRoutes.scala`, `DataSourceRepository.scala`, `DataSource.scala` domain model, `JsonProtocols.scala`, new Flyway migration (if needed for config shape).
- `frontend/`: `AddSourceModal`, `DataSourceList`, `dataSourcesSlice`, service layer, TypeScript types.
- `schemas/`: New static source request schema.
- `openspec/specs/`: New `static-data-connector` spec; delta specs for `data-source-persistence`, `schema-inference`, `frontend-data-sources-page`.

## Non-goals

- Spreadsheet paste from clipboard
- Formula or expression support
- Datasets larger than 500 rows
