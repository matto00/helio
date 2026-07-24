## Why

`SourceService.createSql`/`createRest` each open-code the same "fetch failed → diagnosable envelope,
fetch succeeded → persisted DataType" construction of `CreateSourceResponse`. There is no shared
helper, so every future v1.9 connector (HEL-460/480/484 and beyond) must re-derive it by hand,
risking drift from the HEL-311 message-hygiene guarantee (curated category prefix only, raw
exception text never reaches the client).

## What Changes

- Add a `services/CreateSourceEnvelope` helper, keyed off `Connector[Config].inferSchema`'s
  `Future[Either[String, InferredSchema]]` result: `Left(err)` → `CreateSourceResponse(source,
  dataType = None, fetchError = Some(err))`; `Right(schema)` → project via
  `SchemaInferenceFacade.toDataFields`, persist the `DataType`, and return `CreateSourceResponse(source,
  dataType = Some(...), fetchError = None)`.
- Refactor `SourceService.createSql`/`createRest` to call the shared helper instead of open-coding the
  envelope. No change to the `Either`/error-string values already produced by `Connector.inferSchema`
  — the helper only extracts the existing wrapping logic, it does not add new curation.
- Extend `Connector.scala`'s trait-level doc comment with a `'''Fetch-error envelope'''` block
  documenting the contract, alongside the existing `'''ExecutionContext'''`/`'''Schema inference'''`
  blocks (HEL-449/HEL-473 precedent), so future connector tickets reference it instead of
  re-deriving.
- Add a test-connector fixture (mirroring HEL-473's `RowSupplyingConnector`) proving any
  `Connector[Config]` implementation gets the envelope by construction — no per-connector envelope
  logic needed.

## Capabilities

### New Capabilities
- `fetch-error-envelope`: shared create-time envelope construction (`CreateSourceResponse`) for any
  `Connector[Config]` implementation, given its `inferSchema` result.

### Modified Capabilities
(none — `createSql`/`createRest`'s observable behavior is unchanged; `connector-spi`'s trait shape is
unchanged, only its doc comment gains a new block, which is not a requirement-level change)

## Impact

- `backend/src/main/scala/com/helio/services/SourceService.scala` — `createSql`/`createRest` call the
  new helper.
- `backend/src/main/scala/com/helio/services/CreateSourceEnvelope.scala` — new file.
- `backend/src/main/scala/com/helio/domain/Connector.scala` — doc comment addition only, no signature
  change.
- `backend/src/test/scala/com/helio/services/` — new envelope-helper unit tests + test-connector
  fixture; existing `SourceServiceSpec` create tests must pass unmodified (behavior-preservation
  signal).
- No API contract change — `CreateSourceResponse`'s wire shape is untouched.

## Non-goals

- Refresh-time error surfacing (`ServiceError.BadGateway`, a separate path) — out of scope, unchanged.
- New connectors, connection-test endpoint, secret redaction, or connector registry — owned by
  sibling tickets HEL-480/460/484 respectively.
- `DataSourceService`'s CSV create/refresh duplication of `InferredField`→`DataField` mapping —
  documented HEL-473 non-goal, not reopened here unless genuinely required (it is not — CSV doesn't
  use the Connector SPI or this envelope).
