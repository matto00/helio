## Context

`SourceService.createSql` (L44-89) and `createRest` (L91-139) each insert the `DataSource`, then
call `Connector[Config].inferSchema(config)` (HEL-473's SPI-routed dispatch) and hand-build the
`CreateSourceResponse` envelope: `Left(err)` → `dataType = None, fetchError = Some(err)`;
`Right(schema)` → project fields via `SchemaInferenceFacade.toDataFields`, build+insert a `DataType`
at `version = 1`, and return `dataType = Some(...), fetchError = None`. The two copies are
structurally identical apart from which `Connector[Config]` instance and `overrides` map they use.
`err` reaching this point is already a curated HEL-311 category message — `RestApiConnector`/
`SqlConnector`'s `inferSchema` log the raw cause server-side and return only the generic prefix (see
the `// HEL-311: keep the curated category prefix` comments in both files). `SourceService` never
re-wraps it (see the four `// HEL-311: err is already ... curated` comments at `refreshSql`/
`refreshRest`/`previewSql`/`previewRest` for the established "pass through as-is" precedent this
design follows for `createSql`/`createRest` too).

## Goals / Non-Goals

**Goals:**
- One `CreateSourceEnvelope.build` helper, generic over `Connector[Config]`, replacing both inline
  copies with zero change to the emitted `CreateSourceResponse` values.
- Byte-identical envelopes for every existing `SourceServiceSpec` create-path test (success + failure,
  REST + SQL) — the acceptance signal is those tests passing unmodified.
- A test-connector fixture (mirroring HEL-473's `RowSupplyingConnector`) demonstrating that any
  `Connector[Config]` implementation gets the envelope by construction, no per-connector code needed.
- Extend `Connector.scala`'s trait doc comment with the envelope contract (HEL-449/HEL-473 precedent:
  `'''ExecutionContext'''`, `'''Schema inference'''` blocks already live there).

**Non-Goals:**
- Touching `err`'s content — the helper forwards `Left(err)` verbatim; no new curation, wrapping, or
  re-prefixing. HEL-311 curation is connector-internal and stays there.
- Refresh-time (`refreshSql`/`refreshRest`) or preview-time envelope — those return `ServiceError`,
  a structurally different response type, explicitly out of scope per the ticket.
- `DataSourceService`'s CSV duplication of the field-projection (HEL-473's documented non-goal) — CSV
  does not implement `Connector[Config]` and does not produce a `CreateSourceResponse`, so this
  ticket's envelope helper does not apply to it; not reopened here.
- Changing `CreateSourceResponse`'s wire shape (still `jsonFormat3`, unchanged field names/types).

## Decisions

**1. `CreateSourceEnvelope` lives in `services/`, not `domain/`, as an object with one generic
method — same layering precedent as `SchemaInferenceFacade`.** `CreateSourceResponse` is an
api-protocol type, and the helper also touches `DataTypeRepository` (infrastructure) and
`AuthenticatedUser`; `domain/Connector.scala` has zero api/infrastructure imports today (HEL-449/473
established this boundary), so the helper cannot live there. `services/SchemaInferenceFacade.scala`
is the direct precedent for a services-layer object built around api-protocol types
(`FieldOverridePayload`) — `CreateSourceEnvelope` follows the same pattern, built around
`CreateSourceResponse`/`AuthenticatedUser`.

**2. Signature takes the `Connector[Config]` instance + config, not a pre-computed `Either` — "keyed
off the Connector SPI" per the ticket, and it lets the helper own the one `inferSchema` call site
instead of each caller doing so separately.**
```scala
def build[Config](
    connector:    Connector[Config],
    config:       Config,
    source:       DataSource,
    now:          Instant,
    dataTypeRepo: DataTypeRepository,
    user:         AuthenticatedUser,
    overrides:    Map[String, FieldOverridePayload] = Map.empty
)(implicit ec: ExecutionContext): Future[CreateSourceResponse]
```
`now` is threaded in (not computed inside) rather than called fresh with `Instant.now()`, because the
existing code shares one `now` between the inserted `DataSource`'s timestamps and the new `DataType`'s
`createdAt`/`updatedAt` — preserving that exact sharing keeps the change behavior-neutral rather than
merely behavior-equivalent-in-practice. `overrides` defaults to `Map.empty` so `createSql` (no
overrides today) doesn't need to pass one, matching `SchemaInferenceFacade.toDataFields`'s existing
default-parameter precedent.

**3. `createSql`/`createRest` call the helper after `dataSourceRepo.insert`, replacing their
`flatMap { case Left(err) => ...; case Right(schema) => ... }` block wholesale.**
```scala
dataSourceRepo.insert(source, user).flatMap { inserted =>
  CreateSourceEnvelope.build(SqlConnector, sqlConfig, inserted, now, dataTypeRepo, user).map(Right(_))
}
```
`createRest` passes `connector` (the injected `RestApiConnector` instance, already typed
`Connector[RestApiConfig]`) and `overridesMap` in place of the default. Confirmed the `Left`/`Right`
branches produce identical field-for-field `CreateSourceResponse` values to today's inline code —
same `DataSourceResponse.fromDomain(inserted)`, same `DataType` field set
(`id`/`sourceId`/`name`/`fields`/`version = 1`/`createdAt`/`updatedAt`/`ownerId`), same
`dataTypeRepo.insert` call, same `DataTypeResponse.fromDomain(createdDt)` wrapping.

**4. `fetchError` pass-through preserved: helper's `Left` branch is a `Future.successful`, no
`.map`/transform on `err` itself.** This is the property HEL-473's final gate explicitly proved for
the six SPI-routed methods (`Either.map`/`Future.map` only transform `Right`) — the helper's `Left`
case constructs `CreateSourceResponse(..., fetchError = Some(err))` directly from the unmodified
`err` string, so the same guarantee holds through the extraction.

**5. Doc-comment addition, not a `connector-spi` spec delta.** Following HEL-473's Decision 5
precedent: `connector-spi`'s existing "Existing SqlConnector/RestApiConnector behavior unchanged"
requirement already covers "the SPI's external contract is untouched" — the trait's method signatures
don't change, only its doc comment gains a `'''Fetch-error envelope'''` block. This ticket's new
testable surface (the helper + the doc contract) is `fetch-error-envelope`, a new capability spec, not
a `connector-spi` delta.

## Risks / Trade-offs

- [Risk] A generic `build[Config]` method could accidentally widen/narrow type inference at call
  sites (e.g. `SqlConnector: Connector[SqlSourceConfig]` needs no cast since `SqlConnector` already
  `extends Connector[SqlSourceConfig]`) → Mitigation: existing `SourceServiceSpec` create tests compile
  and pass unmodified is the direct proof; no new implicit conversions introduced.
- [Trade-off] The helper takes 7 parameters (vs. 2-3 for `SchemaInferenceFacade.toDataFields`) because
  it spans repo access + timestamp + user + connector dispatch in one call — accepted because splitting
  it further would re-introduce the two-copies problem this ticket removes (the "assemble a DataType
  and persist it" step is inherently the part that needed dedup, not just the field projection).

## Planner Notes

- Chose `task/` branch prefix — internal refactor, no user-facing behavior change (matches
  HEL-449/HEL-473 precedent for this epic).
- Self-approved: new `fetch-error-envelope` capability spec (additive) rather than a `connector-spi`
  delta — no `connector-spi` requirement text changes (Decision 5).
- Self-approved: `services/CreateSourceEnvelope.scala` as the file name — mirrors
  `services/SchemaInferenceFacade.scala` naming (capability-named object, not a generic "Helper"
  suffix).
- Confirmed no `DataSourceService` (CSV/Static) touch needed — that service never calls
  `Connector[Config].inferSchema` or constructs a `CreateSourceResponse`; the documented non-goal
  stands untouched.
