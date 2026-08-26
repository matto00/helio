## Why

Every audit row currently records `source=ui` and a null `actor_token_id` regardless of how the
caller actually authenticated, so the audit trail cannot distinguish a browser session from a
PAT-authenticated script or the MCP server — the exact provenance a security audit trail exists to
capture (HEL-435 epic).

## What Changes

- `AuthenticatedUser` gains a `source: AuditSource` and `tokenId: Option[ApiTokenId]` carried from
  the point of credential resolution, replacing per-call-site hardcoded `AuditSource.Ui`/`None`.
- `ApiTokenRepository.findUserByTokenHash` is extended to also resolve the token id (mirroring the
  existing `findPrincipalByTokenHash` pattern from HEL-369), so PAT-authenticated requests know
  which token authenticated them.
- `AuthDirectives.resolveIdentity`/`resolveApiToken` set `source=Ui` for session-cookie resolution
  and `source=Pat` for bearer-token resolution.
- All 15 existing `auditService.record(...)` call sites read `source`/`tokenId` from the resolved
  `AuthenticatedUser` instead of hardcoding `AuditSource.Ui`/`None`.
- No reliable MCP-vs-PAT signal exists today (no dedicated token label, scope, or User-Agent header
  helio-mcp sets) — MCP-authenticated calls are recorded as `pat`, matching the ticket's documented
  fallback; `AuditSource.Mcp` already exists in the model for a future ticket to wire once such a
  signal exists.
- Revocation/deletion of a token already leaves `actor_token_id` as a soft, unconstrained
  reference (no FK) per the existing `V91__audit_events.sql` schema — verified, not changed.

## Capabilities

### New Capabilities
- `audit-actor-attribution`: defines how the acting credential's source (`ui`/`pat`) and resolving
  token id are threaded from identity resolution into every recorded audit event.

### Modified Capabilities
(none — `audit-mutation-instrumentation` and `audit-event-recording` describe the record contract
and per-action event shape, which are unchanged; only the *values* passed into `record` change)

## Impact

- `backend/src/main/scala/com/helio/domain/model/model.scala` (`AuthenticatedUser`)
- `backend/src/main/scala/com/helio/api/http/AuthDirectives.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/auth/ApiTokenRepository.scala`
- 15 service files under `backend/src/main/scala/com/helio/services/**` that call
  `auditService.record(...)`
- ScalaTest coverage for both credential paths (`AuthDirectivesSpec`/service specs)
