## Why

Every v1.9 connector will add its own secret fields (OAuth tokens, service-account keys, access
keys), and today each must independently remember to redact them in `DataSourceProtocol` — an easy
place to leak. This ticket centralizes secret declaration and redaction into one seam so forgetting
is a loud failure (compile error or test failure), not a silent leak.

## What Changes

- Add a `SecretField[Config]`/`HasSecrets[Config]` declaration mechanism (`com.helio.services`):
  connectors register which config fields hold secrets, once, as data.
- Add `SecretRedaction.redact(payload)`, called at the one production call site
  (`DataSourceResponse.fromDomain`), which requires an implicit `HasSecrets[Config]` for the payload's
  type and returns a plain, already-masked `Config` — no wrapper type, no response field-type change.
- Add a `SecretBackend` interface with exactly one concrete implementation, `InlineSecretBackend`
  (today's `"***"` masking) — no env-var switch, no second case. Doc comment names HEL-536 as the
  owner of future non-inline backends.
- Route `DataSourceProtocol`'s existing SQL/REST redaction through the new seam, preserving the exact
  on-the-wire `"***"` output and the SQL-empty-password / REST-Option-presence nuances.
- Add a `'''Secret redaction'''` doc block to `Connector.scala`'s trait comment (alongside the
  existing four blocks: `'''Refresh semantics'''`, `'''ExecutionContext'''`, `'''Schema inference'''`,
  `'''Fetch-error envelope'''`).
- Extend `DataSourceProtocolSpec` with assertions on the **actual serialized JSON** of a response
  (not just a helper's return value), so a redaction seam that "runs" but is bypassed at the response
  boundary would fail a test.

## Capabilities

### New Capabilities

- `connector-secret-redaction`: the `SecretField`/`HasSecrets`/`SecretRedaction`/`SecretBackend`
  centralization seam, its mechanical forget-proofing, and the `inline` backend.

### Modified Capabilities

(none — the existing `rest-api-connector` spec's "Credentials are never returned in API responses"
requirement describes observable behavior, which this change reproduces byte-identically; only the
implementation mechanism changes.)

## Impact

- `backend/src/main/scala/com/helio/services/`: new `SecretField.scala` (or similarly named) module.
- `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala`: `redactSqlPayload`/
  `redactRestPayload`/`redactRestAuth` are replaced by calls to `SecretRedaction.redact`; the response
  case classes' `config` field types are unchanged (`SqlSourceConfigPayload`/`RestApiConfigPayload`).
- `backend/src/main/scala/com/helio/domain/Connector.scala`: doc comment only, no behavior change.
- `backend/src/test/scala/com/helio/api/protocols/DataSourceProtocolSpec.scala`: new JSON-level
  redaction assertions added; existing tests unmodified.
- No schema/migration changes, no new env vars, no CLAUDE.md production-env table changes.

## Non-goals

- Any non-inline `SecretBackend` implementation (GCP Secret Manager, envelope encryption, encrypted
  columns) — HEL-536.
- Per-connector secret declarations for connectors not yet built (Sheets, BigQuery, Snowflake, S3,
  webhooks) — their own tickets (424/427/428) wire into this seam later.
- Any change to `SourceService`'s dispatch, `Connector[Config]` SPI methods, or non-redaction wire
  shape.
