## Context

Helio already has schema inference (`SchemaInferenceEngine`), a `DataTypeRepository`, and a `DataSourceRepository` with `insert`/`delete`. The `data_sources.config` column stores arbitrary JSON, so no migration is needed. Akka HTTP (already a dependency) provides both server and client.

The connector introduces a new service layer between routes and repositories: `RestApiConnector` handles the HTTP fetch, auth injection, and wires inference → registration.

## Goals / Non-Goals

**Goals:**
- `POST /api/sources` — create a DataSource and (if fetch succeeds) register a DataType
- `POST /api/sources/:id/refresh` — re-fetch and overwrite DataType fields
- `GET /api/sources/:id/preview` — fetch and return first 10 rows without side effects
- Auth injection: `none`, `bearer`, `api_key` (header or query param)
- Credentials never leak into API responses

**Non-Goals:**
- Scheduling / periodic refresh (manual only)
- Non-JSON response bodies (future ticket)
- Frontend UI (HEL-47/HEL-49)
- CSV connector (HEL-45)

## Decisions

### 1. `RestApiConnector` as a domain service, not a repository
The connector is a stateless service that depends on `ActorSystem` (for the Akka HTTP client). It takes a config, performs a fetch, and returns either rows or an error. Routes compose it with the repositories.

**Alternatives considered:** Putting the logic in routes directly — rejected because it would bloat `ApiRoutes` and make the connector untestable in isolation.

### 2. Akka HTTP client (`Http().singleRequest`)
Already available, no new dependency. Fits naturally with the existing `Future`-based style.

**Alternatives considered:** sttp or requests-scala — would add a new dependency for no gain.

### 3. DataSource created even on fetch failure
If the initial fetch fails (network error, 4xx, 5xx), the DataSource record is still inserted (config is valid and may become reachable later). DataType registration is skipped. The response includes a `fetchError` field explaining why.

**Alternatives considered:** Reject the whole request on failure — cleaner atomicity but poor UX (user loses their config on a transient network error).

### 4. Refresh = full field overwrite
`POST /api/sources/:id/refresh` replaces all fields on the DataType (calls `DataTypeRepository.update`). Version increments. Removed fields are gone.

**Alternatives considered:** Merge/additive — safer but requires field identity tracking, deferred to a future ticket.

### 5. Preview wraps single object in array
If the JSON response is a root object (not an array), it is wrapped in a one-element `JsArray` before slicing to 10 rows. Consistent return shape for consumers.

### 6. Credential scrubbing
The `DataSource` domain object and `DataSourceResponse` already omit `config` from API responses (only `id`, `name`, `sourceType`, timestamps are returned). This is sufficient — no additional scrubbing needed.

## Risks / Trade-offs

- **External HTTP calls in request handlers** → latency spikes if the remote URL is slow. Mitigation: Akka HTTP client has configurable timeouts; set a reasonable default (10s connection, 30s request).
- **No retry logic** → transient failures surface as errors. Mitigation: user can call `/refresh` again; out of scope for this ticket.
- **Config stored in plaintext** → tokens at rest are unencrypted. Mitigation: documented limitation; encryption at rest is a future security hardening ticket.

## Migration Plan

No DB schema changes. Deploy is a standard backend redeploy. No rollback risk beyond the new routes becoming unavailable.
