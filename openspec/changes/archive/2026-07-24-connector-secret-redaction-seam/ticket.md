# HEL-460 — Centralized connector secret storage + redaction helper

> Fourth ticket of the HEL-429 "Connector Framework Hardening" epic (v1.9 Data
> Connectors). Branches from `origin/main` at `6dbcf4cd` (HEL-468, PR #275),
> which already contains HEL-449 (Connector SPI), HEL-473 (schema-inference
> facade), and HEL-468 (fetch-error envelope).

## SCOPE AMENDED 2026-07-24 (during delivery)

The original ticket text required a live `secret-manager` backend resolving
GCP Secret Manager references at fetch time. That overlapped HEL-536
("Connector credential storage standard: encrypted at rest, reusable by v1.9
connectors", parent HEL-437, Security & Compliance project), which bills
itself as the canonical substrate v1.9 connectors build on — shipping both
would have given v1.9 connectors two divergent live secret mechanisms.

**Decision (human-confirmed):** HEL-536 owns **all non-inline secret
storage** — both the GCP-Secret-Manager-reference approach and the
envelope-encrypted-column approach. HEL-460 is scoped to the centralization +
redaction seam plus the `inline` backend only. Struck requirements below are
marked ~~like this~~.

See `design.md`'s "HEL-460 / HEL-536 boundary" section for the full
reasoning.

## Context

Connector credentials are stored inline in the source `config` JSON today
(SQL password in `SqlSourceConfig.password`, REST bearer/api-key in
`RestApiConfig.auth`; see `backend/src/main/scala/com/helio/domain/model.scala`).
Redaction happens only at the response boundary in
`DataSourceProtocol.DataSourceResponse.fromDomain` (`redactSqlPayload` →
`password = "***"`, `redactRestAuth` → `token`/`value` → `"***"`). Every new
v1.9 connector (Sheets OAuth refresh tokens, BigQuery/Snowflake
service-account keys, S3 access keys, webhook tokens, OAuth2 tokens) will add
its own secret fields, and each must be independently taught to redact — an
easy place to leak.

This ticket centralizes secret handling: a single place connectors register
which config fields are secret, so redaction is uniform and cannot be
forgotten per-connector. It is the redaction seam the OAuth/token/webhook
tickets in 424/427/428 build on.

## Scope

- Secret-handling helper module (backend `services/` or `infrastructure/`): a
  `SecretRef`/`SecretField` abstraction and a `redactSecrets(config)` utility
  that connectors declare against, replacing per-connector ad-hoc redaction in
  `DataSourceProtocol`.
- A `SecretBackend` interface with `inline` **as the only concrete
  implementation** (current behavior — secret stays in `config` JSON). The
  interface exists so HEL-536 can add non-inline backends behind it without
  reshaping call sites.
- ~~Pluggable secret backend with a `secret-manager` implementation (GCP
  Secret Manager reference stored in `config`, resolved at fetch time for
  prod), selected by env var; document the new env var in CLAUDE.md's
  production-env table.~~ → **moved to HEL-536.** Do not add an env-var
  switch or a CLAUDE.md production-env row in this ticket; HEL-536 introduces
  both when it adds the first non-inline backend.
- ~~Flyway migration IF a dedicated secrets/credentials table is chosen~~ →
  **not needed here.** No schema change: `inline` uses today's existing
  `data_sources.config` storage unchanged.
- Wire the existing SQL/REST redaction through the new helper WITHOUT
  changing the on-the-wire `"***"` output.

## Acceptance criteria

- A connector declares its secret fields once; both API responses and logs
  never emit raw secret values (extend the existing redaction test coverage
  in the DataSource protocol tests).
- **The guarantee is mechanically enforced, not documented.** A connector
  that fails to declare a secret field must cause a test (or a compile error)
  to fail — "connectors can't forget redaction" is worthless unless something
  breaks when they do. Assert on the **actual serialized JSON** of a
  response, not merely on a helper's return value; a helper that returns
  correctly while the response boundary bypasses it would pass a naive test
  and still leak.
- `inline` backend reproduces today's exact behavior (byte-identical redacted
  responses).
- Credential redaction verified for SQL password and REST bearer/api-key
  through the new path.
- Backward-compatible: existing sources with inline secrets continue to load
  and refresh unchanged.
- ~~`secret-manager` backend resolves a stored reference to the live secret
  at fetch time~~ → HEL-536.
- ~~Unit tests for reference resolution (mock secret backend)~~ → HEL-536.
  Unit tests for redaction remain in scope.

## Out of scope

- **All non-inline secret backends** — GCP Secret Manager references,
  envelope encryption, encrypted columns. Owned by HEL-536.
- Actual key rotation / KMS envelope encryption (HEL-437 epic).
- Per-connector secret field declarations for connectors not yet built.
- Pre-existing, do NOT fix: HEL-615 (`DataTypeRepository.update` ignores the
  passed-in version, making `bumpVersion` inert). CSV `InferredField`→
  `DataField` duplication in `DataSourceService` remains a documented
  non-goal.

## Dependencies

- HEL-536 owns every non-inline backend and plugs into the `SecretBackend`
  interface this ticket defines. HEL-536 has been widened (per comment) to
  cover the GCP-reference approach as well as the encrypted-column approach.
- Related to HEL-437 (Security: secrets rotation / key management).
- Consumed by HEL-424 (Sheets OAuth tokens), HEL-427 (OAuth2 tokens), HEL-428
  (webhook tokens).
- Remaining HEL-429 siblings after this ticket: HEL-480 (connection-test
  endpoint + UI), HEL-484 (connector registry + capability metadata). Do not
  pull their scope forward.

## Known repo context

- Credentials today: SQL password in `SqlSourceConfig.password`
  (`backend/src/main/scala/com/helio/domain/model.scala`); REST bearer/
  api-key in `RestApiConfig.auth` (`RestApiAuth.BearerAuth`/`ApiKeyAuth`).
- Redaction today lives entirely in
  `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala`,
  `DataSourceResponse.fromDomain` → `redactSqlPayload`/`redactRestPayload`/
  `redactRestAuth`, operating on the wire payload types
  (`SqlSourceConfigPayload`, `RestApiConfigPayload`), not the domain types.
- Existing redaction test coverage:
  `backend/src/test/scala/com/helio/api/protocols/DataSourceProtocolSpec.scala`
  ("DataSourceResponse.fromDomain credential redaction" block). These tests
  must pass **unmodified**.
- SQL password redaction leaves an *empty* password untouched (no spurious
  `"***"` on an unset password) — REST bearer/api-key redaction masks
  whenever the field is present (`Some(_)`), regardless of string content.
  Both nuances must be preserved exactly.
- Predecessor precedent for helper layering: `SchemaInferenceFacade.scala`
  and `CreateSourceEnvelope.scala` (both `backend/src/main/scala/com/helio/
  services/`) — helpers live in `services/`, not `domain/`, to avoid a
  domain→api dependency (api-protocol types like `RestApiConfigPayload` live
  in `com.helio.api.protocols`). `Connector.scala`
  (`backend/src/main/scala/com/helio/domain/Connector.scala`) carries the
  cross-connector contract doc comments (`'''ExecutionContext'''`,
  `'''Schema inference'''`, `'''Fetch-error envelope'''`) — this ticket adds
  a `'''Secret redaction'''` block there naming the new seam, in the house
  style of short names (no inline FQNs).

## Repo-specific gotchas

- spray-json omits `Option = None` fields from the wire entirely (not
  `null`). An absent secret field and a redacted one are different states —
  don't confuse them in the redaction path (HEL-613 tracks the general
  absent-vs-null issue).
- No inline fully-qualified names anywhere, including doc comments
  (CONTRIBUTING.md, enforced mechanically by `check:scala-quality`).
- Existing redaction test suites must pass unmodified — do not edit a test
  to accommodate new code.
- No dangling unimplemented `SecretBackend` case — either exactly one
  concrete implementation (`inline`) with a doc comment naming HEL-536 as the
  owner of future backends, or an explicit extension point some other way,
  but no branch a reader has to guess about.
