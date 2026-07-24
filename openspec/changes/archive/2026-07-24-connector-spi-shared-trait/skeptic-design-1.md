## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/connector-spi/spec.md` in full (all under
  `openspec/changes/connector-spi-shared-trait/`).
- Read the real, current `backend/src/main/scala/com/helio/domain/SqlConnector.scala`
  and `RestApiConnector.scala` to check the design's claims about existing method
  shapes against ground truth (not the design doc's paraphrase of them).
- Confirmed `SqlSourceConfig`, `RestApiConfig`, `InferredSchema` all exist in
  `backend/src/main/scala/com/helio/domain/model.scala` as described.
- Confirmed the four "existing behavior must not change" test suites named in
  `tasks.md` §4.4 actually exist:
  `DataSourceServiceSpec.scala`, `DataSourceServiceRestartPersistenceSpec.scala`,
  `DataSourceRoutesSpec.scala`, `SchemaInferenceRegressionSpec.scala`,
  `SqlConnectorSpec.scala` — all present under `backend/src/test/scala/com/helio/`.
- Grepped for `TODO`/`TBD`/"figure out" across all planning artifacts — none found.
- Traced overload safety: the new trait methods (`fetch(config, maxRows)`,
  `inferSchema(config)`, `testConnection(config)`) have different arities/param
  types than the existing `SqlConnector.execute`, `SqlConnector.inferSchema(rows)`,
  `RestApiConnector.fetch(config)` — no signature collision, additive as claimed.
- Checked scope containment against the ticket's "Epic context" sibling list
  (HEL-473/468/460/480/484): `design.md`'s "Sibling ownership map" names the exact
  same five tickets for the exact same concerns (facade dispatch, fetch-error
  envelope, redaction, connection-test endpoint, registry aggregation) — matches,
  no scope drift, no sibling scope pulled forward.
- Checked `Impact` sections: no frontend, schema, migration, or route changes
  planned — consistent with ticket's "Out of scope" and "Backward-compatible" AC.
- Confirmed `SourceService.scala` is `final class SourceService(...)(implicit ec:
  ExecutionContext)` and already supplies that implicit at every `SqlConnector`
  call site (`execute`, `inferSchema`) — this is the detail the gap below turns on.

### Gap found: `ExecutionContext` threading is unspecified on the trait's
`Future`-returning methods

`grep -n "ExecutionContext\|implicit ec" openspec/changes/connector-spi-shared-trait/*.md
openspec/changes/connector-spi-shared-trait/specs/connector-spi/spec.md` returns
zero hits — the concept is never mentioned in `proposal.md`, `design.md`,
`tasks.md`, or `specs/connector-spi/spec.md`, even though `design.md`'s own
"Decisions" section goes to considerable length reasoning about smaller signature
questions (generic-vs-supertype config, `refresh` vs no `refresh`, `authKind`
type). This is a real gap, not a nitpick, because the two connectors are
asymmetric in how they currently obtain an `ExecutionContext`:

- `RestApiConnector` is a `class` constructed with an implicit `ActorSystem[_]`
  and derives its own `private implicit val ec: ExecutionContext =
  system.executionContext` internally (`RestApiConnector.scala:21`) — it can
  satisfy any signature without help.
- `SqlConnector` is a stateless `object` with **no** constructor. Its existing
  `execute` method only compiles because it declares `(implicit ec:
  ExecutionContext)` in its own signature (`SqlConnector.scala:48`) and every
  caller (`SourceService`, line 33-34) supplies one from its own scope.

If the trait's `fetch`/`inferSchema`/`testConnection` signatures (as specified in
`ticket.md:11-15`, `proposal.md:11-13`, `spec.md:4-9`) do **not** also carry an
implicit `ExecutionContext` parameter, `SqlConnector`'s trait implementation has
no legal way to call its own blocking-safe `execute`/`inferSchema` — the only
escape hatch would be reaching for `scala.concurrent.ExecutionContext.global`
inside the object. That is a real, silent behavior change: `SqlConnector.execute`
deliberately wraps blocking JDBC calls in `Future { blocking { ... } } (ec)` using
whatever dispatcher the caller passes in (in production, wired to the Pekko
dispatcher), specifically so blocking JDBC I/O doesn't starve it — this is exactly
the concern CLAUDE.md's Backend rule ("Avoid blocking operations in actor
execution paths") and `SqlConnector`'s own inline comment ("Uses
`scala.concurrent.blocking` to avoid starving the Pekko dispatcher") are about.
Falling back to the JVM-wide global pool for the new SPI-only code path would be
an undocumented, untested divergence in exactly the ticket that promises "zero
behavioral risk" (`design.md:18` "Zero behavior change on existing `SourceService`
paths") and "Existing REST and SQL create/infer/refresh behavior is unchanged"
(`ticket.md:23`) — and since this is the seam five sibling tickets build directly
on top of, whichever resolution the implementer picks here becomes the pattern
those five tickets inherit.

This is not a hypothetical two-reads-of-a-task ambiguity — it's a compile-time
question (`SqlConnector`'s trait-conforming methods will not type-check without
resolving it one way or another) that the design doc simply never poses or
answers, despite otherwise being unusually rigorous about naming and justifying
every other signature choice.

### Minor (non-blocking) gap

- `tasks.md` §2.2 and §3.2 specify `kind`, `supportsIncremental`, and `authKind`
  values for `SqlConnector`/`RestApiConnector`'s `metadata`, but never specify the
  `displayName` string value for either, even though `ConnectorMetadata` is
  defined with `displayName: String` as a required field (`proposal.md:13`,
  `spec.md:39`). Low ambiguity risk (an implementer will pick an obvious string
  like `"SQL Database"` / `"REST API"`) — flagging only so it's not silently
  skipped, not blocking on its own.

### Verdict: REFUTE

### Change Requests

1. **Resolve `ExecutionContext` threading in `design.md`/`specs/connector-spi/spec.md` before implementation.**
   Add an explicit decision (with the same rigor as the other five "Decisions" in
   `design.md`) stating that `Connector[Config]`'s `testConnection`, `inferSchema`,
   and `fetch` methods each carry `(implicit ec: ExecutionContext)` in their
   signature — mirroring `SqlConnector.execute`'s existing pattern — so
   `SqlConnector`'s trait implementation continues to receive its
   `ExecutionContext` from the caller (ultimately `SourceService`'s or a test's
   scope) rather than reaching for `scala.concurrent.ExecutionContext.global`
   internally. Update `tasks.md` §1.1 (trait member list) and §2.3/2.4 (SQL
   `testConnection`/`fetch`/`inferSchema` implementations) to reflect this, and
   add a scenario to `specs/connector-spi/spec.md` under "Shared Connector
   lifecycle trait" asserting the trait methods accept an implicit
   `ExecutionContext` so this doesn't get silently dropped during implementation.
   Without this, `SqlConnector.testConnection`/`fetch`/`inferSchema` cannot be
   implemented without either inventing a new implicit-EC source (a real
   behavioral risk this ticket explicitly disclaims) or leaving the trait
   unimplementable as specified.

### Non-blocking notes

- `tasks.md` §2.2 / §3.2: state the intended `displayName` values (e.g. `"SQL
  Database"`, `"REST API"`) explicitly so the task list is fully self-contained,
  even though the risk of divergence here is low.
