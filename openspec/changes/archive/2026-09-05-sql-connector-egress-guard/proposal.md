## Why

`SqlConnectorDriver` interpolates a caller-supplied host into a JDBC URL and connects, with no egress validation at any
point. An authenticated caller can aim a SQL data source at loopback, `169.254.169.254`, or RFC1918 space and use the
query results as an exfiltration channel. HEL-879 closed exactly this hole for the REST connector and explicitly left
this one open and ticketed rather than doubling a security diff. The shared policy it built
(`ContentSourceSupport.isBlockedAddress` / `checkEgress`) already exists and is reusable as-is.

## What Changes

- Refactor `ContentSourceSupport.checkEgress` to extract its resolve-and-classify block as a shared
  `checkResolvedHost` core (behaviour-preserving; the existing egress specs must pass unchanged), then publish a
  host-level entry point `checkEgressHost(host, resolveHost, isBlocked)` on top of that same core. No new denylist, no
  second policy, no change to `isBlockedAddress`.
- Widen the `ConnectorDriver` trait's `fetch` / `testConnection` / `inferSchema` with defaulted `resolveHost` /
  `isBlocked` parameters, updating every implementation (a default argument does not spare implementers), and forward
  them through `CreateSourceEnvelope.build` and `ConnectionTest.run` so the override reaches `connect`.
- Enforce the guard **at connect time** inside `SqlConnectorDriver.connect` — the single chokepoint every SQL path
  (`execute`, `fetch`, `inferSchema`, `testConnection`) already funnels through. Fails closed, including on an
  unresolvable host, because there is no address to connect to anyway.
- Enforce the guard **at create time** in `SourceService.createSql`, so a bad host is a `400` at authoring time rather
  than a runtime failure. Create-time tolerates `Unresolvable` (a not-yet-provisioned host stays creatable), matching
  the disposition HEL-879 established for `ConnectorEntityService.create/update`.
- Document, in `design.md` and in the spec, that the JDBC connection is **not** pinned, why the REST pin does not
  transfer, and the exact residual risk that leaves — per the ticket's own AC3, which sanctions this alternative.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `outbound-egress-guard`: the shared policy now governs a non-HTTP (JDBC) destination, and the pinning requirement
  gains an explicitly-scoped, justified exemption for JDBC.
- `sql-database-connector`: creating a SQL data source, and connecting for any SQL operation, are refused when the host
  resolves into blocked address space.

## Non-goals

- **Pinning the JDBC socket.** Deferred with the residual risk stated (see `design.md` Decision 4); the per-dialect
  socket-factory pin that would close it is tracked as HEL-998. `AC3` explicitly permits this.
- Changing the error *channel* (an egress refusal still surfaces as the driver's existing failure shape) — that is
  HEL-953's job, and is deliberately not folded in here.
- Hoisting the duplicated `admitLocalhost` test helper — that is HEL-954.
- Any Flyway migration, any frontend change, any e2e/Playwright work.

## Impact

- `backend/src/main/scala/com/helio/services/sources/ContentSourceSupport.scala` (**refactor** — extracts a shared
  core — plus the new entry point; not additive-only)
- `backend/src/main/scala/com/helio/domain/connectors/ConnectorDriver.scala` and every implementation of the trait
- `CreateSourceEnvelope` / `ConnectionTest` / `InProcessPipelineEngine` (override forwarding)
- `backend/src/main/scala/com/helio/domain/connectors/SqlConnectorDriver.scala` (connect-time guard)
- `backend/src/main/scala/com/helio/services/sources/SourceService.scala` (create-time guard)
- New spec `backend/src/test/scala/com/helio/domain/connectors/SqlConnectorEgressGuardSpec.scala`
- No migration, no API-shape change, no dependency change.
