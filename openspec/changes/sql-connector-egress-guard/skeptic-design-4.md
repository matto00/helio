## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Read fresh: ticket.md, proposal.md, design.md, tasks.md, both spec deltas. Verified against the
worktree source, not against prior reports.

**CR1 — trait widening breaks implementations.** `grep -rn "extends ConnectorDriver"` returns exactly
four implementations: `RestApiConnectorDriver.scala:58`, `SqlConnectorDriver.scala:12` (the object under
change), and test doubles `ConnectorSpec.scala:19`, `NewConnectorInferenceSpec.scala:25`,
`CreateSourceEnvelopeSpec.scala:30`. Design Decision 4a.1 and task 2a.1 now state plainly that a default
argument spares callers but not implementers, enumerate that same list, and require the executor to
re-derive it by grep. Substantively correct against ground truth. Resolved.

**CR2 — the seam must reach `connect` through the intermediaries.** Confirmed both intermediaries are
real and both currently lack any override: `CreateSourceEnvelope.build` (`CreateSourceEnvelope.scala:31`,
calls `connector.inferSchema(config, ConnectorResolveContext.Owned(user))` at line 40) and
`ConnectionTest.run` (`ConnectionTest.scala:22`), invoked from `SourceService.scala:65` and `:220`
respectively. Design 4a.5 and task 2a.2a now require both to take and forward the defaulted parameters,
and require the executor to demonstrate the override *arrives at* `connect` rather than merely being
passed. Resolved.

**CR3 — `checkEgress` had no core to delegate to.** Read `ContentSourceSupport.checkEgress` in full: it
is monolithic (single-arg `URI` parse → scheme gate → `Option(uri.getHost)` → a resolve-and-classify
`match` producing `Unresolvable` / `Disallowed` / `Allowed`). That inner block is exactly what Decision 1
and task 1.0 now require extracting as `checkResolvedHost(host, resolveHost, isBlocked)`, with
`checkEgress` calling it with `uri.getHost` and `checkEgressHost` with the caller-supplied host, and with
`ContentSourceSupportSpec` / `RestConnectorEgressGuardSpec` required to pass unchanged as the
behaviour-preservation proof. proposal.md's What-Changes and Impact both now label this a refactor, not
additive-only. Resolved.

**Whole-plan re-judgement.** Also checked afresh:
- Create-time `Unresolvable` tolerance is coherent with the code: `SourceService.createSql` inserts the
  source *before* `CreateSourceEnvelope.build`, and `build` folds an `inferSchema` `Left` into
  `fetchError` rather than failing the create — so "creatable but not connectable"
  (spec scenario 3, task 5.3) is actually achievable and not self-contradictory.
- AC coverage: AC1 → tasks 4.1/5.1/5.2 plus Decision 4b's argument that "or updated" is vacuous (with a
  required re-grep); AC2 → 4.2; AC3 → Decision 4, which states the non-pin and the DNS-rebinding residual
  risk concretely rather than hand-waving; AC4 → 6.1/6.2. No AC untraced.
- Run constraints honoured: no Flyway migration, no Playwright/e2e, `.test` hosts only, EmbeddedPostgres
  fixture, red-before-green plus a right-reason mutation check, and an explicit ban on repairing broken
  specs by deletion/`ignore`/routing around the guard.
- No mutable-global/system-property test hook; the forbidden alternatives are named and an escalation is
  the stated fallback if no clean seam exists.
- The withdrawn round-1/2 false claims (multi-arg `URI` "rejects" malformed hosts; construction-time
  override on a singleton `object`) are recorded as withdrawn with the correct behaviour in their place.

I found no remaining false claim, contradiction, unresolved placeholder, or uncovered AC. The remaining
open items are implementation-level and belong to the executor and the final gate.

### Verdict: CONFIRM

### Non-blocking notes
- The extracted `checkResolvedHost` will carry `checkEgress`'s existing message strings, which read
  "URL host '$host' resolves to a disallowed address" / "Could not resolve host". Verbatim reuse is
  correct for behaviour preservation, but "URL host" is slightly off for a bare JDBC host; executor's
  judgement whether to parameterise the noun.
- The charset gate excludes `_`, so `my_db.internal` becomes `Invalid`. Design argues this matches the
  existing single-arg `URI` behaviour on the REST path. Accepted, but worth a line in the PR body since
  underscored internal DB hostnames are not rare.
- tasks.md 2a.1 contains a garbled fragment ("Also add them to and to `SqlConnectorDriver.connect`").
  Cosmetic; the intent is unambiguous.
