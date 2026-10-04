## Context

See proposal.md — Why. Ground truth (main @ 9a57f7aa):
- `ContentSourceSupport.pinnedTransport(addr)` returns `ClientTransport.withCustomResolver(lambda)`; the result is a
  case class (`ClientTransportWithCustomResolver`) whose equality is the lambda's reference equality, so every call
  is unequal. `pinnedPoolSettings(addr)` wraps it in fresh `ConnectionPoolSettings` (connect 10s, idle 30s).
- Pekko HTTP 1.1.0 `Http().singleRequest(req, settings = s)` routes through the pool master keyed on
  `(host, port, ConnectionPoolSetup(settings, connectionContext, log))`. Unequal settings => a new pool per request.
  Pools idle-shut after `host-connection-pool.idle-timeout` (30s), so this is churn, not an unbounded leak.
- Callers: `fetchUrl` (ContentSourceSupport.scala:347; also serves `CsvUrlFetch.fetch` and DataSourceService
  text/pdf/image URL paths) and `RestApiConnectorDriver.guardedPoolSettings` (RestApiConnectorDriver.scala:328) for
  `issueAndParse`/`issueTest`. Unpinned clients (Resend, Claude, OAuth) already share settings — out of scope.
- Pekko defaults per pool: `max-connections = 4`, `max-open-requests = 32`, `keep-alive-timeout = infinite`,
  `response-entity-subscription-timeout = 1s`. Today each request has its own pool, so these never bind.
- Existing pinning test: ContentSourceSupportSpec "pin the real TCP connection to the resolved address" — single
  resolution, so it does NOT discriminate a hostname-keyed pool cache. A new discriminating test is required.

## Goals / Non-Goals

**Goals:** reuse pools/connections per validated address; keep pinning + SSRF semantics byte-for-byte; prove both
with red-before-fix / mutation-red evidence. **Non-Goals:** see proposal.md; no change to `validateAndResolve`,
`checkEgress`, `isBlockedAddress`, redirect handling, or size limits.

## Decisions

1. **Cache the pinned `ConnectionPoolSettings` per validated `InetAddress`, scoped per ActorSystem.** `pinnedPoolSettings`
   returns the same settings instance for the same address, so Pekko's own pool cache matches and reuses the pool.
   Key is the validated `InetAddress` (value equality on address bytes), never the hostname: a pool's transport
   connects only to the address it was built for, so a hit can only ever send traffic to an address that was
   validated for the current request. Scope per ActorSystem (a small Pekko `Extension`, or a map keyed by the classic
   system) because settings are derived from that system's config and pools live in that system's `Http` extension;
   a process-global map would leak one test system's config into another. Alternatives: (a) hostname-keyed cache —
   rejected, it would route a request validated to B over a pool pinned to A (the exact hazard AC2 forbids, and if a
   default-transport pool were shared it would re-resolve at connect, reopening the rebinding TOCTOU); (b) a single
   `superPool`/`cachedHostConnectionPool` flow per host — rejected, same keying problem plus a bigger refactor.
2. **Bounded cache.** Cap entries per system (e.g. 256) with eviction (LRU or clear-on-overflow). A miss only
   costs a new pool, so eviction can never affect correctness; the cap stops growth from caller-controlled distinct IPs.
3. **Validation is never cached.** `validateAndResolve` still runs per request before the settings lookup; the cache
   is consulted with its result. A host that rebinds to a blocked address is refused before any pool is touched.
4. **Explicit pool limits on pinned settings.** Set `maxConnections` (proposed 16) and `maxOpenRequests` (proposed 256,
   must be a power of two) so a burst of concurrent fetches to one public API (multi-user pipeline runs) is not newly
   rejected with `BufferOverflowException` ("Request failed") by the 32-request default — today's per-request pools
   never hit that limit, so keeping defaults would be a regression. Executor verifies with a concurrency test.
5. **Short pool `keepAliveTimeout` (proposed 4s).** A reused idle connection the server already closed fails a
   non-idempotent request (REST connector sends POST bodies; Pekko only retries idempotent methods). Keeping idle
   connections below common server keep-alive defaults (Node/Apache 5s) bounds that race while still reusing
   connections within a pipeline run's burst. Connection `idleTimeout` 30s / connect 10s unchanged.
6. **Measurement before fix (systematic-debugging law).** Count server-side TCP connections (e.g. a Pekko test server
   bound via `connectionSource()` counting materialized connections, or a counting raw socket server) for N=10
   sequential `fetchUrl` and REST `issueAndParse` calls. Expected red on main: 10 connections; green: < 10 (ideally 1).
   The test must be committed and shown failing on unfixed code (stash the fix), not only passing after.
7. **Pinning mutation test.** Two loopback servers on the same port, `127.0.0.1` and `127.0.0.2` (Linux binds the
   whole 127/8), each returning its own identity. Resolver for `rebind-test.invalid` answers A, then B, then A. Assert
   responses come from A, B, A, and that each address's pool is reused. Must go RED under a mutation keying the
   cache by hostname, and under a mutation returning one shared settings object; transcripts of both mutations go
   in the executor's evidence. If `127.0.0.2` cannot bind in CI, fall back to `127.0.0.1` vs `::1`.

## HEL-1245 bearing (AC4)

The "Response entity was not subscribed after 1 second" error fires when a response's entity is not subscribed
within `response-entity-subscription-timeout`; both callers subscribe via `toStrict` inside a `Future.flatMap` hop,
so dispatcher latency (HEL-1245: Cloud Run CPU throttling) delays it. That timeout is per response and independent of
pool identity — pool-per-request neither causes nor prevents it. Pool-per-request adds per-request pool
materialization and TCP/TLS handshake CPU, which could only marginally add load under throttling; no evidence it did.
With a shared pool an unsubscribed entity holds one pool connection for up to that 1s, delaying queued requests to the
same destination — a bounded blast-radius change worth noting, not a new failure. Moving entity consumption into the
same stage is a separate change and is out of scope.

## Risks / Trade-offs

- [Hostname-keyed regression in future edits] → mutation-proven test (Decision 7) pins the keying.
- [Stale keep-alive on POST] → Decision 5; Pekko still retries idempotent requests.
- [Tests that restart a server on the same port within one ActorSystem may hit a stale pooled connection] → grep at
  design time found specs binding ephemeral ports per suite; executor re-greps `newServerAt`/`unbind` in
  `services/sources` + `domain/connectors` specs and runs the full suite. e2e (`e2e/`) does not exercise outbound
  fetches (the SSRF guard blocks loopback in the real app), so no e2e dependency.
- [Pool limits too low/high] → explicit values with a concurrency test; tunable later.

## Planner Notes

- Self-approved: limit values (16/256/4s) and cache cap; no new dependency (no Caffeine), no API/schema change.
- Driver statements in the dispatch are treated as claims; premise validated against main 9a57f7aa (no drift).
