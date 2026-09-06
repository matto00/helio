## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Backend-only judgement. No Playwright, no e2e, no dev server (per run constraint; the change has no
frontend surface — `git diff --stat main...HEAD` touches zero `frontend/**` files).

### What I verified (with evidence)

**Chokepoint reachability (question 1) — traced myself, holds.**
`grep -rn "DriverManager\|getConnection\|jdbc:" backend/src/main` returns exactly ONE
`DriverManager.getConnection`, at `SqlConnectorDriver.scala:107`, inside `connect`, and `connect` now
runs `checkConfigEgress(..., failOnUnresolvable = true)` before it. Every other SQL entry point
(`execute`, `testConnection`, `inferSchema`, `fetch`, and through them `SourceService.{createSql,
inferSql, testSql, refreshSql, previewSql}`, `ConnectionTest.run`, `CreateSourceEnvelope.build`,
`PipelineService:1534`, `InProcessPipelineEngine:651`) funnels into it. No path bypasses it.

The seam is fail-safe by construction: `resolveHost`/`isBlocked` default to
`ContentSourceSupport.defaultResolveHost` / `isBlockedAddress` at *every* level, so a call site that
forgets to thread them still gets the real guard — a permissive override must be passed
*deliberately*. I checked production wiring: `app/Main.scala:199` constructs `ApiRoutes` without
`sqlUrlResolveHost`/`sqlUrlIsBlocked`, so production runs real DNS + the real denylist. Overrides
appear only in specs.

**AC1 "or updated" — vacuous, correctly.** `UpdateDataSourceRequest` is `(name: Option[String])`
(`DataSourceProtocol.scala:129`); the only `SqlSource` construction from user input is
`SourceService.scala:73`, and `PipelineProposalService.resolveSqlSource:348` funnels the inline-proposal
create through `createSql`. Design Decision 4b re-verified independently.

**Mutation check (question 2).** Read `evidence/task-7-mutation-check-RED.txt` myself. The red is
`Right(List(Map("one" -> 1))) was not an instance of scala.util.Left ... (SqlConnectorEgressGuardSpec.scala:69)`
— the refusal assertion itself, not a timeout/missing-driver/fixture error. The one-test blast radius is
exactly what a `connect`-call-site mutation should produce: the task-4 class matrix calls
`checkConfigEgress` directly and is by construction unaffected. Judged adequate, and not
under-proven: those `checkConfigEgress`-level tests are shown load-bearing by the permanently-encoded
inverse assertion in the spec (`isBlocked = (_,_) => false` ⇒ `Right`), and the paired
`task-2.2-ssrf-reachable.txt` transcript shows the *same* test previously passing as "currently succeed
and return rows" against the EmbeddedPostgres instance — so the fixture demonstrably reaches the
network and nothing here passes vacuously.

**REST refactor (question 3) — behaviour-preserving, verified.** The `checkResolvedHost` extraction is
verbatim, and `checkEgress`'s call site uses the default `noun = "URL host"`, so every message string is
byte-identical. `RestConnectorEgressGuardSpec` is untouched by the diff and I ran it: 7 create classes +
7 update classes + the `pinnedTransport` TCP-pin test + the bare-url infer/test matrix, all green. The
one way the extraction could have weakened REST invisibly — silently dropping the multi-A-record
`addresses.exists(...)` rule — did not happen (it is in the extracted body, and `SqlConnectorEgressGuardSpec`
adds a multi-record test).

**Full backend gate, run by me:** `sbt -batch test` → `Tests: succeeded 3873, failed 0` /
`Suites: completed 255, aborted 0`, exit 0 (270 s). Compile clean.

**AC3 / Decision 4 (question 4) — defensible and honestly stated.** AC3 explicitly authorises
"unpinned + documented". The accounting is complete and technically correct: pgjdbc's
`javax.net.SocketFactory` vs mysql-connector-j's own `com.mysql.cj.protocol.SocketFactory`, the
unbounded `case other =>` dialect branch with no assumable hook, and the rejected IP-literal rewrite
(breaks `sslmode=verify-full` and vhost routing — a real AC4 regression, not an effort excuse). The
residual DNS-rebinding TOCTOU is stated plainly, with its mitigating factors labelled "none of which are
a fix", and the asymmetry against the REST path is called out rather than glossed. I found nothing
material omitted.

**AC4 (question 5) — proven, not asserted.** `SqlConnectorEgressGuardSpec` "should actually connect
end-to-end and return rows when isBlocked admits the known test host" opens a REAL JDBC connection to
EmbeddedPostgres via unmodified DNS (only `isBlocked` overridden) and asserts `rows.head("one") ==
JsNumber(1)`. That test stayed green under the task-7 mutation, which is the correct signature for an
AC4 test. Green in my own run.

### Verdict: REFUTE

One gap, and it is squarely inside the owner's stated bar rather than a nit.

### Change Requests

1. **Task 5.2 is marked `[x]` but is not implemented, and the spec scenario it covers has zero tests.**
   `tasks.md` §5.2 reads "Test rejection at create time for each blocked class, and that nothing is
   persisted on rejection", and the added spec delta
   (`specs/sql-database-connector/spec.md`) declares the scenario *"Creating a SQL data source with an
   internal host is rejected … AND no data source is persisted"*. No such test exists anywhere:
   `grep -rn "createSql" backend/src/test` finds only happy-path calls, and
   `grep -rn "Egress refused" backend/src/test` hits only `SqlConnectorEgressGuardSpec.scala:66,73`
   (the *connect*-time test). The task-4 class matrix calls `SqlConnectorDriver.checkConfigEgress`
   directly with the **connect-time** disposition (`failOnUnresolvable` defaulted to `true`) and never
   touches `SourceService` or `DataSourceRepository`, so it does not exercise
   `SourceService.scala:68`'s create-time call, its `ServiceError.BadRequest` mapping, or the
   ordering that keeps `dataSourceRepo.insert` (line 81) from running. Deleting the entire
   create-time guard block from `createSql` would turn **no** test red — the connect-time guard would
   still refuse, but the row would be **persisted** and the caller would get a 200 with a
   `fetchError`, directly contradicting the spec scenario and AC1's "cannot be created".
   Add a `SourceServiceSpec`- (or route-) level test asserting `createSql` with a host resolving to
   each blocked class returns a `BadRequest` **and** leaves the repository empty. `RestConnectorEgressGuardSpec`'s
   "reject a baseUrl resolving to …, persisting nothing" block is the exact template, and
   `SourceServiceSpec` already has the `sqlResolveHost`/`sqlIsBlocked` injection points it needs.

2. **A doc comment asserts coverage that does not exist — correct it (or delete it) once CR1 lands.**
   `SqlConnectorEgressGuardSpec.scala:20-22` states create-time behaviour is
   *"exercised at the `checkConfigEgress` level here — the `SourceService`-level create-time behaviour
   is covered by `SourceServiceSpec`"*. It is not: the only HEL-952 change to `SourceServiceSpec` is
   `admitLocalhostSql`, which **admits** a host so pre-existing tests keep passing — it proves nothing
   about rejection. A comment pointing a future reader at coverage that isn't there is worse than no
   comment. Also un-tick `tasks.md` §5.2 until it is true.

### Non-blocking notes

- `design.md` Decision 4 binds the delivery step: *"the PR must name a concrete follow-up ticket for the
  per-dialect socket-factory pin rather than deferring to an unnamed 'follow-up' — a deferral that names
  no task evaporates."* `proposal.md:41-42` currently says only "a follow-up recommended", and no ticket
  id exists for the pin (HEL-953 is the error-channel change, HEL-954 the `admitLocalhost` hoist). File
  and name it before the PR body is written; this is the design's own requirement, not a new one.
- `PipelineService.scala:1528-1532` reaches through `Option(sourceService)` for `svc.sqlResolveHost` /
  `svc.sqlIsBlocked`, which is why those two `SourceService` constructor params had to become `val`s.
  It works and its `None` branch falls back to the real defaults, but it is a Law-of-Demeter reach that
  will read oddly later; threading the pair into `PipelineService`'s own constructor (as `ApiRoutes`
  already does for every other collaborator) would be tidier. Not blocking — no behavioural difference.
