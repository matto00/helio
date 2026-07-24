## Context

`SqlConnector` (`domain/SqlConnector.scala`) is a stateless `object` with `connect`/`execute`/
`inferSchema`/`toRows`. `RestApiConnector` (`domain/RestApiConnector.scala`) is a class constructed
with an implicit `ActorSystem` exposing `fetch`/`toRows`. `SourceService` hand-dispatches per kind
(`createRest`/`createSql`/`inferRest`/`inferSql`/`refreshRest`/`refreshSql`). This is the first
ticket of the HEL-429 "Connector Framework Hardening" epic; five sibling tickets land on top of the
seam this ticket creates (see "Sibling ownership map" below) — the trait shape must survive all of
them without a breaking rewrite.

## Goals / Non-Goals

**Goals:**
- One `Connector[Config]` trait covering test/inferSchema/fetch, generic over each connector's own
  config type (no config supertype/boxing).
- `SqlConnector` and `RestApiConnector` both reachable as `Connector[_]` instances, proving the SPI
  against real connectors.
- Zero behavior change on existing `SourceService` paths — new trait methods are additive.
- Capability metadata surface minimal enough that HEL-484 (registry) can aggregate it without this
  ticket guessing at registry internals.

**Non-Goals:**
- Wiring `SourceService` to call through the trait instead of the concrete objects — deferred so
  this ticket carries zero behavioral risk. HEL-473 (schema-inference facade) is the natural point
  to do that swap once a facade needs polymorphic dispatch.
- A separate `refresh` method — see Decisions.
- Connector registry, connection-test endpoint, secret redaction, or error-envelope unification —
  each owned by a named sibling ticket (see map below).

## Decisions

**1. `trait Connector[Config]`, generic over config type — not a common config supertype.**
`SqlSourceConfig` and `RestApiConfig` share no fields. Boxing both behind `case class ConnectorConfig(raw:
JsValue)` (or similar) would force every implementation to re-parse/re-validate, duplicating
`SqlSourceConfigPayload`/`RestApiConfigPayload`'s existing job. A type-parameterized trait keeps
compile-time-checked access to each connector's own config while still giving callers a uniform
method surface once they hold a concrete `Connector[SqlSourceConfig]` etc. Registry aggregation
(HEL-484) works against `Connector[_]` existentials for enumeration/metadata, which don't need the
config type.

**2. `SqlConnector` and `RestApiConnector` implement the trait directly (add `extends Connector[X]`),
not via a separate wrapper class.** The ticket explicitly allows "keep the existing object/class if a
thin façade is cleaner" — direct implementation is the thinnest option and literally satisfies "both
reachable through it" without an extra indirection layer for siblings to trip over. Existing public
methods (`execute`, `toRows`, `checkQuery`, `fetch`, `doFetch`) are untouched; the new trait methods
are added alongside and implemented by delegating to them.

**3. `refresh` is documented on the trait, not a distinct method.** Both `SourceService.refreshSql`
and `.refreshRest` already implement refresh as "fetch again, upsert the DataType" — there is no
behavior to abstract yet. Adding a `refresh` method now would either (a) duplicate `fetch`'s
signature for no reason, or (b) hard-code "full re-fetch" into the SPI a ticket early, which HEL-428
(incremental/push ingestion) would then have to break. A doc comment on the trait states the default
semantics and defers the incremental case to HEL-428 by name.

**4. `testConnection` is a new, lightweight operation — not a call to the existing `fetch`/`execute`.**
SQL: open+immediately close a JDBC connection (no query execution) — cheaper than `execute`, and
proves auth without running the potentially-expensive stored query. REST: issue the same
request/auth/header pipeline as `fetch` but only inspect the response status, skip the
`body.parseJson` step — cheaper than a full fetch+parse, and reuses the exact auth-header logic so
"auth is valid" means the same thing in both places. Since this is new capability surface (no
existing `testConnection` today), there is no legacy behavior to preserve.

**5. `ConnectorMetadata(kind, displayName, supportsIncremental, authKind)` as a single case class,
`authKind: String`.** Ticket text says "keep the metadata surface minimal" and explicitly assigns
aggregation to HEL-484. A plain string (`"basic"` for SQL, `"configurable"` for REST, meaning
"per-request auth selectable by the caller") avoids introducing an `AuthKind` ADT this ticket would
be guessing the full enumeration for — HEL-484 can widen it to a sealed trait once it knows the
shape of 5 more connectors' auth needs.

**6. `testConnection`, `inferSchema`, and `fetch` each carry `(implicit ec: ExecutionContext)` —
caller-supplied, never sourced internally.** `RestApiConnector` is a class holding an implicit
`ActorSystem` and already derives its own `private implicit val ec = system.executionContext`
(RestApiConnector.scala:21), so it could satisfy any signature unaided. `SqlConnector`, however, is a
stateless `object` with no constructor: its existing `execute(config, maxRows)(implicit ec:
ExecutionContext)` (SqlConnector.scala:48-49) only compiles because every caller — currently
`SourceService`, itself `(implicit ec: ExecutionContext)` — supplies the EC, and `execute` wraps its
blocking JDBC work in `Future { blocking { ... } }(ec)` on that caller-supplied EC specifically so
blocking I/O doesn't starve the Pekko dispatcher. If the trait methods omitted the implicit EC
parameter, `SqlConnector`'s trait implementation would have no legal way to reach `execute`'s EC and
the only escape hatch would be `ExecutionContext.global` — silently reintroducing the blocking-pool-
starvation risk CLAUDE.md's "Avoid blocking operations in actor execution paths" rule exists to
prevent, in the same ticket that promises zero behavior change. So the trait signature is:
```scala
def testConnection(config: Config)(implicit ec: ExecutionContext): Future[Either[String, Unit]]
def inferSchema(config: Config)(implicit ec: ExecutionContext): Future[Either[String, InferredSchema]]
def fetch(config: Config, maxRows: Int)(implicit ec: ExecutionContext): Future[Either[String, Vector[JsValue]]]
```
`SqlConnector`'s implementation forwards the caller-supplied `ec` straight into `execute`/`connect`,
identical to today. `RestApiConnector`'s implementation accepts the same parameter (shadowing its own
private `ec` within the trait methods) so both connectors honor one calling convention — an
implementer or caller can't special-case one connector's EC sourcing over the other's.

**This is the pattern every sibling inherits.** HEL-473 (schema-inference facade) will call the
trait polymorphically across connector types and MUST keep threading its own `(implicit ec)` through
rather than letting any future connector default to a global pool. HEL-480 (connection-test endpoint)
will invoke `testConnection` from an HTTP route handler, which already has an actor-derived EC in
scope, and must pass it explicitly. HEL-484 (registry) enumerating `Connector[_]` existentials for
metadata does not call the Future-returning methods and is unaffected. Any new concrete connector
(424-428, implemented as a class with its own `ActorSystem` or as a stateless object like `SqlConnector`)
follows this same rule: never source an EC from `ExecutionContext.global` inside a trait
implementation — always accept it as a parameter.

## Sibling ownership map (do not pull forward)

| Concern | Owner | Why not here |
|---|---|---|
| Schema-inference facade / polymorphic dispatch through the trait | HEL-473 | Needs `SourceService` call-site changes this ticket avoids for zero behavioral risk |
| Uniform fetch-error envelope | HEL-468 | `fetchError` shape today is REST/SQL-specific; unifying it is a dedicated ticket |
| Centralized secret storage + redaction | HEL-460 | Redaction stays in `DataSourceResponse.fromDomain` per acceptance criteria; centralizing it is out of scope here |
| Connection-test HTTP endpoint + UI | HEL-480 | This ticket only adds the `testConnection` SPI method, no route |
| Connector registry + capability aggregation | HEL-484 | This ticket exposes `metadata` per-connector; aggregating/enumerating all connectors is the registry's job |

## Risks / Trade-offs

- [Risk] `testConnection`'s SQL implementation (open+close, no query) diverges from `execute`'s
  error message ("SQL execution failed") since it's a different code path → Mitigation: use a
  distinct, clearly-scoped error message (e.g. "SQL connection failed") so log/test consumers can't
  confuse the two failure categories.
- [Risk] Two implementations of the same lifecycle (existing methods + new trait methods) could
  drift → Mitigation: trait methods delegate to existing methods wherever a matching operation
  already exists (`inferSchema`, `fetch`'s row-shaping), so there's one source of truth for
  behavior; only `testConnection` is genuinely new logic.
- [Trade-off] Not wiring `SourceService` through the trait yet means this ticket doesn't fully
  "prove" the SPI in production request paths — accepted because it keeps the change additive and
  zero-risk; HEL-473 does the wiring once schema-inference has a reason to dispatch polymorphically.

## Planner Notes

- Chose `task/` (not `feature/`) branch prefix — this ticket is an internal refactor/infra seam, no
  new user-facing behavior.
- Self-approved: adding `Connector.scala` under `domain/` (ticket allows `domain/` or `services/`;
  `domain/` matches where `SqlConnector`/`RestApiConnector`/`SchemaInferenceEngine` already live).
- Self-approved: `authKind: String` over a new ADT — ticket explicitly asks to keep metadata minimal
  and names HEL-484 as the aggregation owner.
