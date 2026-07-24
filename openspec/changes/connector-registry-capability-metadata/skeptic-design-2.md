## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

**Round-1 Change Requests — both confirmed resolved:**
- CR1 (`ConnectorRegistry.all` cannot be dependency-free if `rest_api` comes from an instance):
  `design.md` Decision 1 (lines 29-55) now states the invariant explicitly with rationale ("every
  entry MUST be reachable from a dependency-free static context... because `DataSourceKind.All` is
  read from call sites that have zero `ActorSystem` in scope today") and specifies the fix
  (`RestApiConnector.metadata` moves to a companion-object `val`, instance member delegates to it).
  `tasks.md` 1.2 ("Move `RestApiConnector`'s `ConnectorMetadata` value into a new `RestApiConnector`
  companion object...") and 1.3/1.4 reflect this. `specs/connector-registry/spec.md`'s "ConnectorRegistry
  enumerates every source kind" requirement and its three scenarios state the same invariant.
  `specs/connector-spi/spec.md`'s "RestApiConnector exposes metadata" scenario now reads "the
  companion object's dependency-free `val`... or a `RestApiConnector` instance's `metadata` member
  (which delegates to it)". Re-read ground truth (`RestApiConnector.scala` — `metadata` is currently
  an instance `val` on a class needing `implicit system: ActorSystem[_]`; `DataSourceSpec.scala` —
  a bare `AnyWordSpec` with zero Pekko fixture that calls `DataSourceKind.parseKind` directly,
  confirming the no-`ActorSystem` call site is real) — the fix is sound and matches the actual code.
- CR2 (stale `Connector.scala` doc comment): `tasks.md` 1.5 now exists ("Fix `Connector.scala`'s
  trait doc comment... update it to describe the actual mechanism"), and `design.md`'s Planner Notes
  (lines 123-126) explicitly call out the contradiction and reference Task 1.5 by number.

**Fresh full pass (this round), with ground truth read directly:**
- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas in full.
- `Connector.scala`, `RestApiConnector.scala`, `SqlConnector.scala`, `DataSource.scala` (current
  `DataSourceKind.All` is a literal `Set`) — confirm the described pre-change state matches design's
  claims.
- `DataSourceProtocol.scala` / `DataSourceRepository.scala` — confirmed both reference `DataSourceKind.Csv`/`.RestApi`/etc. (not `.All` directly), from contexts with no `ActorSystem`; `DataSourceSpec.scala` confirmed as a bare test with no Pekko fixture that exercises `parseKind`/`.All` directly.
- `openspec/specs/connector-spi/spec.md` (archived baseline, 4-field `ConnectorMetadata`) confirms the delta's MODIFIED section correctly widens from 4→5 fields with no other drift.
- `grep`-confirmed `ConnectorMetadata` has no spray-json format today — additive at the wire level, consistent with the design's claim.
- `SourceTypeToggle.tsx` — confirmed current 7-button order/labels (REST API, CSV File, Manual, SQL Database, Text/Markdown, PDF, Image) match Decision 6 exactly.
- `helio-mcp/src/tools/read.ts` `guarded()` pattern and `helioApi.ts`'s `listDataSources` shape confirm Decision 5/Task 3.1-3.2 follow the existing precedent.
- `ApiRoutes.scala` — confirmed the `new XRoutes(service, authenticatedUser).routes` per-request-block pattern for every authenticated route class; `ConnectorRoutes(authenticatedUser)` (no service) is a reasonable, consistent variant given "no repository dependency."
- `openspec validate connector-registry-capability-metadata --strict` → `Change ... is valid`.
- CONTRIBUTING.md's inline-FQN rule (line 29) re-checked against `proposal.md`/spec deltas — the `com.helio.domain` mentions are backticked package-location prose, not a violation.

**Two new implementability gaps found in this fresh pass (not covered by round 1):**
- Grepped all existing `ConnectorMetadata(...)` construction/assertion sites in the backend:
  `RestApiConnector.scala:23`, `SqlConnector.scala:14` (both covered by Task 1.2), plus **five
  test-only sites `tasks.md` never touches**: `RestApiConnectorSpec.scala:76-81`
  (`connector.metadata shouldBe ConnectorMetadata(kind=..., displayName=..., supportsIncremental=...,
  authKind=...)` — no `requiredFields`), `SqlConnectorSpec.scala:172-179` (same shape),
  `ConnectorSpec.scala:19` and `:57` (`FixtureConnector`'s `metadata` val + its `shouldBe` assertion),
  `NewConnectorInferenceSpec.scala:23` (`RowSupplyingConnector`), `CreateSourceEnvelopeSpec.scala:29`
  (`EnvelopeFixtureConnector`). Read all six files directly to confirm the exact 4-named-arg shape.
- Read `JsonProtocols.scala` — confirmed it is a trait that explicitly mixes in one `with XProtocol`
  trait per feature (`with AlertRuleProtocol`, `with PipelineScheduleProtocol`, etc., 12 total), and
  every existing `*Routes` class (`DataSourceRoutes`, `ApiTokenRoutes`, etc.) is `extends Directives
  with JsonProtocols` — there is no wildcard-import fallback. `tasks.md` 2.1/2.3 never add the new
  protocol trait to this list.

### Verdict: REFUTE

The two round-1 issues are genuinely fixed — Decision 1's companion-object mechanism is correctly
specified everywhere (design, both spec deltas, tasks), and the stale doc comment now has an explicit
fix task referenced from Planner Notes. The registry/`DataSourceKind` drift-detection mechanism
(Decision 3), the additive wire-widening reasoning, the MCP `guarded()` precedent, and the frontend
behavior-preservation plan are all sound and grounded in real code. However, this fresh pass surfaced
two concrete, ungrounded implementability gaps in `tasks.md` — both would produce a broken `sbt test`
run if executed literally as scoped, in the exact "design cannot compile/wire as specified" sense the
design gate exists to catch before an execution cycle.

### Change Requests

1. **Required: `tasks.md` must account for the five existing `ConnectorMetadata` construction/
   assertion sites the widening in Task 1.1 breaks.** `RestApiConnectorSpec.scala:76-81` and
   `SqlConnectorSpec.scala:172-179` assert `connector.metadata shouldBe ConnectorMetadata(kind=...,
   displayName=..., supportsIncremental=..., authKind=...)` with exactly 4 named args and no
   `requiredFields` — once Task 1.2 populates `requiredFields` on the real `SqlConnector`/
   `RestApiConnector` metadata values, these assertions will fail (wrong-value, not just a compile
   error) unless updated to include the matching `requiredFields`. Separately, three pure test
   fixtures — `FixtureConnector` (`ConnectorSpec.scala:19`, asserted against at `:57`),
   `RowSupplyingConnector` (`NewConnectorInferenceSpec.scala:23`), `EnvelopeFixtureConnector`
   (`CreateSourceEnvelopeSpec.scala:29`) — construct `ConnectorMetadata` with the same 4-arg shape
   and will fail to *compile* the moment `requiredFields` becomes a required (no-default) field.
   **Required revision**: either (a) `design.md` Decision 2 specifies `requiredFields` gets a default
   value (`= Vector.empty`) so the three pure fixtures keep compiling untouched, and `tasks.md` gets
   an explicit task (fold into 1.2 or a new 1.2b) to update `RestApiConnectorSpec.scala` and
   `SqlConnectorSpec.scala`'s two assertions to include the real `requiredFields` values now
   populated on `SqlConnector`/`RestApiConnector`; or (b) `tasks.md` explicitly enumerates all five
   files as touched. Either way, the design must not leave this to be discovered mid-implementation.

2. **Required: `tasks.md` Task 2.1/2.3 must add the new protocol trait to `JsonProtocols.scala`'s
   mixin list.** `JsonProtocols.scala` is a trait that composes exactly one `with XProtocol` mixin per
   feature (`with AlertRuleProtocol`, `with PipelineScheduleProtocol`, `with DataSourceProtocol`,
   etc. — 12 today, no wildcard-import fallback), and every `*Routes` class (`DataSourceRoutes`,
   `ApiTokenRoutes`, ...) is declared `extends Directives with JsonProtocols` to get every format
   into implicit scope. `ConnectorRoutes` (Task 2.2) will not compile — `complete(...)` on the new
   response type has no implicit `RootJsonFormat` — unless the new protocol trait (e.g.
   `ConnectorProtocol`, matching the one-file-per-feature convention seen in `api/protocols/`) is
   both created and added as a `with ConnectorProtocol` mixin on `JsonProtocols`. **Required
   revision**: add an explicit sub-step to Task 2.1 (or 2.3) naming the new protocol file (e.g.
   `ConnectorProtocol.scala`) and requiring it be mixed into `JsonProtocols.scala`.

### Non-blocking notes

- `proposal.md`'s "**BREAKING (additive, no wire consumers yet)**" framing for the `ConnectorMetadata`
  widening is accurate at the JSON-wire level but should be read alongside Change Request 1 above —
  the widening is not source-compatible at the Scala level even though it is wire-compatible; worth a
  one-line clarification in the proposal so the distinction isn't lost.
- I considered whether `ConnectorRegistry`'s static entries for `csv`/`static`/`text`/`pdf`/`image`
  referencing `DataSourceKind.Csv`/`.Static`/etc. (rather than literal strings) could create a
  circular static-initialization dependency between the `ConnectorRegistry` and `DataSourceKind`
  companion objects (since `DataSourceKind.All` now derives from `ConnectorRegistry.all`). Given
  `DataSourceKind`'s per-kind constants (`Csv`, `RestApi`, ...) are declared and initialized before
  `All` in source order, a re-entrant JVM class-init would still see them correctly assigned — so
  this isn't a live bug — but it's subtle enough, and the sync test (Decision 3 / Task 5.1) would
  catch any real drift immediately, that I'm flagging it only as an implementation-time awareness
  note, not a blocking design gap.
- Task 2.1 doesn't name the new protocol file explicitly (just "in `api/protocols/`"); naming it
  (e.g. `ConnectorProtocol.scala`, matching the one-file-per-feature convention) would remove any
  ambiguity, same spirit as Change Request 2.
