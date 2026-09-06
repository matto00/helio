## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Spawned cold; every finding below is derived from the files/probes named, not from the round-1
report or the revision's own prose.

**CR1 (host-authority hole) — substantively fixed.** I re-ran the probe against the *revised*
rule (charset gate `[A-Za-z0-9.\-:\[\]]` + round-trip identity, scratchpad `U3.java`):

```
evil.test/@internal   GATE-REJECT      evil.test#@internal  GATE-REJECT
evil.test?x@internal  GATE-REJECT      a:b@internal         GATE-REJECT
host,other            GATE-REJECT      "evil test"          GATE-REJECT
[::1]:5432  getHost=[::1]      identity=false -> Invalid
evil.test:5432 getHost=evil.test identity=false -> Invalid
169.254.169.254 / evil.test    identity=true  -> resolved+judged
```
All three demonstrated authority-injection forms and the mysql comma-failover form are now
rejected *before* any parse, and the two residual `:`/bracket shapes that survive the charset
gate are caught by the identity check. Task 1.3 additionally requires a test that the exact
string validated is the exact string interpolated into the JDBC URL — which is the property that
was actually missing in round 1. The false "the multi-arg URI constructor rejects malformed
hosts" claim is explicitly withdrawn in `design.md` Decision 1, not quietly edited away. I also
confirmed the other two interpolated fields cannot re-point the destination: `SqlSourceConfig`
(`model.scala:486-494`) types `port` as `Int`, and `database`/`dialect` land after the authority
in `buildJdbcUrl` (`SqlConnectorDriver.scala:47-53`), so neither can move the host. Accepted.

**CR3 — fixed.** Task 8.1 now covers create-time *and* connect-time breakage, carries the
seven-spec enumeration verbatim, and requires independent re-derivation plus a stated count.

**CR4 — fixed.** Decision 4b records the vacuity finding with its two citations, and task 8.1a
requires a grep re-verification with the "if an update path IS found it needs the same guard"
branch stated.

**Decision 2's chokepoint claim — independently confirmed.** `grep DriverManager.getConnection`
across `backend/src/main` returns exactly one hit (`SqlConnectorDriver.scala:59`), and
`testConnection` (:134) / `execute` (:71) / `inferSchema` (:146, via `execute`) / `fetch` (:156,
via `execute`) all funnel through `connect`. The spec delta's "every SQL operation" scenario is
therefore true, not aspirational.

**Decision 4 (no pinning) — re-checked, still honest.** Unchanged from round 1's accepted
finding; `checkEgress`'s `addresses.exists(...)` multi-record block is real
(`ContentSourceSupport.scala:207`), so the stated mitigation is accurate.

**CR2 (test-injection seam) — addressed in form, but the specified mechanism does not exist for
the paths that need it. This is the blocker.** Decision 4a says: thread defaulted params through
`connect`/`checkEgress` and the public methods "where the `ConnectorDriver` trait permits", and
"where the trait signature cannot carry the parameter, the override is supplied **at
construction**". `SqlConnectorDriver` is an `object`, not a class
(`SqlConnectorDriver.scala:12`) — there is no construction, so that fallback is null for exactly
the three trait-bound methods (`fetch`, `testConnection`, `inferSchema`) it is written to cover.
And those are not hypothetical: `InProcessPipelineEngine.scala:645` calls
`SqlConnectorDriver.fetch(...)`, `SourceService.scala:177,285` and `PipelineService.scala:1525`
call `SqlConnectorDriver.inferSchema(...)`, all as direct object calls with no override channel.
`InProcessPipelineEngineSpec` starts a real EmbeddedPostgres and drives it through that
`fetch` (`InProcessPipelineEngineSpec.scala:67-81`, `host = "localhost"`), so it is broken by the
guard and cannot be repaired by either specified seam. Decision 4a's own forbidden list (mutable
global / system property / env var) is precisely what an executor under gate pressure reaches for
here, and task 8.1 hands them that pressure with no mechanism.

### Verdict: REFUTE

### Change Requests

1. **Resolve the seam contradiction for the trait-bound and object-call paths.** Decision 4a's
   fallback ("supplied at construction") is impossible: `SqlConnectorDriver` is a singleton
   `object` (`SqlConnectorDriver.scala:12`). Specify the actual mechanism for `fetch` /
   `testConnection` / `inferSchema`, whose call sites (`InProcessPipelineEngine.scala:645`,
   `SourceService.scala:177,285`, `PipelineService.scala:1525`) are plain object calls. The
   obvious resolution is to add the same defaulted `resolveHost` / `isBlocked` parameters to the
   `ConnectorDriver` trait methods themselves (Scala trait methods take defaults, so this is
   source-compatible for every existing caller and every other implementation) and to thread an
   override through `InProcessPipelineEngine`'s constructor to its `fetch` call. Whatever is
   chosen, state it in `design.md` and add it to task 2a — the current text asserts a fallback
   that cannot be executed.

2. **State how the loopback-using engine/route specs are actually repaired.** Task 8.1 requires
   the sweep but names no remediation. `InProcessPipelineEngineSpec.scala:67-81` reaches a live
   EmbeddedPostgres via `SqlConnectorDriver.fetch`; `PipelineRunRoutesSpec:289,305` and
   `PipelineApplyProposalRollbackSpec:82,162` go through routes into the same path. Say
   explicitly that these are repaired by the CR1-above seam (an admit-the-known-test-host
   `isBlocked` override injected through the engine/service), and re-state that deleting,
   `ignore`-ing, or rewriting such a spec to avoid the guard is not an acceptable repair — a
   fixture edited to make the suite pass is a symptom, not a fix.

3. **Pin down the URI construction form; task 1.4 is unsatisfiable under one reading.** Task 1.4
   requires that `::1` "round-trips correctly rather than being refused as a mismatch", but
   Decision 1 describes `checkEgressHost` as synthesising an authority and delegating to
   `checkEgress`, which parses a *URL string* with the single-arg `new URI(url)`
   (`ContentSourceSupport.scala:189`). My probe: `new URI("https://::1")` yields `getHost=null`
   → `Invalid`, whereas the multi-arg constructor yields `[::1]`. Both are fail-closed, but only
   the multi-arg form satisfies task 1.4. Name the constructor used, and state which string
   (`host` or `uri.getHost`) is handed to `resolveHost` — I confirmed
   `InetAddress.getAllByName("[::1]")` resolves, so either works, but the choice must not be
   left to the executor inside a security guard.

### Non-blocking notes

- The charset gate also excludes `_`, so a host like `my_db.internal` becomes `Invalid`. The
  single-arg `URI` parse already rejects it and the REST path behaves identically, so this is a
  consistent extension of accepted behaviour rather than a new break — worth one line in the
  design so it is a decision rather than a surprise.
- Decision 2 names the new method `SqlConnectorDriver.checkEgress`, which shadows
  `ContentSourceSupport.checkEgress` at a glance; a distinct name (`checkConfigEgress`) would
  read better next to the existing `checkQuery`.
- The follow-up-ticket requirement for the socket-factory pin now correctly demands a *named*
  ticket in the PR body. Good; hold the executor to it.
