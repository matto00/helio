## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

1. **Round-1 required fix is present and specific enough to implement.**
   - `tasks.md` task 1.3: "Extend `Connector[Config]`'s trait-level doc comment in
     `domain/Connector.scala` with a `'''Schema inference'''` block ... (same location/precedent as
     HEL-449's `'''ExecutionContext'''` block)." Names the exact file, exact doc-block style, and exact
     content to add.
   - `design.md` Decision 2a states the same location/content decision with rationale (a sibling
     implementer will look at the trait doc comment, per HEL-449 precedent).
   - `specs/schema-inference-facade/spec.md` — new requirement "New connectors document their
     inference contract" with scenario "Trait doc comment names the inference contract" (lines 50-60):
     checkable by reading `domain/Connector.scala`'s doc comment after task 1.3 lands.
   - Cross-checked against the actual current file
     `backend/src/main/scala/com/helio/domain/Connector.scala`: the trait doc comment today has
     `'''Refresh semantics'''` and `'''ExecutionContext'''` blocks (lines 32-42) — confirms task 1.3's
     precedent claim is accurate (it's describing a real, existing pattern, not an invented one) and
     that adding a `'''Schema inference'''` block is a well-defined, mechanical addition.

2. **Non-blocking note 1 (EC asymmetry) folded in and verified accurate against source, not just
   asserted.** `design.md` Decision 4 states `RestApiConnector`'s "private implicit val ec =
   system.executionContext (line 30)" — read `RestApiConnector.scala`: line 30 is exactly
   `private implicit val ec: ExecutionContext = system.executionContext`. Traced the actual call
   chain: `inferSchema(config)(implicit ec)` (line 120-121) calls `fetch(config)` (no-ec, line 41) →
   `doFetch` (line 64, uses the class's own `ec` via the ambient implicit) for the I/O; the
   caller-supplied `ec` from the trait signature is only used in the outer `.map` (line 121,
   `fetch(config).map(_.map(json => ...))`), i.e. only to transform an already-completed `Future`.
   This independently confirms Decision 4's claim ("caller's ec is only ever used to transform an
   already-completed Future's result, never to run blocking work") is factually correct, not just
   plausible-sounding.

3. **Non-blocking note 2 (exact `toDataFields` signature) folded in and internally consistent.**
   `design.md` Decision 2 states `def toDataFields(schema: InferredSchema, overrides: Map[String,
   FieldOverridePayload] = Map.empty): Vector[DataField]`. Verified against real types:
   `FieldOverridePayload(name: String, displayName: String, dataType: String)`
   (`api/protocols/DataSourceProtocol.scala:143`) and `DataField(name, displayName, dataType: String,
   nullable: Boolean)` (`domain/model.scala:278`). The signature and the spec's three projection
   scenarios (no-override / matching-override / SourceService reuse) match `SourceService.scala`'s
   four existing inline duplicates exactly: `createSql` (line 63-65), `createRest` (116-124, override
   path — displayName/dataType substituted, nullable untouched), `refreshSql` (196-198), `refreshRest`
   (215-217). `tasks.md` 1.2/3.1/3.2/3.5/3.6 target exactly these four sites; 3.3/3.4 (`inferSql`/
   `inferRest`) correctly omit the projection since those paths build `InferredFieldResponse` via a
   separate `toInferredSchema` helper never duplicated with overrides — no scope gap there.

4. **Independently re-derived Decision 1's equivalence proof rather than trusting the prose.** Traced
   `SchemaInferenceEngine.fromJson`'s three match arms (`JsArray` / `JsObject` / scalar `case _`)
   against `RestApiConnector.toRows`'s three arms and confirmed by hand that
   `inferSchemaFromRows(toRows(json))` reproduces `fromJson(json)` in all three cases (array case is
   a direct passthrough; single-object case reduces to a no-op `mergeObjects` singleton; scalar case
   collects to zero `JsObject`s under the `collect` filter, matching `case _ => InferredSchema(Seq.empty)`).
   Also verified `SqlConnector.toRows(rows)` is byte-for-byte the same `JsArray` construction
   `SqlConnector.inferSchema(rows)` does today. Both proofs check out — the design's central
   behavior-preservation claim is not hand-waved.

5. **Traced all four ACs to tasks/spec scenarios**: unchanged output → tasks 2.1/2.2 + 4.1 (unmodified
   regression spec) + 4.2; single projection → task 1.2 + 3.1-3.6 + 4.3; test-connector-produces-correct-
   schema → task 4.4 + spec scenario; backward-compatible → 4.1 + the equivalence proofs above.
   Ticket scope bullet 3 (document rows contract) → task 1.3 + new spec requirement. No AC or scope
   bullet is uncovered.

6. **Checked for regressions/placeholders**: `grep -rniE "TODO|TBD|figure out|placeholder"` across all
   five artifacts returned nothing.

7. **Checked against precedent** (`openspec/specs/connector-spi/spec.md` and the archived HEL-449
   design.md): HEL-449's "Sibling ownership map" explicitly assigns "Schema-inference facade /
   polymorphic dispatch through the trait" to HEL-473, and states the EC-threading rule ("HEL-473...
   MUST keep threading its own (implicit ec) through") — Decision 3/4 of this design comply. No
   divergence from precedent found.

### Verdict: CONFIRM

### Non-blocking notes
- Decision 2's citation of `SourceConfigParsing.scala` as "precedent" for a services-layer object
  built around `FieldOverridePayload` is a slightly loose analogy (that file is a spray-json format
  re-export, not a projection function) — doesn't affect the layering conclusion itself (domain must
  not import api types), which is independently sound, so not blocking.
