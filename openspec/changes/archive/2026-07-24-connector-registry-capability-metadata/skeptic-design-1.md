## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/connector-registry/spec.md`, `specs/connector-spi/spec.md`) in full.
- Read the actual ground-truth code the design reasons about:
  - `backend/src/main/scala/com/helio/domain/Connector.scala` (SPI trait + `ConnectorMetadata`,
    including its doc comment).
  - `backend/src/main/scala/com/helio/domain/SqlConnector.scala` (`object SqlConnector extends
    Connector[SqlSourceConfig]`, `metadata` is a plain val on a dependency-free `object`).
  - `backend/src/main/scala/com/helio/domain/RestApiConnector.scala` (`class RestApiConnector(...)
    (implicit system: ActorSystem[_]) extends Connector[RestApiConfig]` — `metadata` is an instance
    member of a class that requires a live Pekko `ActorSystem[_]` to construct, even though the
    `metadata` value itself doesn't touch any instance state).
  - `backend/src/main/scala/com/helio/domain/DataSource.scala` (`DataSourceKind.All` is currently a
    dependency-free literal `Set[String]` on a bare `object`).
  - `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala`,
    `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala`,
    `backend/src/test/scala/com/helio/domain/DataSourceSpec.scala` — confirmed `DataSourceKind` is
    read from multiple call sites that have **no `ActorSystem` in scope** (pure JSON codec pattern
    matches, a Slick repository, and a bare `FlatSpec`-style unit test with zero Pekko fixture setup).
  - `backend/src/main/scala/com/helio/app/Main.scala:93` and `ApiRoutes.scala` — confirmed the only
    existing `RestApiConnector` instance in the app is constructed once in `Main.scala` and threaded
    into `ApiRoutes`/`SourceService` via constructor DI, never constructed ad hoc inside `domain`.
  - `backend/src/main/scala/com/helio/services/CreateSourceEnvelope.scala` — confirmed the existing
    sibling pattern (`Connector[Config]` instances are always passed in by the caller, never
    constructed inside a dependency-free object).
  - `grep`-confirmed `ConnectorMetadata` has no existing spray-json `RootJsonFormat` anywhere in
    `backend/src/main/scala` — the widening is genuinely additive with no wire-format break.
  - `helio-mcp/src/tools/read.ts` — confirmed the `guarded(() => api.xxx())` pass-through pattern the
    design says `list_connectors` will follow.
  - `frontend/src/features/sources/ui/SourceTypeToggle.tsx` — confirmed current button order/labels
    (REST API, CSV File, Manual, SQL Database, Text/Markdown, PDF, Image) match Decision 6's claimed
    behavior-preserving order.
  - `frontend/src/features/sources/services/dataSourceService.ts` and its test — confirmed the
    spray-json `Option = None`-omission precedent the design correctly reasons is inapplicable here
    (all three `ConnectorFieldDescriptor` fields are non-optional).
  - `CONTRIBUTING.md:29` — confirmed the "no inline FQN" rule is about Scala code (imports vs. inline
    qualified references), not design-doc prose; the `com.helio.domain` mentions in `proposal.md`/
    `specs/connector-registry/spec.md` are backticked package-location references, not a violation.

### Verdict: REFUTE

The registry-aggregation rationale (Decision 1), the additive `ConnectorMetadata` widening, and the
drift-detection test mechanism (Decision 3 / the "cannot silently drift" spec requirement) are all
sound and correctly grounded in the ticket's investigation notes. However, the design has a concrete,
unaddressed implementability gap in exactly the mechanism the ticket cares most about (making
`DataSourceKind.All` derive from the registry), plus one internal contradiction it leaves unresolved.

### Change Requests

1. **Blocking: `ConnectorRegistry.all` cannot be a dependency-free value if the `rest_api` entry
   comes from "a `RestApiConnector` instance's `.metadata`" as Decision 1 and Task 1.3 state.**
   `RestApiConnector` is `class RestApiConnector(...)(implicit system: ActorSystem[_])` —
   constructing one requires a live Pekko `ActorSystem[_]`. Task 1.4 requires `DataSourceKind.All`
   (`domain/DataSource.scala`) to derive from `ConnectorRegistry.all.map(_.kind).toSet`, and
   `DataSourceKind` is read today from call sites with **no `ActorSystem` in scope at all** —
   `DataSourceProtocol.scala`'s JSON discriminator matching, `DataSourceRepository.scala` (a Slick
   repo), and `DataSourceSpec.scala` (a bare unit test with zero Pekko fixture). As written, the
   design cannot compile/wire as specified: either `ConnectorRegistry`/`DataSourceKind` silently
   grow an `ActorSystem` dependency they don't have today (invasive, touches many pure call sites,
   and reintroduces exactly the kind of implicit/global-context sourcing `Connector.scala`'s own
   doc comment explicitly forbids for `ExecutionContext` — "No implementation may source ... internally"),
   or the design's "sourced from `.metadata`" claim is not actually achievable for `rest_api` at the
   point `ConnectorRegistry.all` needs to be evaluated.
   **Required revision**: `design.md` must specify the actual mechanism — e.g., moving the static
   `ConnectorMetadata` value for `rest_api` to `RestApiConnector`'s **companion object** (a pure,
   dependency-free `val` that both the trait's instance member and `ConnectorRegistry` read from,
   since the metadata value itself never touches instance/`ActorSystem` state), so `ConnectorRegistry.all`
   remains a plain, DI-free `Vector[ConnectorMetadata]` usable from `DataSourceKind.All`'s static
   context. `tasks.md` 1.2/1.3 should be updated to reflect whichever mechanism is chosen, and
   Decision 1/Decision 4's "a `RestApiConnector` instance's `.metadata`" language should be corrected
   to match.

2. **Required: reconcile the stale `Connector.scala` trait doc comment with the actual chosen
   approach.** `Connector.scala`'s existing doc comment states: *"Registry aggregation (HEL-484)
   works against `Connector[_]` existentials for enumeration/metadata, which don't need the config
   type."* This directly contradicts Decision 1, which explicitly rejects `Connector[_]`
   existentials in favor of aggregating bare `ConnectorMetadata` values (with sound reasoning — I
   agree with Decision 1's approach over the doc comment's anticipated one). The design/tasks don't
   currently include updating this comment, so if left as-is the shipped code will carry a
   misleading, factually-wrong doc comment about the very mechanism this ticket builds. Add a task
   (or fold into Task 1.1) to update `Connector.scala`'s trait doc comment to describe the actual
   `ConnectorMetadata`-value aggregation approach.

### Non-blocking notes

- Decision 4's phrasing ("No repository dependency — it wraps `ConnectorRegistry.all`") should be
  revisited once Change Request 1 is resolved, since depending on the chosen fix, `ConnectorRoutes`
  may or may not need any additional wiring beyond what `ApiRoutes.scala` already has available
  (`connector: RestApiConnector` is already a constructor parameter there today, so if the fallback
  fix is "thread the instance in" rather than "companion-object val," the plumbing is cheap and
  already available — worth noting explicitly either way).
- Everything else — the sync-drift test mechanism (Decision 3, `ConnectorRegistrySpec` in Task 5.1),
  the additive/non-breaking widening of `ConnectorMetadata` (no existing JSON format to break), the
  `list_connectors`/`read.ts` `guarded()` precedent, and the `SourceTypeToggle` behavior-preservation
  plan — is well-grounded in real code and I found no other soundness gaps.
