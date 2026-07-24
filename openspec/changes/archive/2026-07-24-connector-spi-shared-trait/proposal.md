## Why

Every v1.9 connector today (`SqlConnector`, `RestApiConnector`, the content-source `*Support.scala`
helpers) re-implements the same test/infer/fetch lifecycle by copy-paste — there is no common
interface. HEL-429's connector registry has nothing uniform to enumerate, and each of the five
sibling tickets (424–428) would otherwise bolt onto a different ad-hoc shape. This ticket lands the
shared SPI first so every later connector implements one contract from day one.

## What Changes

- Add trait `Connector[Config]` in `backend/src/main/scala/com/helio/domain/Connector.scala`:
  `testConnection`, `inferSchema`, `fetch(config, maxRows)`, plus a `metadata: ConnectorMetadata`
  capability hook (`kind`, `displayName`, `supportsIncremental`, `authKind`).
- `refresh` is documented on the trait, not a separate method — default semantics is "call `fetch`
  again"; incremental refresh is HEL-428's concern.
- `SqlConnector` (object) and `RestApiConnector` (class) each gain an `extends Connector[...]`
  implementation as a thin addition alongside their existing methods — existing methods, call
  sites, and error strings are untouched.
- New ScalaTest coverage: a fixture connector implementing the SPI (contract test) plus dispatch
  tests proving `SqlConnector` / `RestApiConnector` are reachable as `Connector[_]` instances.
- No `SourceService` call-site changes, no wire-shape change, no DB-shape change.

## Capabilities

### New Capabilities

- `connector-spi`: the shared `Connector[Config]` trait — lifecycle contract (test/inferSchema/fetch)
  and capability metadata that every v1.9 connector implements.

### Modified Capabilities

(none — `rest-api-connector` and `sql-database-connector` behavior is unchanged; this change is
purely additive)

## Impact

- New file: `backend/src/main/scala/com/helio/domain/Connector.scala`.
- Modified: `SqlConnector.scala`, `RestApiConnector.scala` (add trait implementation only).
- New tests under `backend/src/test/scala/com/helio/domain/`.
- No frontend, schema, migration, or API route changes.

## Non-goals

- No new concrete connector (Sheets/BigQuery/GCS/etc.) — HEL-424–428.
- No connector registry aggregation or connection-test HTTP endpoint — HEL-429/480/484.
- No incremental/streaming refresh — HEL-428.
- No change to `SourceService`'s existing call sites or error-envelope shape — HEL-468 owns
  unifying the fetch-error envelope; HEL-473 owns the schema-inference facade.
