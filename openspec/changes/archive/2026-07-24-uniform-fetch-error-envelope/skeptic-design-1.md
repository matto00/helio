## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Helper signature soundness / byte-identical envelopes (Decision 2/3 code sketch).**
   Read `backend/src/main/scala/com/helio/services/SourceService.scala` (full file) and traced both
   `createSql` (L44-89) and `createRest` (L91-139) against design.md's Decision 3 sketch:
   - Both call `dataSourceRepo.insert(source, user).flatMap { inserted => ... }` before dispatching to
     the connector — matches the sketch's call site exactly.
   - Both share one `now = Instant.now()` between the inserted `DataSource`'s `createdAt`/`updatedAt`
     (set before `insert`, L50/56 and L99/104-105) and the `DataType`'s `createdAt`/`updatedAt` (L75-76,
     L125-126) — confirms design's claim that `now` must be threaded in, not recomputed, to preserve
     exact timestamp sharing.
   - `Left(err)` branch in both methods constructs `CreateSourceResponse(source =
     DataSourceResponse.fromDomain(inserted), dataType = None, fetchError = Some(err))` — identical
     shape in both copies, matching Decision 3's claimed "same field-for-field" output.
   - `Right(schema)` branch in both methods: same `DataType` field set (`id`/`sourceId`/`name`/`fields`/
     `version = 1`/`createdAt`/`updatedAt`/`ownerId`), same `dataTypeRepo.insert(dt, user)` call, same
     `DataTypeResponse.fromDomain(createdDt)` wrapping — confirmed identical between `createSql` and
     `createRest` apart from `SchemaInferenceFacade.toDataFields(schema)` vs
     `toDataFields(schema, overridesMap)`, which the design's signature (`overrides: Map[...] =
     Map.empty`) accounts for.
   - `DataTypeRepository.insert(dt: DataType, user: AuthenticatedUser): Future[DataType]` (confirmed at
     `backend/src/main/scala/com/helio/infrastructure/DataTypeRepository.scala:105`) matches the
     dependency the helper signature takes.
   - No field, timestamp-sharing, or ordering difference found. Design's code sketch is sound.

2. **HEL-311 message hygiene — no re-wrap/re-curate.** Read the HEL-311 comments in
   `RestApiConnector.scala` (L74-77, L85-88, L110-113) and `SqlConnector.scala` (L99-102): curation
   (dropping raw driver/parser/exception text, logging the cause, returning only a generic category
   string) happens entirely inside `inferSchema`/`fetch`, before the `Either[String, _]` ever reaches
   `SourceService`. The existing `SourceService.createSql`/`createRest` code today does nothing to
   `err` except wrap it in `Some(...)` — design.md Decision 4 and spec.md's "No raw exception text in
   fetchError" requirement correctly describe this boundary and correctly forbid the helper from
   touching `err`'s content. Consistent with the four `refreshSql`/`refreshRest`/`previewSql`/
   `previewRest` "HEL-311: err is already ... curated" comments cited as precedent (confirmed present
   at SourceService.scala L183-185, L199-201, L229-231, L245-247).

3. **No scope creep.** `grep`'d `backend/src/main/scala/com/helio/services/DataSourceService.scala`
   for `CreateSourceResponse`/`inferSchema`/`Connector[` — zero matches, confirming design's claim that
   CSV/Static creation never touches the Connector SPI or this envelope, so the stated non-goal (no
   `DataSourceService` changes) is accurate, not hand-waved. Cross-checked the "Sibling ownership map"
   in the archived HEL-449 design
   (`openspec/changes/archive/2026-07-24-connector-spi-shared-trait/design.md:103-111`) against
   ticket.md's reproduced table — identical assignment of HEL-460/480/484 concerns away from this
   ticket. No refresh-path or new-connector code appears anywhere in proposal.md/design.md/tasks.md.

4. **spec.md requirements testable, tasks.md coverage.** All six spec.md requirements ("Shared
   create-time envelope helper," "No raw exception text in fetchError," "createSql and createRest use
   the shared helper," "Envelope contract documented on Connector," "A new connector gets the envelope
   by construction") map to tasks 1.1-1.4 and 2.1-2.3 with no gaps. Confirmed the "test connector
   demonstrates the envelope by construction" acceptance criterion (task 2.2) mirrors the real
   precedent: read `backend/src/test/scala/com/helio/domain/NewConnectorInferenceSpec.scala`'s
   `RowSupplyingConnector` (L16-39, `object RowSupplyingConnector extends Connector[RowSupplyingConfig]`
   implementing all four trait methods with a minimal fixture) — the pattern task 2.2 proposes to mirror
   is real and directly applicable.

5. **Wire-shape backward compatibility.** Confirmed `CreateSourceResponse` is defined at
   `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala:150-154` as `(source:
   DataSourceResponse, dataType: Option[DataTypeResponse], fetchError: Option[String])`, serialized via
   `jsonFormat3(CreateSourceResponse.apply)` (line 410). Design/proposal do not touch this case class or
   its formatter — only `SourceService`'s construction call sites change. No new field introduced, so
   the HEL-613 spray-json-omits-None gotcha flagged in ticket.md does not apply here (correctly not
   addressed further, since no new Option field is added).

6. **Planner Notes self-approvals.** All four are mechanical, low-risk, and consistent with cited
   precedent (branch prefix matches HEL-449/473; additive capability spec vs. connector-spi delta is
   directly justified by the real "Existing SqlConnector/RestApiConnector behavior unchanged" scenario
   already in `openspec/specs/connector-spi/spec.md:43`, confirmed present; file naming mirrors
   `SchemaInferenceFacade.scala`; no-`DataSourceService`-touch is independently verified in point 3
   above). None hide an escalation-worthy decision.

No `TODO`/`TBD`/placeholder language found anywhere in proposal.md, design.md, tasks.md, or spec.md
(grep across all four, zero matches).

### Verdict: CONFIRM

### Non-blocking notes

- Task 2.3 ("code-review-level check backed by the 2.2 fixture test") is a slightly soft acceptance
  signal for "helper never inspects/transforms err's content" — the fixture test asserting exact
  string pass-through (task 2.2) is what actually catches a regression; the code-review framing in 2.3
  is fine as an additional discipline note but isn't independently enforceable. Not blocking since 2.2
  already carries the real test.
