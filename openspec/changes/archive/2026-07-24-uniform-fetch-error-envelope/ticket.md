# HEL-468: Uniform fetch-error envelope for all connectors

## Context

REST and SQL creation return a graceful fetch-error envelope: on a fetch/query failure at create time, `SourceService.createRest` / `createSql` (`backend/src/main/scala/com/helio/services/SourceService.scala`) return `CreateSourceResponse(source, dataType = None, fetchError = Some(err))` instead of an HTTP error, so a bad URL/credential is diagnosable and retryable (see `api/protocols/DataSourceProtocol.scala` `CreateSourceResponse{source, dataType, fetchError}`, and the MCP tool descriptions for `create_rest`/`create_sql` in `helio-mcp/src/tools/write.ts`). Curated category prefixes (HEL-311) keep raw driver/parser messages out of the envelope. Each new v1.9 connector must produce the same envelope, but there is no shared helper — the two existing paths open-code it.

## Scope

* Extract the create-time envelope construction into a reusable helper keyed off the Connector SPI (HEL-449): given a `Connector.fetch`/`inferSchema` result, produce `CreateSourceResponse` with either the companion `DataType` (success) or `dataType: null` + `fetchError` (failure).
* Preserve the HEL-311 message hygiene: curated category prefix only, raw exception tail dropped and logged, never the credential.
* Refactor `createRest`/`createSql` to use the shared helper WITHOUT behavior change.
* Document the envelope contract so connector tickets reference it rather than re-deriving.

## Acceptance criteria

* The helper yields byte-identical envelopes for the existing REST and SQL success and failure cases (existing `SourceService` tests unchanged).
* No raw driver/parser/exception text leaks into `fetchError`; failures are logged server-side.
* Any connector implementing the SPI gets the envelope by construction (demonstrated by a test connector).
* Backward-compatible wire shape for `CreateSourceResponse`.

## Out of scope

* Refresh-time error surfacing (refresh returns `ServiceError`, a separate path) — leave as-is.
* New connectors.

## Dependencies

* Blocked by HEL-449 (Connector SPI) — the helper is keyed off the SPI result type. (Merged `d6fe6a45`, on main.)
* Also builds on HEL-473 (schema-inference facade) — already merged `ca65465d`, on main. `SourceService.createRest`/`createSql` already dispatch through `Connector[Config].inferSchema` and `SchemaInferenceFacade.toDataFields`.

## Epic context

Third ticket of HEL-429 "Connector Framework Hardening" (v1.9 Data Connectors). Predecessors merged and on main:
- HEL-449 Connector SPI — merged `d6fe6a45`
- HEL-473 schema-inference facade — merged `ca65465d`

Sibling ownership map (from HEL-449's design.md, "do not pull forward"):
| Concern | Owner |
|---|---|
| Schema-inference facade / polymorphic dispatch | HEL-473 (done) |
| Uniform fetch-error envelope | **HEL-468 (this ticket)** |
| Centralized secret storage + redaction | HEL-460 |
| Connection-test HTTP endpoint + UI | HEL-480 |
| Connector registry + capability aggregation | HEL-484 |

Do not pull HEL-460/480/484 scope forward.

## Known context / gotchas

- Existing envelope construction lives inline in `SourceService.createSql` (lines ~59-87) and `createRest` (lines ~108-138) of `backend/src/main/scala/com/helio/services/SourceService.scala`. Both already call `Connector[Config].inferSchema(config)` (SPI dispatch, HEL-473) — the `Left(err)` branch is already a curated HEL-311 message by the time it reaches `SourceService` (curation happens inside `RestApiConnector`/`SqlConnector`'s `inferSchema`/`fetch`, which log the raw cause and return only a generic category message). `SourceService` must not re-wrap or re-curate `err` — see the four `// HEL-311: err is already a generic, curated category message` comments at `refreshSql`/`refreshRest`/`previewSql`/`previewRest` for the established precedent of *not* double-wrapping.
- **HEL-473's final gate proved `fetchError` passes through unchanged in all six routed methods** (`Either.map`/`Future.map` only transform `Right`). Preserve this — verify it still holds after extracting the helper.
- **Do NOT fix HEL-615** (pre-existing bug: `DataTypeRepository.update` unconditionally computes `existing.version + 1`, making `upsertDataType`'s `bumpVersion` param inert). Don't build anything that depends on `bumpVersion` being meaningful. This is out of scope for `createSql`/`createRest` anyway (they always insert version 1, no `upsertDataType` call), but noting for awareness since `upsertDataType` lives in the same file.
- **`DataSourceService`'s CSV create/refresh paths (~L157-165, ~L530-533) still duplicate the InferredField→DataField mapping** HEL-473 centralized (documented non-goal, HEL-473 design.md). Out of scope for this ticket unless the error-envelope work genuinely requires touching them — if so, say so explicitly in the design rather than doing it silently.
- **spray-json omits `Option = None` from the wire entirely** (not `null`) — `fetchError: Option[String]` is exactly this kind of field already; a `None` fetchError is simply absent from the JSON today (existing, presumably-working behavior — do not regress). Any new Option-typed field this ticket introduces needs the same absent-on-wire handling verified with a fixture that OMITS the key. Tracking ticket for the general problem: HEL-613.
- Precedent for the "helper lives in services/, not domain/" layering + "prove the SPI in a test connector" pattern: HEL-473's `SchemaInferenceFacade` (`backend/src/main/scala/com/helio/services/SchemaInferenceFacade.scala`) and HEL-473's `NewConnectorInferenceSpec`/`RowSupplyingConnector` fixture (`backend/src/test/scala/com/helio/domain/NewConnectorInferenceSpec.scala`) are the closest analogues for both the helper's home and the "demonstrated by a test connector" acceptance criterion.
- `Connector.scala`'s trait-level doc comment is the established place to document cross-connector contracts (HEL-449 added the `'''ExecutionContext'''` block, HEL-473 added `'''Schema inference'''`) — this ticket's "document the envelope contract" scope bullet likely adds a `'''Fetch-error envelope'''` block there, per the same precedent.
- Existing `SourceServiceSpec` create tests (createSql/createRest, success + failure cases) must pass unmodified — they are the acceptance signal for "byte-identical envelopes."
