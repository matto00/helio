## Skeptic Report — design gate (round 4)

### What I verified (with evidence)

**Round-3 fix (Task 1.2a) — independently re-derived and confirmed correct:**
- Grepped every `ConnectorMetadata(` construction site in the whole backend tree (`grep -rn
  "ConnectorMetadata(" src/`): exactly 8 occurrences — 2 production (`SqlConnector.scala:14`,
  `RestApiConnector.scala:23`) + 6 test occurrences across the 5 files tasks.md names
  (`RestApiConnectorSpec.scala:76`, `SqlConnectorSpec.scala:172`, `ConnectorSpec.scala:19` and
  `:57`, `NewConnectorInferenceSpec.scala:23`, `CreateSourceEnvelopeSpec.scala:29`). No hidden
  9th site exists anywhere else in the repo.
- Read `RestApiConnectorSpec.scala:76-82` and `SqlConnectorSpec.scala:172-179` in full: both are
  `metadata shouldBe ConnectorMetadata(kind=…, displayName=…, supportsIncremental=…, authKind=…)`
  against the **real** `SqlConnector`/`RestApiConnector` — i.e. `shouldBe` full case-class equality
  against production values, exactly as Task 1.2a and Decision 2 describe. Once Task 1.2 populates
  real `requiredFields` on those two connectors, these two assertions would fail at `sbt test` time
  (`Vector.empty` expected vs. real vector actual) without the Task 1.2a update — the diagnosis is
  accurate.
- Read `ConnectorSpec.scala` in full (`FixtureConnector`, kind `"fixture"`) and skimmed
  `NewConnectorInferenceSpec.scala`/`CreateSourceEnvelopeSpec.scala`'s fixture connectors (kinds
  `"row-supplying-fixture"`, `"envelope-fixture"`): none reference `SqlConnector`/`RestApiConnector`'s
  real metadata — each defines and asserts against its own self-contained fixture value, so the
  `Vector.empty` default alone keeps these three genuinely untouched, exactly as Task 1.2a claims.
  Task 1.2a's scope (update exactly 2, leave exactly 3 alone) is precise and correct.
- Line-number citations in design.md/tasks.md match actual file contents exactly (verified via
  `grep -n`), including the ConnectorSpec.scala:19/:57 double-reference for the one file with two
  construction sites.

**Fresh full pass over the rest of the change (not just the round-3 fix):**
- `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas read in full.
- `Connector.scala` — confirmed current 4-field `ConnectorMetadata` and the stale trait doc comment
  ("Registry aggregation (HEL-484) works against `Connector[_]` existentials") that Task 1.5 targets.
- `RestApiConnector.scala` read in full — confirmed `metadata` is currently an instance `val` on a
  class requiring `implicit system: ActorSystem[_]` to construct; no companion object exists yet.
  Decision 1's companion-object-`val` fix is the correct, necessary remedy — the class cannot be
  constructed from `DataSourceKind`'s existing no-`ActorSystem` call sites today.
- `DataSource.scala:155-170` — confirmed `DataSourceKind.All` is a literal 7-member `Set`; `parseKind`
  derives from it, matching Task 1.4's derivation plan.
- Grepped every production call site of `DataSourceKind`: `DataSourceProtocol.scala`,
  `DataSourceRepository.scala`, `SourceRoutes.scala`, `SourcePreviewRoutes.scala`,
  `SourceService.scala` all reference individual kind constants (`DataSourceKind.Csv` etc.), not
  `.All` directly (only `DataSourceSpec.scala` calls `.parseKind`/`.All` today). This doesn't
  undermine Decision 1's core JVM-semantics point: Scala `object` initialization runs the whole class
  body together, so touching any member (e.g. `DataSourceKind.Csv` from `DataSourceProtocol.scala`,
  loaded at JSON-format-construction time) triggers evaluation of `All`, which would need
  `ConnectorRegistry.all` — and thus `RestApiConnector.metadata` — to be dependency-free or the
  object's static initializer would need an `ActorSystem` it doesn't have. The design's conclusion
  holds even though its prose slightly overstates which call sites literally reference `.All` by
  name; not a defect worth blocking on (already implicitly covered across three prior CONFIRMing
  rounds).
- `SqlSourceConfigPayload`/`RestApiConfigPayload` (`DataSourceProtocol.scala:108-130`) — confirmed
  field shapes exactly match Decision 2's/Task 5.2's claims: SQL has exactly
  `dialect/host/port/database/user/password/query` (all required); REST has `url` required with
  `method`/`auth`/`headers` all `Option`. The hand-authored `requiredFields` plan is grounded in real
  payload shapes.
- `JsonProtocols.scala` — confirmed 12 explicit `with XProtocol` mixins, no wildcard fallback, and
  `PipelineScheduleProtocol` is the current last-in-list, matching Task 2.2/Decision 4's citation.
- `ApiRoutes.scala` — confirmed the `new XRoutes(service, authenticatedUser).routes` per-class
  pattern; a no-service `ConnectorRoutes(authenticatedUser)` variant is consistent given Decision 4's
  "no repository dependency" rationale.
- `SourceTypeToggle.tsx` read in full — confirmed current 7-button order/labels are exactly "REST
  API, CSV File, Manual, SQL Database, Text/Markdown, PDF, Image," matching Decision 6 verbatim.
- `helio-mcp/src/tools/read.ts` read — confirmed the `guarded(() => api.xxx())` pass-through pattern
  used by every existing read tool, matching Task 3.2/Decision 5's claim.
- Grepped for `ConnectorFieldDescriptor`/`ConnectorRegistry` anywhere in `backend/src`: zero existing
  occurrences — no naming collision with the new types this change introduces.
- No `TODO`/`TBD` placeholders found in proposal/design/tasks/spec deltas; every task has a concrete,
  file-anchored action. No inline FQNs found (the one `com.helio.domain` mention in proposal.md is a
  backticked package-placement note, not an inline call reference).
- Acceptance criteria traced: all 7 kinds enumerated (spec.md Requirement "ConnectorRegistry
  enumerates every source kind"), no secret values on the wire (Requirement "GET /api/connectors
  returns the registry" + Decision 2/5), one-registration-to-add-a-connector (Decision 1's
  companion-object-`val` rule + Risks/Trade-offs section), backend+MCP+frontend tests all scheduled
  (Tasks 5.1-5.6), backward-compatible (additive widen with default, behavior-preserving
  `parseKind`/toggle).

### Verdict: CONFIRM

### Non-blocking notes
- Design.md's Decision 1 prose ("`DataSourceKind.All` is read from call sites that have zero
  `ActorSystem` in scope today — `DataSourceProtocol.scala`'s JSON discriminators,
  `DataSourceRepository.scala`") is slightly imprecise: those two files reference individual
  `DataSourceKind.X` constants, not `.All`, in current production code. The underlying constraint
  (the `DataSourceKind` object's static initializer must stay dependency-free because any member
  access triggers whole-object initialization) is sound and already covered across three prior
  rounds — just a wording nit, not an execution blocker.
