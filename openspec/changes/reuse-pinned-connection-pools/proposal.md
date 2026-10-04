## Why

Every pinned outbound request (REST connector fetch/test, and `fetchUrl` behind CSV/text/PDF/image URL ingestion)
builds a fresh `ClientTransport` and `ConnectionPoolSettings`, so Pekko's pool cache never matches and each request
materializes a new host pool and opens a new TCP (and TLS) connection. That is wasted handshakes and pool actors per
request. The fix must not weaken the HEL-215/879 DNS-rebinding guarantee that the connection goes to exactly the
address that was validated.

## What Changes

- Pinned pool settings are reused per validated address (and per actor system), so sequential requests to the same
  host that validate to the same address share one Pekko pool and its keep-alive connections.
- A host that validates to a different address gets a different pool; no connection pinned to one address can ever
  serve a request validated to another.
- Validation (resolve + denylist check) still runs on every request; only the transport/pool object is reused.
- Pool limits on the shared pinned pools are set explicitly so concurrent requests to one host are not newly refused
  by the default per-pool queue limit.
- New tests: a red-before-fix connection-reuse measurement, and a pinning test that fails under a hostname-keyed cache.

## Capabilities

### New Capabilities

### Modified Capabilities
- `outbound-egress-guard`: adds a requirement that pinned connections are reused only for the same validated address.

## Non-goals

- Changing the egress denylist, the resolve-once rule, or redirect handling.
- Re-attributing HEL-1245 (closed; root cause was Cloud Run CPU throttling).
- Restructuring entity consumption (the ticket's "and/or" second suggestion) — assessed in design only.
- The unpinned clients (HttpResendEmailSender, HttpClaudeTransport, OAuthRoutes), which already share settings.

## Impact

- `backend/.../services/sources/ContentSourceSupport.scala` (`pinnedPoolSettings`, `fetchUrl`).
- `backend/.../domain/connectors/RestApiConnectorDriver.scala` (`guardedPoolSettings` caller; behaviour via the helper).
- Backend tests under `services/sources` and `domain/connectors`. No API, schema, migration, or frontend change.
