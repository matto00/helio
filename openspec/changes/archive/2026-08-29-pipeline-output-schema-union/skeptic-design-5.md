# Skeptic Report — design gate (round 5, skeptic-design-5.md)

## What I verified (with evidence)

### Round-4 CR1 (two-fixture split) — RESOLVED, and both fixtures are constructible

- Task 1.1 now specifies fixture (i) (heterogeneous JSON source, shapes (a),(b),(c),(e),(f),(g),(h))
  and fixture (ii) (single-row image source, shape (d) only). Test 1.8 says "against fixture (ii)".
- The premise is re-verified against code, not taken from round 4: `PipelineRowJson.jsRowToRow`
  (`PipelineRowJson.scala:95`) is `case obj: JsObject => JsonFlattener.leaves(obj)...`, so every
  JSON-bearing source flattens nested objects at ingest; `jsValueToAny(JsNull) = null` (:54) and all
  scalars pass through, so shapes (a),(b),(c),(e),(f),(g),(h) survive ingest.
  `InProcessPipelineEngine.loadImageRowFromBytes` (:318-333) is confirmed as the sole nested-map
  producer, returning exactly one fixed six-key row.
- **New check round 4 did not make: is fixture (ii) actually buildable in a service-layer spec?**
  Yes — `PipelineRunRoutesSpec.seedDsImage` (`:151-168`) is an existing precedent: a temp PNG written
  via `ImageIO.write`, absolute path in `{"path": ...}`, `source_type = 'image'`. The engine's
  `ImageSource` branch (`InProcessPipelineEngine.scala:206-219`) reads it through `fileSystem.read`,
  and `PipelineRunServiceSpec` already constructs `new LocalFileSystem(Paths.get("/"))` (:93), which
  resolves absolute paths. So the split is not merely stated, it is executable.

### Round-4 CR2 (materialization seam) — RESOLVED, and every constraint it states is TRUE

- Task 1.1 names the seam: a real run through `PipelineRunService.submit`, as `PipelineRunServiceSpec`
  does. Verified: `submit` is the public entry, `stubConnector` is a `RestApiConnectorDriver` with a
  `fetchOverride` keyed on `config.connectorId` (`PipelineRunServiceSpec.scala:52-65`), so adding a new
  keyed URL returning a heterogeneous `JsArray` is a two-line extension of an existing pattern.
- Static-source rectangularity is true: `PipelineRowJson.parseStaticRows` zips a fixed `colNames`
  against each row, so it cannot express shape (a). The instruction to use a JSON-returning source
  is correct and necessary.
- The private-method/compile-against-both-versions constraint is true: `upsertFieldsFromRows` and
  `onUnblockedRunSuccess` are both `private`, and task 2.1a changes the former's signature.
- Capability-report assertions (1.3/1.4/1.11b) are constructible in the same spec:
  `PanelCapabilityService` takes only `DataTypeRepository` + `DataTypeRowRepository`
  (`PanelCapabilityService.scala:22-25`), both already wired in that spec's `beforeAll`.

### Round-4 non-blocking note (fractional literal) — FOLDED IN AND CORRECT

Task 1.1(b) now pins `12.5` and states the reason. Verified against code:
`jsValueToAny` collapses `JsNumber(n) => n.toDouble` (`PipelineRowJson.scala:56`) and
`inferJsonType` decides on `n.scale <= 0 || n.remainder(BigDecimal(1)) == 0`
(`SchemaInferenceEngine.scala:149-152`), so `1.0` would infer `integer`. `12.5` infers `float`.

### Nothing from rounds 1-4 regressed

I re-derived each prior CR against the current artifacts rather than trusting round 4's summary:
- R1-CR1 (nested rows reach output) → D2 + new D2a, pinned by test 1.8.
- R1-CR2 (D6's false additivity claim) → D6 corrected into the key-set/eligibility split, pinned by
  1.9 and task 3.4's two-part check.
- R1-CR3 (three transitions) → D5's A/B/C table intact, with the consumer rows unchanged.
- R1-CR4 (displayName) → D7 raw-name decision, pinned by 1.10.
- R1-CR5 (fixture enumeration) → shapes (d),(e),(f) present; 1.12 extends the "red for the right
  reason" requirement to every test.
- R2-CR1/CR2 (JsNull must not join; null shape in fixture) → D8 + task 2.1's first bullet + shapes
  (g)/(h) + tests 1.11a/1.11b. D8 mirrors `inferFromObjects`' real `case JsNull` branch
  (`SchemaInferenceEngine.scala:101-107`), verified.
- R3-CR1/CR2 (shape (g) colour; all-null column) → 1.1(g)'s integral/off-row-0 constraints and 1.11b's
  presence-first assertion order, both re-verified against `inferFieldType` (:741-747).

### Independent adversarial checks I ran that no prior round ran

- **Type-lattice reachability for every fixture shape.** Traced (b),(c),(e),(f),(g),(h) through
  `anyToJsValue` -> `inferJsonType`/`widenJson`. Each yields the type its task asserts:
  (c) integer+float -> `FloatType`; (e) number+"N/A" -> catch-all `StringType`; (f) ISO date ->
  `isTimestamp` -> `TimestampType`; (g) integral doubles + JsNull skipped -> `IntegerType`;
  (h) empty accumulator -> `getOrElse(StringType)`. No shape asserts an unreachable type.
- **Implementation-spec self-consistency.** Tasks 2.1-2.5 are unaffected by the round-4 revision and
  remain consistent with D1/D2/D3/D7/D8; no new call-site or deletion obligation was introduced.

## Verdict: CONFIRM

Round 4's two change requests are genuinely resolved — and, unlike a paper resolution, both are
executable against real precedents I located in the existing suite. Nothing from rounds 1-4
regressed. The one inconsistency I found (below) fails both limbs of the blocking test: it does not
make the shipped code wrong, and it does not make any test unable to detect the regression it
claims — the affected tests are correct as written; only their expected pre-change colour is
mislabelled in a reporting instruction, and the task list already models the correct handling twice.

## Non-blocking notes

1. **Task 1.12's exception list is under-enumerated by three tests. Read this before recording the
   red.** 1.12 names only 1.11a and 1.11b as green-before regression guards and says "every other new
   test must be red before the change". By the design's own text, three more are also green before
   AND after, and that is correct, not a defect:
   - **1.7** (every field `nullable = true`) — pre-change code hardcodes `nullable = true`
     (`PipelineRunService.scala:755`), so it cannot be red. It guards D3.
   - **1.8** (nested `content` is one field typed `string`, no dotted fields) — D2 states outright
     "`content` is typed `string` before and after — behaviour preserved exactly"; pre-change
     `inferFieldType`'s catch-all (:746) already returns `"string"` for a `Map`. It guards D2.
   - **1.10** (`displayName` equals the raw column name) — pre-change writes `DataField(name, name, ...)`.
     It guards D7.
   Treat all five (1.7, 1.8, 1.10, 1.11a, 1.11b) as regression guards: record the pre-change green as
   deliberate evidence, exactly as 1.12 already instructs for 1.11a/1.11b. **Do not delete, weaken, or
   attempt to manufacture a red for 1.7/1.8/1.10** — they are the only pins on D3, D2 and D7
   respectively, each installed in response to a round-1 change request. The genuinely-red set is
   1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 1.11.
2. D5's `WorkspaceContextService` line references remain a few lines off (carried from rounds 2-4).
   Substance holds.
