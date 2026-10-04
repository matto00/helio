## Standing Constraints

- [C1] Red-before-fix: the connection-count measurement (N sequential requests) and the pinning test must be shown failing on unfixed/mutated code, with transcripts, not only passing after.
- [C2] Pinning proof must go red under a hostname-keyed cache mutation and under a single-shared-settings mutation.
- [C3] Backend gate is `nice -n 19 sbt testFull` (never bare `sbt test`), Bash timeout 600000, at most 3-4 parallel workers, everything at nice -n 19; `sbt --client shutdown` as its own call.
- [C4] Known flakes (FirstRunRoutesSpec / 1s RouteTest timeouts, PanelCard.test.tsx:625, ProductEventRollupServiceSpec) are rerun, never "fixed".

## 1. Backend — measurement first

- [x] 1.1 Add a connection-counting local test server helper and a test that issues 10 sequential `fetchUrl` calls and 10 REST `issueAndParse` calls (via the driver's public fetch) and asserts connections < 10; run on unfixed code and record the RED count (expect 10)
- [x] 1.2 Add the two-server (127.0.0.1 / 127.0.0.2, same port) pinning test with resolver answers A, B, A asserting responses A, B, A; verify it passes on unfixed code (pinning already holds per request); bind A on port 0 then B on that port, fall back to ::1, and skip-with-reason (never silently pass) if neither binds; also count connections per address so a new-pool-per-request mutation is red too

## 2. Backend — fix

- [x] 2.1 Cache pinned `ConnectionPoolSettings` per validated `InetAddress`, scoped per ActorSystem, bounded (design Decisions 1-2; comment that eviction orphans a live pool until its idle shutdown); verify 1.1 turns green
- [x] 2.2 Set explicit `maxConnections`/`maxOpenRequests`/`keepAliveTimeout` on pinned settings (Decisions 4-5); verify with a concurrency test of 40 parallel requests to one host completing
- [x] 2.3 Keep `validateAndResolve` per request in `fetchUrl` and `guardedPoolSettings`; update doc comments on `pinnedTransport`/`pinnedPoolSettings`/`fetchUrl`; verify by reading the diff that no validation is cached

## 3. Tests — mutation evidence

- [x] 3.1 Mutate the cache key to the hostname; verify 1.2 goes RED; revert and record transcript
- [x] 3.2 Mutate to one shared settings object for all addresses; verify 1.2 goes RED; revert and record transcript
- [x] 3.3 Add a test that a host previously served from a cached pool, now resolving to a blocked address, is refused before connect; verify green
- [x] 3.4 Re-grep `services/sources` and `domain/connectors` specs for server restarts on a fixed port; run `nice -n 19 sbt testFull` and verify green (rerun known flakes only)
