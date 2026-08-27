## Why

REST sources today carry their own base URL and plaintext credential inline in `RestApiConfig`
(`url`, `auth`, `headers`), duplicated per source. HEL-821 shipped the `Connector` entity
(encrypted, reusable, owner-scoped host+credential) precisely so sources can stop doing that.
HEL-822 is the wiring: point `RestSource` at a Connector, remove `auth` from the source, and
migrate every pre-existing REST source so it keeps fetching successfully afterward.

## What Changes

- `RestApiConfig` gains `connectorId`, `endpoint`, `queryParams`; loses `auth`. `method`/
  `headers` remain, `headers` now merges over (never replaces) the Connector's own default
  headers, source wins on key collision (documented + tested).
- **BREAKING**: `POST /api/sources` (`type: "rest_api"`) no longer accepts `config.url`/
  `config.auth`; it requires `config.connectorId` + `config.endpoint`. This is the ticket's
  literal scope (target shape stated in the ticket itself), not an incidental break.
- `RestApiConnectorDriver.buildRequest` resolves the Connector (base URL + decrypted
  credential) and composes it with the source's `endpoint`/`queryParams`/`headers` at fetch
  time, instead of reading `url`/`auth` directly off the source config.
- `ConnectorRepository.delete`'s `dependentCount` stub (HEL-821, always-zero) is replaced with
  a real query counting `data_sources` rows whose `rest_api` config references the Connector —
  making the existing 409 `ConnectorHasDependents` block genuinely reachable.
- **Data migration**: every pre-existing `rest_api` `data_sources` row (legacy `url`+`auth`
  shape) is migrated, once, idempotently, into a synthesized 1:1 Connector (auto-migrate,
  no dedup — see design.md) + a rewritten source config referencing it. Runs at backend
  startup, guarded to skip already-migrated/already-referencing rows.
- Wire contract updated end-to-end: `RestApiConfigPayload`/`toDomain`/`fromDomain`
  (`DataSourceProtocol.scala`), `DataSourceConfigCodec.decodeRest`/`encodeRest`,
  `CreateSourceRequest`. `decodeRest`'s existing silent-degrade-to-empty-on-parse-failure
  behavior is replaced with fail-loud handling per design.md (repo's documented
  silent-corruption defect class — HEL-814/HEL-671).
- HEL-842's `RlsPolicyGuardSpec` allowlist gets any new RLS-protected table this ticket adds
  (none currently planned — see design.md; `data_sources`/`connectors` schemas are unmodified
  at the SQL level).

## Capabilities

### New Capabilities
(none — this extends existing capabilities below)

### Modified Capabilities
- `rest-api-connector`: source config shape changes to connector-referencing
  (connectorId/endpoint/queryParams/headers), auth removed from the source, header-precedence
  rule added, and a migration requirement for pre-existing rows.
- `connectors/connector-management`: `dependentCount` collaborator is wired to a real
  data-sources query; delete-blocked-on-dependents becomes reachable in practice.

## Impact

- Backend: `model.scala` (`RestApiConfig`), `DataSourceProtocol.scala`, `DataSourceConfigCodec.scala`,
  `RestApiConnectorDriver.scala`, `ConnectorRepository.scala`, `ConnectorEntityService.scala`,
  `DataSourceRepository.scala` (or a new `data-sources` query for dependent counting),
  `Main.scala` (migration hook), new `RestSourceConnectorMigration` service.
- No new Flyway migration expected (connectorId lives inside the existing opaque
  `data_sources.config` JSONB, same convention as today's `url`/`auth`) — see design.md for
  why this avoids a schema change and an RLS-allowlist update.
- Frontend: untouched (HEL-824/827 own the UI; the backend still accepts requests shaped
  the way the (currently empty, per dev-DB check) production data implies — no frontend
  caller exists yet for `rest_api` create in main, so no frontend break to coordinate).
- Out of scope: templating (HEL-823), Connectors CRUD UI (HEL-824), REST body/response
  shaping (HEL-826), form parity (HEL-827), agent/MCP surface (HEL-828).

## Non-goals

- Deduping synthesized Connectors across sources sharing a host (accept 1:1 duplicates —
  see design.md for why cross-source credential comparison is unsafe to attempt here).
- Building rollback tooling (migration's irreversibility is stated explicitly, with reasoning,
  per the AC's second branch).
- Credential rotation, MCP tool coverage, or any UI surface.
