## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read the round-1 report (`skeptic-design-1.md`) and commit `65dd693d` (`git show --stat`)
  to see the actual diff addressing it: `design.md` (+33), `specs/connector-spi/spec.md` (+16/-2),
  `tasks.md` (+32/-18, net rewrite of §1.1/2.2/2.3/2.4/3.2/3.3/3.4).
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/connector-spi/spec.md` in full
  as they stand now (not the round-1 versions).

### Round-1 change request: resolved

- `design.md` now has **Decision 6** (lines 70-101): explicitly states `testConnection`,
  `inferSchema`, `fetch` each carry `(implicit ec: ExecutionContext)`, caller-supplied, never
  `ExecutionContext.global`. It re-derives the same asymmetry the round-1 report flagged
  (`RestApiConnector` self-derives an EC from its `ActorSystem`; `SqlConnector` is a stateless
  `object` that depends entirely on the caller supplying one) and gives the same resolution the
  change request asked for, with matching rigor to the other five Decisions.
- Verified against ground truth, not just the doc's claim:
  - `backend/src/main/scala/com/helio/domain/SqlConnector.scala:48-49` — `execute(config, maxRows)
    (implicit ec: ExecutionContext)`, wraps blocking JDBC in `Future { blocking { ... } }(ec)`.
    Matches Decision 6's description exactly.
  - `backend/src/main/scala/com/helio/domain/RestApiConnector.scala:17,21` — `class
    RestApiConnector(...)(implicit system: ActorSystem[_])` with `private implicit val ec:
    ExecutionContext = system.executionContext`. Matches Decision 6's description exactly.
  - `backend/src/main/scala/com/helio/services/SourceService.scala:30-33` — `final class
    SourceService(...)(implicit ec: ExecutionContext)`, confirming the EC-threading pattern Decision
    6 says the trait must preserve.
- `specs/connector-spi/spec.md` now has the trait's method signatures with `(implicit ec:
  ExecutionContext)` baked into the Requirement text (lines 4-9) and a dedicated scenario
  ("Trait methods accept a caller-supplied ExecutionContext", lines 16-20) asserting no
  implementation sources an EC internally — this is a testable, spec-level guardrail, not just
  design-doc prose.
- `tasks.md` threads `(implicit ec)` through every task that touches a `Future`-returning method:
  §1.1 (trait declaration, explicitly forbids `ExecutionContext.global`), §2.3/2.4 (SqlConnector
  `testConnection`/`inferSchema`/`fetch`, explicitly says "use the caller-supplied `ec`, never
  `ExecutionContext.global`"), §3.3/3.4 (RestApiConnector, explicitly notes the parameter "shadowing
  the class's own private `ec`" — correctly anticipates the identifier-shadowing question rather
  than leaving it for the implementer to discover under compiler pressure).
- The round-1 non-blocking note (missing `displayName` values) is also addressed: `tasks.md` §2.2
  now names `displayName = "SQL Database"`, §3.2 names `displayName = "REST API"`.
- Confirmed no other undisclosed drift crept in during the revision: `git show 65dd693d` touches
  only `design.md`, `specs/connector-spi/spec.md`, `tasks.md` (plus the round-1 report itself);
  `proposal.md` and `ticket.md` are untouched, and the sibling-ownership map, non-goals, and
  scope sections are unchanged from round 1.

### Re-verification of the rest of the design (fresh pass, not carried over from round 1)

- **Config type shapes exist as claimed**: `backend/src/main/scala/com/helio/domain/model.scala:185`
  (`SqlSourceConfig`), `:210` (`RestApiConfig`), `:276` (`InferredSchema`) all present and match the
  design's references.
- **No placeholders**: grepped `TODO|TBD|figure out later` across all five artifacts — zero hits.
- **Sibling scope containment**: `design.md`'s "Sibling ownership map" (lines 103-111) names the same
  five tickets as `ticket.md`'s "Epic context" (HEL-473/468/460/480/484) against the same concerns
  (facade dispatch, error-envelope unification, redaction, connection-test endpoint, registry
  aggregation) — no sibling scope pulled forward, matches round-1 finding, still holds.
- **Extensibility for the 5 siblings without a breaking rewrite** (the orchestrator's specific ask
  this round): traced each sibling against the trait shape as now specified —
  - HEL-473 (schema-inference facade): will call the trait polymorphically; Decision 6 explicitly
    calls out that HEL-473 "MUST keep threading its own `(implicit ec)`" — the EC parameter is
    additive to callers, not a breaking change to the trait shape itself.
  - HEL-468 (fetch-error envelope): operates on the `Either[String, ...]` already returned by
    `fetch`/`testConnection`/`inferSchema` — no trait-shape change implied.
  - HEL-460 (secret redaction): stays in `DataSourceResponse.fromDomain` per AC; doesn't touch the
    trait at all.
  - HEL-480 (connection-test endpoint): calls `testConnection` from a route handler, which already
    has an actor-derived EC in scope per Decision 6's own text (lines 96-97) — additive, no rewrite.
  - HEL-484 (registry): enumerates `Connector[_]` existentials for `metadata` only, doesn't invoke
    the `Future`-returning methods (Decision 6, line 97-98) — untouched by the EC decision, and
    `ConnectorMetadata` as a flat case class is a reasonable minimal surface for aggregation.
  - No signature in the trait as currently specified (`testConnection`/`inferSchema`/`fetch`/
    `metadata`, all generic over `Config`) requires widening in a way that would break an existing
    implementer; new connectors add a fifth type argument to `Connector[Config]`, not a trait
    rewrite. This satisfies the epic-context ask.
- **No behavior change to existing paths**: `proposal.md`'s "Modified Capabilities" section is
  explicitly empty ("none ... this change is purely additive"); `design.md` Non-Goals explicitly
  defer `SourceService` call-site wiring to HEL-473; `tasks.md` §4.4 lists the exact existing test
  suites (`DataSourceServiceSpec`, `DataSourceServiceRestartPersistenceSpec`, `DataSourceRoutesSpec`,
  `SqlConnectorSpec`, `SchemaInferenceRegressionSpec`) as a gate for zero-regression — all five files
  confirmed to exist under `backend/src/test/scala/com/helio/` in round 1 and unchanged since (no
  test-tree diff in `65dd693d`).
- **CONTRIBUTING.md compliance**: no inline FQNs anywhere in the design/tasks text (ticket explicitly
  reiterates this rule at `ticket.md:18` and `:54`, design honors it); file-size budget (~250
  lines/file) not at risk — `Connector.scala` is a small new file, `SqlConnector.scala`/
  `RestApiConnector.scala` gain a handful of delegating lines each.

### Verdict: CONFIRM

### Non-blocking notes

- None beyond what round 1 already raised and is now resolved.
