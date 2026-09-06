# Design — HEL-952 SQL connector egress guard

## Context

`SqlConnectorDriver.connect` is the sole place a JDBC connection is opened for a caller-configured SQL source. Every
SQL operation reaches it: `execute` (used by `previewSql` and by `InProcessPipelineEngine`), `testConnection`,
`inferSchema`, and `fetch`. The host it connects to comes from `SqlSourceConfig.host`, a non-secret field the caller
sets freely. Nothing between the API boundary and `DriverManager.getConnection` inspects it.

HEL-879 already built the policy this needs, in `ContentSourceSupport`:

- `isBlockedAddress(addr)` — loopback, link-local (covers `169.254.0.0/16`), RFC1918/site-local, IPv6 ULA `fc00::/7`,
  any-local, multicast.
- `defaultResolveHost(host)` — real DNS, injectable for tests.
- `checkEgress(url, resolveHost, isBlocked)` — returns the `EgressCheck` ADT (`Allowed` / `Invalid` / `Unresolvable` /
  `Disallowed`), and critically already blocks when **any** resolved address is blocked (`addresses.exists(...)`), not
  just the first — the multi-A-record defence is already there.

## Decisions

### Decision 1 — Reuse the policy through a host-level entry point; validate the *exact* host string

`checkEgress` takes a URL, and a JDBC destination is a bare host. Add:

```scala
def checkEgressHost(host: String,
                    resolveHost: String => Try[Array[InetAddress]] = defaultResolveHost,
                    isBlocked: (String, InetAddress) => Boolean = (_, addr) => isBlockedAddress(addr)): EgressCheck
```

**Corrected after design-gate round 3 (CR3).** Earlier drafts said `checkEgressHost` "delegates to the existing
`checkEgress` core." **There is no such core** — `checkEgress` (`ContentSourceSupport.scala:184-213`) is monolithic: it
parses the URL with the single-arg `URI`, gates the scheme, and then resolves `uri.getHost`. Delegating to it as-is
would resolve `uri.getHost`, contradicting this decision's own pin that the *caller-supplied* host is what gets
resolved.

So this change **refactors `checkEgress` to create the core it was assumed to have**, without altering its behaviour:

```scala
// extracted verbatim from checkEgress's existing resolve-and-classify block
private[sources] def checkResolvedHost(host: String, resolveHost: ..., isBlocked: ...): EgressCheck
```

`checkEgress(url, ...)` keeps its exact current behaviour by calling `checkResolvedHost(uri.getHost, ...)` after its
existing parse and scheme gate. `checkEgressHost(host, ...)` performs the charset gate and round-trip identity check
below, then calls `checkResolvedHost(host, ...)` with the **caller-supplied** host. The address-class policy
(`isBlockedAddress`), the `addresses.exists(...)` multi-record rule, and the curated message strings all live in that
one extracted block and are shared verbatim. **No policy is duplicated** — but this is a refactor of
`ContentSourceSupport`, not a purely additive change, and the existing `ContentSourceSupportSpec` /
`RestConnectorEgressGuardSpec` must pass unchanged to prove the extraction was behaviour-preserving.

**Construction form, pinned (round-2 CR3).** `checkEgressHost` SHALL use the **multi-argument**
`java.net.URI(scheme, userInfo, host, port, path, query, fragment)` constructor, not the single-arg
`new URI(urlString)` form that `checkEgress` uses internally — the single-arg form yields `getHost=null` for
`https://::1` (fail-closed, but it would make a bracketed IPv6 literal permanently unusable), whereas the multi-arg
form yields `[::1]`. The string handed to `resolveHost` SHALL be the **caller-supplied `host`**, not `uri.getHost`,
so that what is resolved is exactly what `buildJdbcUrl` interpolates; the round-trip check below is what guarantees
those two agree in the first place. This is stated here rather than left to the executor because it is a security
guard.

**Corrected after design-gate round 1 (CR1).** An earlier draft of this decision claimed the multi-argument
`java.net.URI(scheme, userInfo, host, port, path, query, fragment)` constructor "rejects a malformed host rather than
reinterpreting it," and cited `evil.test/@internal` as an injection it prevents. **That claim was false and is
withdrawn.** The skeptic ran the constructor and it does not reject that form — it silently reinterprets the tail:

```
host=[evil.test/@internal]   -> uri=https://evil.test/@internal   getHost=evil.test
host=[evil.test#@internal]   -> uri=https://evil.test#@internal   getHost=evil.test
host=[evil.test?x@internal]  -> uri=https://evil.test?x@internal  getHost=evil.test
host=[a:b@internal]          -> URISyntaxException (illegal user info)
host=[under_score.test]      -> URISyntaxException (illegal hostname)
host=[::1]                   -> getHost=[::1]   (brackets added)
```

Relying on that would have been the whole bug again: the guard would validate `evil.test` while `buildJdbcUrl`
interpolated the raw `evil.test/@internal` into the JDBC URL — **checking a different destination than the one
connected to.**

**The actual requirement, therefore, is an identity check, not a parse.** `checkEgressHost` SHALL refuse unless the
host it validated is character-for-character the host that will be interpolated into the JDBC URL. Concretely, both of:

1. A strict charset gate applied to the raw string *before* construction: refuse any host containing a character
   outside `[A-Za-z0-9.\-:\[\]]`. **Note (round-2 non-blocking):** this also excludes `_`, so `my_db.internal`
   becomes `Invalid`. That is deliberate and consistent — the single-arg `URI` parse already rejects underscored hosts
   and the REST path behaves identically, so this extends accepted behaviour rather than introducing a new break. This puts `/`, `?`, `#`, `@`, whitespace, and — specifically — `,` (mysql
   Connector/J multi-host failover URLs, which would otherwise smuggle a second, unvalidated destination) out of
   bounds.
2. A round-trip identity assertion after construction: `uri.getHost` must equal the supplied host, normalising the
   IPv6 bracket form (`::1` comes back as `[::1]`), and anything else is `Invalid`.

Both, not either — the charset gate is the primary defence and the round-trip is the backstop that fails closed if the
charset gate is ever loosened.

**Assumption stated (product owner away):** a host that fails either check is refused rather than sanitised. Fail-closed
and trivially reversible.

### Decision 2 — Enforce at connect time, inside `connect`

`connect` is the one chokepoint. Guarding there covers `execute` / `fetch` / `inferSchema` / `testConnection`
simultaneously and cannot be bypassed by a future caller that forgets to validate, which is exactly the failure mode
that produced this ticket.

The guard is factored as a testable function returning an `Either`, and `connect` throws on the `Left`:

```scala
def checkConfigEgress(config: SqlSourceConfig, ...): Either[String, Unit]
def connect(config: SqlSourceConfig, ...): Connection  // throws SqlEgressRefusedException on Left
```

Connect time **fails closed on `Unresolvable`** as well as `Disallowed` and `Invalid`: an unresolvable host cannot be
connected to under any circumstance, so there is no behaviour to preserve, and collapsing it to a refusal keeps the
branch exhaustive.

A dedicated `SqlEgressRefusedException` carrying the refusal message is thrown rather than a bare
`RuntimeException`, so the mutation check below can assert the test fails *for the right reason*, and so HEL-953 has a
typed thing to map to a 4xx later. This ticket does **not** change the outward error shape — the existing
`.toEither.left.map` handlers still collapse it to `"SQL connection failed"` / `"SQL execution failed"` on the wire.

### Decision 3 — Also enforce at create time, tolerating `Unresolvable`

`SourceService.createSql` validates the host before persisting, so a bad host is a `400 BadRequest` at authoring time
rather than a confusing runtime failure later. This mirrors HEL-879's `ConnectorEntityService.create/update`.

Create time treats `Disallowed` and `Invalid` as fatal but **`Unresolvable` as acceptable** — a source naming a
not-yet-provisioned host, or created during a transient DNS blip, must still be creatable. AC1 requires refusing a host
that *resolves to* blocked space, not one that merely fails to resolve. Connect time (Decision 2) still refuses it, so
nothing escapes.

This create-time check is a UX and defence-in-depth layer only. **The connect-time check is the security boundary**,
because a persisted host is re-resolved on every use and create-time validation alone would be a pure TOCTOU — the
insufficiency HEL-215 already established.

### Decision 4 — The JDBC connection is NOT pinned; residual risk stated

AC3 offers "pinned to the validated address, **or** the inability to pin explicitly documented with the residual risk
stated." This change takes the second option, deliberately, and here is the full accounting the ticket asks for.

**Why the REST mechanism does not transfer.** `ContentSourceSupport.pinnedTransport` works because Pekko HTTP exposes
`ClientTransport.withCustomResolver`, letting the guard hand the connection pool an already-resolved
`InetSocketAddress`. JDBC has no such seam: `DriverManager.getConnection` hands the URL to the driver, which resolves
the hostname and opens its own socket.

**Socket-factory hooks, as the ticket asked us to check.** Both first-class drivers do expose one, but neither is a
drop-in:

- pgjdbc (`org.postgresql:postgresql:42.7.13`) accepts a `socketFactory` connection property naming a
  `javax.net.SocketFactory` subclass, plus a single `socketFactoryArg` string.
- mysql-connector-j (`com.mysql:mysql-connector-j:8.3.0`) accepts a `socketFactory` property, but against its **own**
  `com.mysql.cj.protocol.SocketFactory` interface, not `javax.net.SocketFactory`.
- The `case other =>` branch of `buildJdbcUrl` accepts an arbitrary dialect string, for which **no** hook can be
  assumed to exist.

So a pin would mean two separate driver-specific factory implementations, a per-dialect registry, a static/reflective
instantiation contract (the factory is constructed by the driver, not by us, so the validated address has to be
threaded through a global keyed by `socketFactoryArg`), and *still* no coverage for an unknown dialect — which would
then need to be refused outright, a behaviour regression against AC4. Rejected as disproportionate to the residual
risk, and as a security change large enough to deserve its own review.

**A rewrite-the-URL-to-the-literal-IP pin was also considered and rejected.** It is dialect-agnostic and eliminates the
second lookup, but it breaks TLS hostname verification (`sslmode=verify-full` against an IP literal) and any
virtual-host routing, which is a live regression risk against AC4 "legitimate external database hosts continue to
work." Refused on those grounds, not on effort.

**Residual risk, stated plainly.** Between `checkEgressHost`'s resolution and the driver's own resolution there is a
DNS-rebinding TOCTOU window. An attacker who controls authoritative DNS for a hostname, and can make it answer with a
public address on the guard's lookup and an internal address on the driver's lookup milliseconds later, can still reach
an internal database port. Mitigating factors, none of which are a fix: the guard blocks if *any* returned A/AAAA
record is internal, so the attacker needs a clean single-record public answer; the attack requires attacker-controlled
authoritative DNS with a near-zero TTL; and the reward is a connection to something that must then speak the Postgres
or MySQL wire protocol and accept the supplied credentials, which is a far narrower target than REST's "any HTTP
endpoint." **This is strictly better than the status quo, which is no guard at all**, and it is materially weaker than
the REST path's guarantee. That asymmetry is intentional, documented in the spec delta, and should be tracked as a
follow-up rather than left implicit.

### Decision 4a — The test-injection seam is specified here, not improvised by the executor

Design-gate CR2. The blocked-class tests need to inject a fake `resolveHost`, and the "legitimate host still works"
test needs an `isBlocked` override admitting one known test hostname. **That seam does not currently exist on the SQL
path**: `SqlConnectorDriver.execute(config, maxRows)` takes no such parameters, and `fetch`/`testConnection`/
`inferSchema` are fixed by the `ConnectorDriver` trait signature. `SourceService`'s constructor takes none either.

**Corrected after design-gate round 2 (CR1).** An earlier draft said that where the trait signature cannot carry the
parameter, "the override is supplied at construction." **That is impossible and is withdrawn**: `SqlConnectorDriver` is
a singleton `object` (`SqlConnectorDriver.scala:12`), so there is no constructor to supply anything to, and the
trait-bound methods that actually break are called as plain object calls (`InProcessPipelineEngine.scala:645`,
`SourceService.scala:177,285`, `PipelineService.scala:1525`). Leaving that contradiction in place is precisely the
pressure that produces the forbidden global.

The seam SHALL therefore be:

1. **Defaulted `resolveHost` / `isBlocked` parameters added to the `ConnectorDriver` trait methods themselves**
   (`fetch`, `testConnection`, `inferSchema`).

   **Corrected after design-gate round 3 (CR1).** An earlier draft claimed this is "source-compatible for every
   existing call site and every other implementation — nothing else has to change." **That is false for
   implementations and is withdrawn.** The round-3 skeptic compiled it under scalac 2.13.15: a default argument helps
   *callers*, not *implementers*, so widening a trait method breaks every existing override with
   `object creation impossible. Missing implementation for member of trait`. Every implementation must be widened in
   the same commit: `RestApiConnectorDriver.scala:58`, and the three test doubles
   `NewConnectorInferenceSpec.scala:25`, `ConnectorSpec.scala:19`, `CreateSourceEnvelopeSpec.scala:30`. The executor
   must re-derive this list (`grep` for `extends ConnectorDriver`) rather than trust it. Call sites are genuinely
   unaffected — that half of the original claim holds.
2. The same defaulted parameters on `SqlConnectorDriver.connect` / `checkConfigEgress` / `execute`.
3. A **defaulted constructor parameter** on `SourceService`, wired from `ApiRoutes` — this one is a class, so
   construction genuinely works here. Mirrors the REST pattern (`DataSourceRoutesSpec:85,214`,
   `RestApiConnectorDriverSpec:87`).
4. An override threaded through **`InProcessPipelineEngine`'s constructor** to its `fetch` call site, so engine-level
   specs can admit their known test host.
5. **Corrected after design-gate round 3 (CR2).** `SourceService` does not call the driver directly on the create and
   test paths — it goes through two generic intermediaries the earlier drafts never mentioned:
   `CreateSourceEnvelope.build` (`SourceService.scala:65`) and `ConnectionTest.run` (`SourceService.scala:220`).
   Neither takes an override, so a `SourceService`-level `isBlocked` cannot reach the `inferSchema` that actually
   opens the connection. **Both intermediaries must take the same defaulted `resolveHost` / `isBlocked` parameters and
   forward them to the driver**, or the seam is decorative. The executor must trace the create path end to end and
   demonstrate the override actually arrives at `connect` — an assertion that the override was *passed* is not proof
   it was *used*.

**Explicitly forbidden:** a mutable global, a system property, an environment variable, or any other ambient test hook
that is reachable in production. A guard whose enforcement can be switched off by process-global state is not a guard.
If the executor finds no clean way to thread the seam, that is an escalation, not a licence to improvise.

### Decision 4b — AC1's "or updated" is satisfied because no SQL update path exists

Design-gate CR4. AC1 says "created or updated". There is **no** SQL config-update path: the only `SqlSource` mutation
outside create is a rename (`DataSourceService.scala:552`, `PatchSetPreviewProjection.scala:227`), and inline proposal
creation funnels through `SourceService.createSql` (`PipelineProposalService.scala:344-351`). So `createSql` is
genuinely a single create-time chokepoint and the "or updated" half of AC1 is vacuous rather than dropped. The executor
must re-verify this by grep at implementation time and record the result — if an update path is found, it needs the
same guard.

### Decision 5 — Test strategy: prove it blocks, and prove the fixture is real

The acceptance bar is that the guard is *shown* to block, so the spec is built around a real reachable target, not a
mock.

1. **EmbeddedPostgres as the SSRF target.** The new `SqlConnectorEgressGuardSpec` starts its own EmbeddedPostgres on
   loopback (no Flyway migration, no shared dev database, no e2e). Loopback is a genuine member of the blocked set, so
   this is a real SSRF demonstration and not a simulation of one.
2. **Red before green.** Before the guard is wired in, the spec must demonstrate that `SqlConnectorDriver.execute`
   against that loopback instance **succeeds and returns rows** — i.e. the SSRF is currently reachable. That transcript
   is recorded. After the guard, the same call is refused. A fixture that could never have reached the database in the
   first place proves nothing, so this step is mandatory and its output must be captured, not asserted from memory.
3. **Each blocked class separately** (AC1 requires this, not one representative): loopback `127.0.0.1`, link-local
   `169.254.169.254`, private `10.0.0.1` / `192.168.1.1` / `172.16.0.1`, IPv6 loopback `::1`, and IPv6 ULA. Driven
   through an injected `resolveHost` so no real DNS is needed and the spec is hermetic.
4. **DNS names that resolve to internal space** (AC2): an injected resolver maps a `.test` hostname to each internal
   address, proving the guard checks the *resolved* address and is not string-matching `"localhost"`.
5. **AC4, legitimate hosts still work**: a resolver mapping a `.test` hostname to a public address returns `Allowed`,
   and — using the `isBlocked` override that admits only the known test hostname (the established HEL-879 pattern) —
   a real connection to the EmbeddedPostgres instance still succeeds end to end. This is what proves the guard refuses
   *because of the policy* rather than refusing everything.
6. **Mutation check.** Disable the guard (neutralise the refusal branch), re-run, and confirm the blocking tests go red
   **on the refusal assertion** — not on a connection timeout, a missing driver, or a fixture error. A red for the
   wrong reason is recorded and discarded, and the mutation is retried until it fails for the right reason or the
   test is rewritten. Restore afterwards and confirm green.
7. **Regression sweep — connect-time AND create-time.** Design-gate CR3: the sweep must cover not only specs that
   *open* a loopback connection but also specs that merely **create** a SQL source with a loopback host, which
   Decision 3 now turns into a `400`. The round-1 skeptic enumerated: `SqlConnectorDriverSpec:36`,
   `InProcessPipelineEngineSpec:76`, `AuditMutationInstrumentationSpec:1108`, `PipelineAnalyzeProposalRoutesSpec:149`,
   `PipelineRunRoutesSpec:289,305`, `PipelineApplyProposalRollbackSpec:82,162`, `DataSourceRoutesSpec:964`. The
   executor must **re-derive this list independently rather than trust it**, and state the count found; a silent zero
   is impossible to claim against this enumeration.

8. **The only end-to-end proof is tasks 2.2/3.3.** The blocked-class tests run through an injected resolver and never
   touch `DriverManager` — correct and hermetic, but it means the single proof that the guard stops a *real*
   connection is the red-then-green loopback pair. That pair must not be weakened or deleted by any later cycle.

## Risks

- **Existing loopback-based SQL specs break.** Expected and handled by Decision 5.7. This is the guard working.
- **A self-hosted deployment legitimately pointing at a private-range database.** Real, and shared with the REST path
  already shipped in HEL-879 — this change does not introduce a new class of breakage, it extends an accepted one. An
  allowlist escape hatch is deliberately not invented here; it belongs to a deployment-configuration ticket where it
  can be designed once for both paths.
- **Residual DNS-rebinding TOCTOU.** Decision 4, stated in full.

## Open question carried to the PR (not escalated)

Whether the residual unpinned window is acceptable indefinitely, or whether the per-dialect socket-factory pin should
be scheduled, is a product/security judgement. AC3 authorises shipping unpinned-and-documented, so this run proceeds on
that authority rather than parking. It is flagged in the PR body for the owner rather than decided silently, and the
PR must name a concrete follow-up ticket for the per-dialect socket-factory pin rather than deferring to an unnamed
"follow-up" — a deferral that names no task evaporates.
