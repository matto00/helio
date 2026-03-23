## Why

Helio can infer schemas and store DataTypes, but has no way to actually acquire data from external sources. The REST/HTTP connector is the first live data acquisition path — it lets users point Helio at any HTTP endpoint and automatically register the response schema as a DataType.

## What Changes

- New `POST /api/sources` endpoint: accepts a REST/HTTP config, fetches the URL, infers schema, creates a DataSource + DataType
- New `POST /api/sources/:id/refresh` endpoint: re-fetches the URL and replaces the DataType's fields if schema has changed
- New `GET /api/sources/:id/preview` endpoint: fetches and returns the first 10 rows without side effects
- New `RestApiConnector` service class encapsulating HTTP fetch + auth injection + schema inference
- Auth support: `none`, `bearer` (Authorization header), `api_key` (configurable header or query param)
- On initial fetch failure: DataSource is still created (config stored), DataType registration is skipped
- Credentials are stripped from all API responses

## Capabilities

### New Capabilities

- `rest-api-connector`: REST/HTTP connector — fetch, auth injection, config storage, DataType registration, refresh, and preview

### Modified Capabilities

- `data-source-persistence`: DataSourceRepository gains an `update` method for refresh use-case

## Impact

- New backend service: `com.helio.domain.RestApiConnector` (pure fetch + inference logic)
- `DataSourceRepository`: add `update` method
- `ApiRoutes`: new `/api/sources` routes (POST, POST /:id/refresh, GET /:id/preview)
- `JsonProtocols`: new request/response types for source creation and preview
- No DB schema changes needed (config already stored as TEXT in `data_sources`)
- No frontend changes in this ticket
- Dependency: Akka HTTP client (already available via `akka-http`)
