## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Ground truth read, not narrative.** `ContentSourceSupport.scala` (`isBlockedAddress`,
  `defaultResolveHost`, `checkEgress`, `EgressCheck`, `pinnedTransport`),
  `SqlConnectorDriver.scala` (`buildJdbcUrl` lines 47–53, `connect` 55–58, no egress check
  anywhere), `SourceService.createSql` (lines 49–71 — only `checkQuery`, then insert). The
  ticket's premise holds: zero egress validation on the SQL path.

- **Decision 1's authority-injection claim — REFUTED empirically.** Design says the
  multi-argument `java.net.URI(scheme, userInfo, host, port, path, query, fragment)` constructor
  "rejects a malformed host rather than reinterpreting it", naming `evil.test/@internal` as an
  injection it prevents. I ran that exact constructor (`/tmp/U.java`, JDK on this machine):

  ```
  host=[evil.test/@internal]   -> uri=https://evil.test/@internal   getHost=evil.test  reparse=evil.test
  host=[evil.test#@internal]   -> uri=https://evil.test#@internal   getHost=evil.test  reparse=evil.test
  host=[evil.test?x@internal]  -> uri=https://evil.test?x@internal  getHost=evil.test  reparse=evil.test
  host=[a:b@internal]          -> EX URISyntaxException (Illegal character in user info)
  host=[evil.test:80@internal] -> EX URISyntaxException (Illegal character in user info)
  host=[under_score.test]      -> EX URISyntaxException (Illegal character in hostname)
  host=[::1]                   -> uri=https://[::1] getHost=[::1]      (note: brackets added)
  ```
  It does NOT reject a host containing `/`, `#` or `?`; it silently reinterprets the tail as
  path/fragment/query and yields `getHost=evil.test`. So `checkEgressHost` as designed would
  validate `evil.test` while `buildJdbcUrl` interpolates the *raw* string
  `evil.test/@internal` into the JDBC URL — the guard checks a different destination than the
  one connected to. The one specific example the design cites as proof of safety is the one
  that gets through.

- **Decision 4 (no pinning) — checked and found honest.** `backend/build.sbt:205`
  `org.postgresql:postgresql:42.7.13`, `:226` `com.mysql:mysql-connector-j:8.3.0` — the versions
  cited. The pgjdbc `socketFactory`/`socketFactoryArg` (`javax.net.SocketFactory`) vs.
  mysql-connector-j `socketFactory` (`com.mysql.cj.protocol.SocketFactory`) asymmetry is stated
  accurately, and the `case other =>` dialect branch really does exist
  (`SqlConnectorDriver.scala:52`), so "no hook can be assumed" is true. The IP-literal-rewrite
  rejection (breaks `sslmode=verify-full` and vhost routing) is a correct technical reason, not
  an effort excuse. The residual DNS-rebinding statement is accurate — `checkEgress` really does
  use `addresses.exists(...)`, so the "any record internal blocks" mitigation is real. This is
  AC3's sanctioned alternative, properly discharged. **Not a cop-out. I accept Decision 4.**

- **Decision 5 test strategy — sound in shape, but unexecutable as written (see CR2).** The
  red-before-fix step (2.2) is real: `SqlConnectorDriverSpec` already proves the fixture reaches
  a live EmbeddedPostgres on loopback (`liveConfig` at :33–41, used by `testConnection` :197 and
  `execute` :210/:222). The mutation check with a typed `SqlEgressRefusedException` is the right
  mechanism for "red for the right reason". Per-class + DNS-name + multi-record coverage matches
  AC1/AC2.

- **Regression-sweep scope — under-enumerated.** `grep` for SQL configs pointing at loopback in
  `backend/src/test/`: `SqlConnectorDriverSpec:36`, `InProcessPipelineEngineSpec:76`,
  `AuditMutationInstrumentationSpec:1108`, `PipelineAnalyzeProposalRoutesSpec:149`,
  `PipelineRunRoutesSpec:289,305`, `PipelineApplyProposalRollbackSpec:82,162`,
  `DataSourceRoutesSpec:964`. Several of these never *open* a connection — they only **create**
  a SQL source through `SourceService.createSql`, which Decision 3 now makes a `400`. Task 8.1's
  scope ("every existing spec that opens a SQL connection to loopback") misses them.

- **Injection seam does not exist.** `SqlConnectorDriver.execute(config, maxRows)`,
  `fetch(config, maxRows, ctx)`, `testConnection(config, ctx)`, `inferSchema(config, ctx)` take
  no `resolveHost`/`isBlocked` (the last three are fixed by the `ConnectorDriver` trait), and
  `SourceService`'s constructor (`SourceService.scala:29–39`) has no such parameter either —
  unlike the REST path, where specs already thread an override
  (`DataSourceRoutesSpec:85,214`, `RestApiConnectorDriverSpec:87`). Tasks 6.2 and 8.1 assume a
  seam that the design never specifies.

- **AC1 "or updated": no SQL config-update path exists.** The only `SqlSource` mutation outside
  create is a rename (`DataSourceService.scala:552`, `PatchSetPreviewProjection.scala:227`);
  `grep` finds no `updateSql`. Inline proposal creation funnels through `createSql`
  (`PipelineProposalService.scala:344–351`), so create really is a single chokepoint. The design
  never records this, leaving half an AC apparently unaddressed.

### Verdict: REFUTE

### Change Requests

1. **Fix Decision 1's host-authority handling; the stated safety property is false.** The
   multi-arg `URI` constructor accepts `evil.test/@internal`, `evil.test#@internal` and
   `evil.test?x@internal`, returning `getHost=evil.test` while the raw string still flows into
   `buildJdbcUrl` — the guard would validate a different host than the one connected to. Revise
   `design.md` Decision 1 (and add a task) to require an explicit **round-trip identity check**
   or a strict host charset gate: after constructing the URI, refuse unless the extracted
   `getHost` equals the caller-supplied `host` (normalising the IPv6 bracket form — the probe
   shows `::1` comes back as `[::1]`). Equivalently, reject any host containing characters
   outside `[A-Za-z0-9.\-:\[\]]` before construction. Note in the design that `,` (mysql
   multi-host failover URLs), `/`, `?`, `#`, `@` are all specifically in scope. Add a task-4
   test case per rejected form asserting `Invalid`, and a test that the string used to build the
   JDBC URL is the same string that was validated. Remove or correct the claim that the
   constructor "rejects a malformed host" — it does so only for some forms, and the design must
   not rest on the disproven ones.

2. **Specify the test-injection seam; tasks 6.2 and 8.1 cannot be executed without it.**
   `execute`/`fetch`/`testConnection`/`inferSchema` have no `resolveHost`/`isBlocked` parameters
   (three are trait-fixed), and `SourceService` takes none in its constructor. State in
   `design.md` exactly how the admit-the-known-test-host override reaches `connect` and
   `createSql` — e.g. additional defaulted parameters threaded through the driver's public
   methods plus a defaulted constructor parameter on `SourceService` wired from `ApiRoutes`,
   mirroring the existing REST pattern at `DataSourceRoutesSpec:85`. Explicitly forbid the
   improvisation this gap invites: a mutable global/system-property test hook that is reachable
   in production. Without this the executor will invent a mechanism under time pressure, in a
   security guard.

3. **Widen the regression sweep to create-time, and enumerate it.** Task 8.1 covers only specs
   that *open* a connection. Decision 3 also breaks specs that merely create a SQL source with a
   loopback host. Name them in the task so a "zero found" is impossible to claim:
   `SqlConnectorDriverSpec:36`, `InProcessPipelineEngineSpec:76`,
   `AuditMutationInstrumentationSpec:1108`, `PipelineAnalyzeProposalRoutesSpec:149`,
   `PipelineRunRoutesSpec:289,305`, `PipelineApplyProposalRollbackSpec:82,162`,
   `DataSourceRoutesSpec:964` — and require the executor to re-derive the list rather than trust
   this one.

4. **Record the AC1 "or updated" finding explicitly.** Add one line to `design.md` stating that
   no SQL config-update path exists (only rename, `DataSourceService.scala:552`) and that
   inline proposal creation routes through `SourceService.createSql`
   (`PipelineProposalService.scala:344–351`), so create-time is genuinely a single chokepoint.
   Add a task to verify that by grep at implementation time. As written, half of AC1 looks
   silently dropped.

### Non-blocking notes

- Decision 1's `checkEgressHost` signature does not say which scheme it synthesises. `https` is
  the obvious choice given `checkEgress`'s scheme gate; naming it removes an ambiguity.
- The blocked-class tests (4.1) all run through an injected resolver and never touch
  `DriverManager`. That is correct and hermetic, but it means the *only* end-to-end proof the
  guard stops a real connection is task 2.2/3.3. Worth stating so nobody weakens that pair later.
- Decision 4's follow-up ("should be tracked as a follow-up") names no ticket. A deferral that
  names no real task tends to evaporate; file or reference one in the PR body.
