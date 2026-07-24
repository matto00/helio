## Context

Only `SqlConnector`/`RestApiConnector` implement HEL-449's `Connector[Config]` SPI. The five
content/upload kinds (`csv`/`static`/`text`/`pdf`/`image`) are file-backed with no live
`testConnection`/`fetch` semantics and have no `Connector[Config]` instance today — building one for
each would be new-connector-shaped work this ticket explicitly excludes. `DataSourceKind.All` is a
literal `Set[String]` in `domain/DataSource.scala`; per-kind config shapes live in
`api/protocols/DataSourceProtocol.scala` (`SqlSourceConfigPayload`, `RestApiConfigPayload`,
`CsvSourceConfigPayload`, etc.). `CreateSourceEnvelope`/`SchemaInferenceFacade`/`ConnectionTest` in
`services/` are the three existing siblings generic over `Connector[Config]`; `ApiRoutes.scala`
composes one `*Routes` class per concern into the authenticated route tree.

## Goals / Non-Goals

**Goals:**
- One `ConnectorRegistry` enumerating all 7 kinds with `ConnectorMetadata` (widened with
  `requiredFields`), consumable by backend routes, helio-mcp, and the frontend.
- `DataSourceKind.All`/`parseKind` derive from the registry with identical accepted-set behavior.
- A compile-or-test-time mechanism that fails if a kind exists in one place (`DataSourceKind`,
  registry, or a concrete config payload) but not the others — not a prose promise.

**Non-Goals:**
- Building `Connector[Config]` instances for csv/static/text/pdf/image.
- Widening `authKind` into a sealed trait.
- Making `POST /api/sources`/`/infer` validate against `requiredFields`.

## Decisions

**1. `ConnectorRegistry.all: Vector[ConnectorMetadata]` aggregates `ConnectorMetadata` values, not
`Connector[_]` existentials — and every entry MUST be reachable from a dependency-free static
context (no `ActorSystem`, no constructor args, no running process state).** This invariant exists
because `DataSourceKind.All` is read from call sites that have zero `ActorSystem` in scope today —
`DataSourceProtocol.scala`'s JSON discriminators, `DataSourceRepository.scala`, and the bare
`DataSourceSpec.scala` unit test — and `DataSourceKind.All` derives from `ConnectorRegistry.all`
(Decision 3), so anything the registry needs to construct an entry, `DataSourceKind` needs
transitively. Concretely:
- `SqlConnector` is already a stateless `object` — `SqlConnector.metadata` is a dependency-free
  static `val` today; no change needed.
- `RestApiConnector` is a `class` requiring `(implicit system: ActorSystem[_])` to construct — an
  instance's `.metadata` is NOT reachable statically. Its `ConnectorMetadata` value SHALL move to a
  new `RestApiConnector` **companion object** as a dependency-free `val` (`RestApiConnector.metadata`),
  with the class's `override val metadata` delegating to it (`RestApiConnector.metadata` — one source
  of truth, no duplication) so the trait's `Connector[Config].metadata` member is still satisfied on
  instances.
- The five content kinds (`csv`/`static`/`text`/`pdf`/`image`) have no `Connector[Config]`
  implementation at all — their `ConnectorMetadata` values are plain static `val`s constructed inline
  in `ConnectorRegistry` itself, trivially dependency-free (no synthetic `Connector[Config]` wrapper —
  there's no `Config` type to parameterize over for a kind with no SPI implementation, and inventing
  one to satisfy an existential would be exactly the "shoe-horn a fake connector" anti-pattern this
  ticket must avoid).

Any future connector (424-428) that wants its metadata in the registry inherits this same rule: expose
`metadata` as a companion-object `val`, never require an instance to read it, so the registry — and
anything that reads `DataSourceKind.All` transitively — never needs to construct a connector (with
its `ActorSystem`/credentials/whatever else its constructor requires) just to enumerate kinds.

**2. Widen `ConnectorMetadata` with `requiredFields: Vector[ConnectorFieldDescriptor] = Vector.empty`,
where `ConnectorFieldDescriptor(name: String, label: String, secret: Boolean)`.** The `= Vector.empty`
default is what makes this genuinely additive at the *compile* level, not just an assertion of
additivity: without it, every existing 4-arg `ConnectorMetadata(...)` construction site — five of
them across `RestApiConnectorSpec`, `SqlConnectorSpec`, `ConnectorSpec` (×2),
`NewConnectorInferenceSpec`, and `CreateSourceEnvelopeSpec` — would fail to compile. With the
default, all five keep *compiling* untouched.

Compiling and asserting the same value are two different things, though, and the split matters:
`SqlConnector`/`RestApiConnector` (the only two production sites) are updated to pass an explicit
non-empty `requiredFields` (Task 1.2) — and two of the five test sites, `RestApiConnectorSpec.scala`
and `SqlConnectorSpec.scala`, don't just construct a `ConnectorMetadata`, they assert the *production*
connector's full metadata via `metadata shouldBe ConnectorMetadata(kind=…, displayName=…,
supportsIncremental=…, authKind=…)`. Once Task 1.2 gives the production values real `requiredFields`,
those two assertions fail at test-run time (`Vector.empty` expected vs. a real vector actual) even
though they still compile. Task 1.2a updates those two expected values to match — this is a
*behavior-driven* test update (the value being asserted genuinely changed), not "editing a test to
accommodate new code" the batch rule forbids; it is disclosed as such. The other three sites
(`ConnectorSpec` ×2, `NewConnectorInferenceSpec`, `CreateSourceEnvelopeSpec`) are self-contained
fixtures that don't reference `SqlConnector`/`RestApiConnector`'s real metadata, so the default alone
keeps them genuinely untouched — no value-assertion gap there.

`requiredFields` is populated by hand per kind from the existing config payload shapes (e.g. SQL:
`dialect`/`host`/`port`/`database`/`user`/`password`/`query`, `password` marked `secret = true`; REST:
`url` required, `auth` fields conditionally secret). No values, ever — descriptors only, satisfying
"no credentials or secret field values are included." The `connector-spi` spec delta documents the
widened field list.

**3. Registry/`DataSourceKind` sync is enforced by a test, not a shared source alone.** Even with
`DataSourceKind.All` deriving from `ConnectorRegistry.all.map(_.kind).toSet`, a hand-authored
`ConnectorMetadata` entry could be added to the registry with a typo'd `kind`, or a `DataSource`
subtype's `kind` string could drift from what any config payload actually expects. A backend test
(`ConnectorRegistrySpec`) asserts: (a) `ConnectorRegistry.all.map(_.kind).toSet ==
DataSourceKind.All` (trivially true post-derivation, but pins the invariant so a future refactor that
reintroduces a literal `Set` fails loudly), and (b) `ConnectorRegistry.all.map(_.kind).toSet` equals
a literal `Set("csv","rest_api","sql","static","text","pdf","image")` written independently in the
test — so adding a kind to `DataSourceKind` (a new `DataSource` subtype + its `kind` string) without
a matching registry registration fails this second assertion, and vice versa. This is the mechanism
the ticket brief calls out as required — a prose "stays in sync" claim is insufficient.

**4. `GET /api/connectors` lives in the authenticated route tree as a new `ConnectorRoutes` class**,
mounted in `ApiRoutes.scala` alongside `DataSourceRoutes`/`SourceRoutes` (matching the "one `*Routes`
class per concern" pattern). No repository dependency — it wraps `ConnectorRegistry.all` in a JSON
response. Authenticated (not public) because every other data-source-adjacent read endpoint is;
there's no reason to special-case this one as public. Its response types need a new `ConnectorProtocol`
trait mixed into `JsonProtocols.scala`'s composition (`with AuthProtocol with ... with
PipelineScheduleProtocol`, etc.) — `JsonProtocols` has no wildcard fallback, so every route class's
formats must be explicitly wired in; omitting this step would fail to compile at `ConnectorRoutes`'
`complete(...)` call, not silently degrade.

**5. helio-mcp `list_connectors` is a pure pass-through**, following `read.ts`'s `guarded(() =>
api.xxx())` pattern exactly — one new `HelioApi.listConnectors()` method (`GET /api/connectors`, no
params), one new tool registration, no client-side reshaping. The `requiredFields` descriptors have
no optional fields at the Scala level (all three `ConnectorFieldDescriptor` members are required), so
the spray-json `Option = None`-omission gotcha does not apply to this payload — no normalization
needed. `supportsIncremental`/`authKind` on `ConnectorMetadata` are also non-optional today.

**6. Frontend `SourceTypeToggle` fetches the registry via a new `listConnectors` service call and
renders one button per entry, in registry order.** To stay behavior-preserving byte-for-byte (same 7
buttons, same labels, same order), the registry's insertion order for the 7 existing kinds matches
`SourceTypeToggle.tsx`'s current button order exactly (REST API, CSV, Static, SQL, Text, PDF, Image);
`displayName` values are chosen to match today's button labels ("REST API", "CSV File", "Manual",
"SQL Database", "Text/Markdown", "PDF", "Image") rather than introducing new copy.

## Risks / Trade-offs

- [Risk] Hand-populated `requiredFields` per kind could drift from the actual payload case class
  fields over time (no compile-time link between `ConnectorFieldDescriptor` and
  `SqlSourceConfigPayload`'s fields) → Mitigation: `ConnectorRegistrySpec` asserts the SQL/REST
  entries' `requiredFields` names match `SqlSourceConfigPayload`/`RestApiConfigPayload`'s
  non-optional field names via reflection-free explicit lists (test fails if a payload gains/loses a
  required field without the registry entry being updated to match).
- [Trade-off] The five content kinds' `ConnectorMetadata` values are static, hand-authored data
  rather than derived from a real `Connector[Config]` instance — accepted because building live SPI
  instances for file-backed kinds is out of this ticket's scope, and the sync test (Decision 3)
  still catches enumeration drift even without a live connector backing each entry.

## Planner Notes

- Self-approved: registry aggregates `ConnectorMetadata` values rather than `Connector[_]`
  existentials (Decision 1) — the ticket's scope bullet says "aggregates the SPI capability metadata
  ... for every registered connector," which is satisfied by the metadata value regardless of
  whether a live SPI instance backs it; forcing all 7 kinds through `Connector[_]` would require
  building new connector plumbing this ticket's "Out of scope" section explicitly forbids.
- Self-approved: `ConnectorFieldDescriptor` as a new nested case class (not reusing `DataField`/
  `InferredField`) — those describe inferred *data* schema, not connector *config* input shape; they
  are semantically distinct and conflating them would misuse the existing types.
- Confirmed via `openspec/changes/archive/2026-07-24-connector-spi-shared-trait/design.md`'s sibling
  ownership map: "Connector registry + capability aggregation" is HEL-484's alone; no overlap with
  HEL-473/468/460/480.
- `Connector.scala`'s existing trait doc comment states "Registry aggregation (HEL-484) works against
  `Connector[_]` existentials" — written before this design settled on Decision 1's dependency-free
  static-value approach. That line is now factually wrong and must be corrected as part of this
  change (Task 1.5) so the shipped doc comment matches the actual mechanism.
