## 1. Red first
- [x] 1.1 Add rebinding tests (postgresql via embedded Postgres, mysql via a counting loopback listener plus real driver wiring) that fail on unmodified main because the loopback listener accepts a connection; record the red output

## 2. Implementation
- [x] 2.1 Verify the real driver reflection contracts (pgjdbc 42.7.13 `socketFactory`/`socketFactoryArg`, mysql-connector-j 8.3.0 `com.mysql.cj.protocol.SocketFactory`) against the jars; record findings in design.md
- [x] 2.2 Implement the pgjdbc `SocketFactory` subclass and the mysql `SocketFactory` implementation validating the InetAddress being connected to, plus the `connectIsBlocked` ThreadLocal predicate (D2), validating Socket subclass (D1)
- [x] 2.3a Shared `validateConfigShape` (dialect + database pattern); call it from every SQL-config create/validate path (SourceService, PipelineService, PipelineProposalService, assistant/codec paths) with a test per path; test that database=\"x?socketFactory=...\" cannot bypass the guard (mutation-failable)
- [x] 2.3 Wire the factories into `buildJdbcUrl`/`connect`; refuse unknown dialects (typed exception) at connect and 4xx at create (D3)
- [x] 2.4 Enumerate every JDBC open site; prove the app pool and `PipelineRunNotifyBus` do not use the factory
- [x] 2.5 Update the `outbound-egress-guard` spec delta (already drafted) and remove the stale residual-risk comment in `SqlConnectorDriver.connect`

## 3. Verification
- [x] 3.1 Factory unit tests (blocked, allowed, unresolved), unknown-dialect tests (create 4xx, connect refusal), existing `SqlConnectorEgressGuardSpec`/`SqlConnectorDriverSpec` updated
- [x] 3.2 TLS proof: pgjdbc `sslmode=require` through the factory (D4), mysql stated precisely
- [x] 3.3 Mutation: remove the factory's blocked-address check, show the new tests red, restore
- [x] 3.4 Read-only dev-DB inventory of SQL connectors by dialect (exact SELECTs)
- [x] 3.5 Full backend gate `cd backend && nice -n 19 sbt testFull`

## Design-gate round-2 notes (binding for execution)
- [x] N1 `SqlConnectorDriver.connect` walks the exception cause chain and rethrows the typed `SqlEgressRefusedException` (pgjdbc wraps in PSQLException, mysql in SQLException); tests assert the typed refusal, not a generic failure
- [x] N2 Pin/assert `loginTimeout=0` (no pgjdbc thread hop) or record the fail-closed fallback
- [x] N3 database whitelist via `matches`/`\\z`; test a trailing-newline case
- [x] N4 Close the unconnected validating socket on refusal (mysql address loop)
- [x] N5 Keep TLS fallback wording if embedded Postgres cannot do certs

## Standing Constraints
- [C1] Backend gate is `cd backend && nice -n 19 sbt testFull` (never bare `sbt test`), one full suite at a time; known flakes (HEL-1228/1225, HEL-1215, HEL-1247) are reported by name.
- [C2] Dev DB access is read-only with exact SELECTs; any cleanup uses exact ids only, never disabling triggers/FKs, never `pgrep -f`/`pkill -f`. No production or gcloud actions; no real external DNS/network in tests.
- [C3] Red-first on unmodified main and a mutation proving failability; the factory must validate the InetAddress being connected to, never re-resolve the hostname.
