## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

**Round-2 Change Request 2 (JsonProtocols wiring) — confirmed resolved:**
- `tasks.md` Task 2.2 now explicitly says "Add `new ConnectorProtocol` to `JsonProtocols.scala`'s
  mixin composition... required for `ConnectorRoutes` to compile against the new response formats;
  `JsonProtocols` has no wildcard/reflective fallback." `design.md` Decision 4 (lines 83-91) states
  the same mechanism and names the exact mixin pattern.
- Read `backend/src/main/scala/com/helio/api/JsonProtocols.scala` directly: confirmed it is
  `trait JsonProtocols extends ... with AuthProtocol with ApiTokenProtocol with ... with
  PipelineScheduleProtocol` — 12 explicit `with XProtocol` mixins, no wildcard fallback, exactly as
  claimed. Design's citation of `PipelineScheduleProtocol` as the current last-in-list example is
  accurate.

**Round-2 Change Request 1 (five broken construction sites) — only half-fixed. See Change Request
below; this is the reason for this round's REFUTE.**

**Fresh full pass (ground truth re-read, not reliance on prior reports' narrative):**
- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas in full.
- `Connector.scala` — confirmed current `ConnectorMetadata` is a 4-field case class
  (`kind`/`displayName`/`supportsIncremental`/`authKind`), and the trait doc comment at lines 29-30
  currently says "Registry aggregation (HEL-484) works against `Connector[_]` existentials" —
  confirmed stale, and `tasks.md` Task 1.5 + `design.md` Planner Notes (lines 133-136) correctly
  target this line for correction with the accurate mechanism description.
- `RestApiConnector.scala:23` — confirmed `metadata` is currently an instance `val` on a class
  requiring `implicit system: ActorSystem[_]` to construct (not dependency-free); Decision 1's
  companion-object-`val` fix is the correct remedy and is fully specified in both `design.md` and
  `specs/connector-registry/spec.md`.
- `SqlConnector.scala:14` — confirmed already a dependency-free `object` member; no change claimed,
  matches design.
- `DataSource.scala:155-170` — confirmed `DataSourceKind.All` is currently a literal
  `Set(Csv, RestApi, Sql, Static, Text, Pdf, Image)`; `parseKind` derives from it. Task 1.4's
  derivation plan is consistent with this call-site shape.
- `DataSourceProtocol.scala`, `DataSourceRepository.scala` — grepped: both reference
  `DataSourceKind.Csv`/`.RestApi`/etc. and `.All`/`.parseKind` from contexts with zero `ActorSystem`
  in scope, confirming the "no-`ActorSystem` static call site" premise underlying Decision 1/3.
- `SqlSourceConfigPayload`/`RestApiConfigPayload` (`DataSourceProtocol.scala:108-130`) — confirmed
  field shapes exactly match Decision 2's claim (`dialect/host/port/database/user/password/query` for
  SQL, `url` required + `method`/`auth`/`headers` optional for REST) — the hand-authored
  `requiredFields` population plan (Task 1.2, verified by Task 5.2) is grounded in real payload
  shapes, not invented.
- `helio-mcp/src/tools/read.ts` — confirmed the `guarded(() => api.xxx())` pass-through pattern for
  every existing read tool; `helioApi.ts`'s `HelioApi` class and its `listDashboards`/
  `listSourceObjects` methods confirm the precedent Task 3.1 follows.
- `frontend/src/features/sources/ui/SourceTypeToggle.tsx` — read in full: current 7-button
  order/labels are exactly "REST API, CSV File, Manual, SQL Database, Text/Markdown, PDF, Image" —
  matches Decision 6's claim verbatim. `AddSourceModal.tsx` has its own independent `SourceType`
  literal union (duplicated from `SourceTypeToggle.tsx`'s) and 5 call sites of
  `<SourceTypeToggle active={sourceType} onChange={setSourceType} />` — Task 4.3's two-option framing
  ("derive the union from the registry or keep a runtime-guarded literal union") is a legitimate,
  non-blocking implementation choice given both keep `AddSourceModal`'s per-kind branching untouched.
- `frontend/src/features/sources/services/dataSourceService.ts` exists — confirmed a real precedent
  directory for Task 4.1's planned `listConnectors` service call location.
- `CreateSourceEnvelope.scala`, `SchemaInferenceFacade.scala`, `ConnectionTest.scala` all exist under
  `backend/src/main/scala/com/helio/services/` — design.md's Context section citations are accurate.
- `ApiRoutes.scala` — confirmed the `new XRoutes(service, authenticatedUser).routes` per-route-class
  pattern; a `ConnectorRoutes(authenticatedUser)` variant with no service (per Decision 4's "no
  repository dependency") is consistent with the pattern.
- Checked for inline FQNs in `proposal.md`/`design.md`/`tasks.md`/spec deltas — the one
  `com.helio.domain` mention (`proposal.md:10`) is a backticked package-placement note for a new
  file, not an inline fully-qualified call reference; not a violation.
- Both spec deltas (`specs/connector-registry/spec.md`, `specs/connector-spi/spec.md`) read in full —
  requirements/scenarios are internally consistent with proposal/design/tasks, and the
  `connector-spi` MODIFIED delta correctly documents the widened 5-field `ConnectorMetadata`.

### New issue found this round — round 2's Change Request 1 is only half-resolved

Round 2 required (option a, verbatim): *"`design.md` Decision 2 specifies `requiredFields` gets a
default value (`= Vector.empty`) so the three pure fixtures keep compiling untouched, **and**
`tasks.md` gets an explicit task ... to update `RestApiConnectorSpec.scala` and
`SqlConnectorSpec.scala`'s two assertions to include the real `requiredFields` values now populated
on `SqlConnector`/`RestApiConnector`"* — i.e., two required parts. Commit `6f6a6f5a` implemented only
the first part (the default value, in Task 1.1/Decision 2). It did **not** add the second part: no
task anywhere touches `RestApiConnectorSpec.scala` or `SqlConnectorSpec.scala`.

I verified this is a real, not hypothetical, runtime failure by reading the actual test bodies:

- `backend/src/test/scala/com/helio/domain/RestApiConnectorSpec.scala:76-83`:
  ```scala
  "RestApiConnector.metadata" should {
    "expose kind=rest_api, displayName=REST API, supportsIncremental=false, authKind=configurable" in {
      connector.metadata shouldBe ConnectorMetadata(
        kind = "rest_api", displayName = "REST API",
        supportsIncremental = false, authKind = "configurable"
      )
    }
  }
  ```
- `backend/src/test/scala/com/helio/domain/SqlConnectorSpec.scala:172-179` — same shape for `sql`.

Both use ScalaTest's `shouldBe`, which is full case-class structural equality. Once the
`= Vector.empty` default lands (Task 1.1) and Task 1.2 executes — "Populate `requiredFields` on both
[`SqlConnector`, `RestApiConnector`], matching `SqlSourceConfigPayload`/`RestApiConfigPayload`'s
actual required fields" — the *actual* `connector.metadata`/`asConnector.metadata` values will carry
non-empty `requiredFields` (e.g. containing a `url` descriptor for REST, `password` etc. for SQL),
while the *expected* value in each test's 4-named-arg `ConnectorMetadata(...)` construction implicitly
resolves `requiredFields` to the default `Vector.empty`. `Vector.empty != Vector(ConnectorFieldDescriptor(...))`,
so both assertions **fail with a value mismatch at test-run time** — a real `sbt test` regression, not
a compile error, and not hypothetical: I confirmed by direct grep that no other `.metadata` assertion
touches `SqlConnector`/`RestApiConnector` production values with an already-updated expectation.

By contrast, I verified the other three sites Task 1.1 lists (`ConnectorSpec.scala:19`/`:57`,
`NewConnectorInferenceSpec.scala:23`, `CreateSourceEnvelopeSpec.scala:29`) are genuinely fine
untouched: each defines a **self-contained fixture** (`FixtureConnector`/`RowSupplyingConnector`/
`EnvelopeFixtureConnector`) whose own `metadata` `val` and its own `shouldBe` assertion (where one
exists) both use the same 4-arg/default-`Vector.empty` shape — no production code changes their
values, so both sides of any comparison stay in sync. Grepped for any assertion against these three
fixtures' metadata elsewhere in the suite — none found.

So the claim "the five existing test sites are NOT scheduled for edits anywhere in tasks.md" is true
as literally stated but is not sufficient: three of the five genuinely don't need edits, but the
other two (`RestApiConnectorSpec.scala:76`, `SqlConnectorSpec.scala:172`) **do** need their expected
`ConnectorMetadata(...)` values updated to include the real `requiredFields` list once Task 1.2 lands
— and tasks.md still doesn't schedule that edit. This is precisely the failure mode round 2 already
diagnosed and required a fix for; the round-3 commit resolved only the compile-time half of that
requirement.

### Verdict: REFUTE

### Change Requests

1. **Required: `tasks.md` Task 1.2 (or a new sub-task) must schedule an update to
   `RestApiConnectorSpec.scala:76-83` and `SqlConnectorSpec.scala:172-179`'s expected
   `ConnectorMetadata(...)` values to include the real, non-empty `requiredFields` list that Task 1.2
   populates on `RestApiConnector`/`SqlConnector`.** As currently scoped, once Task 1.2 executes,
   these two tests' `shouldBe` assertions compare the real connector metadata (non-empty
   `requiredFields`) against an expected value that resolves `requiredFields` to the default
   `Vector.empty` — a guaranteed value-mismatch test failure at `sbt test` time, not a compile error.
   This is the exact scenario round 2's Change Request 1 (option a) already required a fix for
   ("`tasks.md` gets an explicit task ... to update `RestApiConnectorSpec.scala` and
   `SqlConnectorSpec.scala`'s two assertions to include the real `requiredFields` values"); the
   round-3 commit added the default value but omitted this second half. `design.md` Decision 2 should
   also be updated to state this explicitly (mirroring its current "keep compiling untouched" framing
   with an added "the two production-linked assertions are updated to match the real populated
   values" clause), so the proposal's "additive" framing is accurate at both the compile and the
   test-pass level, not just the compile level.

### Non-blocking notes

- Task 4.3's two-option framing for `AddSourceModal.tsx`'s `SourceType` union ("derive from the
  registry or keep a runtime-guarded literal union") is a reasonable secondary implementation
  decision left open — it doesn't block a competent implementer since both options are named and
  either keeps existing branching untouched. Not a blocking ambiguity, but naming the preferred
  default up front would tighten the task.
- Task 2.1 still doesn't name the new protocol file explicitly (just "in `api/protocols/`" for
  `ConnectorProtocol`) — a minor clarity gap, not blocking given the one-file-per-feature convention
  is unambiguous from context (`AlertRuleProtocol.scala`, `PipelineScheduleProtocol.scala`, etc. all
  live one-per-file in that directory).
