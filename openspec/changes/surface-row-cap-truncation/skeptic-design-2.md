## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold review. Every claim below re-derived by reading the code in this worktree, not from
skeptic-design-1.md's prose and not from the artifacts'.

### What I verified (with evidence)

**CR-1 (D6 rewrite) — LANDS.**
- `CreateSourceEnvelope.build` genuinely has the schema in hand at the construction point:
  `CreateSourceEnvelope.scala:47` binds `case Right(schema)`, and the success
  `CreateSourceResponse(...)` is built at `:60` inside `dataTypeRepo.insert(dt, user).map { … }`,
  still inside that `Right(schema)` branch. So a generic `rowCapNotice` composed from
  `schema.observedRowCount` is reachable with **no second request**. Confirmed.
- `InferredSchema` is `final case class InferredSchema(fields: Seq[InferredField])`
  (`model.scala:628`) and has **no spray-json format** — `grep` for a format finds only
  `inferredSchemaResponseFormat` (`DataTypeProtocol.scala:69`, `jsonFormat1(InferredSchemaResponse)`),
  a separate wire type. Confirmed additive.
- Construction sites: `SchemaInferenceEngine.scala:17,22,25,37,40,44,61`, `ConnectorSpec.scala:33`,
  `CreateSourceEnvelopeSpec.scala:123`, `SchemaInferenceFacadeSpec.scala:11,55` — **14 sites**, all
  single-positional-arg, all safe under a defaulted second field. (`SourceService.scala:171,193,202`
  are `toInferredSchema(schema)` conversions to the *response* type, not constructions.) No
  `case InferredSchema(...)` pattern match exists anywhere, so the Scala 2.13 unapply-arity trap
  does not bite. The design's "15 construction sites" is 15 grep hits including the declaration
  line — 14 actual. Cosmetic; the safety conclusion holds.
- `RestApiConnectorDriver.inferSchema` (`:334-335`) really does have the count:
  `fetch(config, resolveContext).map(_.flatMap(json => toRowsEither(json, config.rootSelector)).map(rows => SchemaInferenceEngine.inferSchemaFromRows(rows)))`
  — `rows` is in scope, unbounded (the 2-arg uncapped overload), and its size is currently
  discarded. Note it does **not** construct `InferredSchema` itself, so the implementation is a
  `.copy(observedRowCount = Some(rows.size.toLong))`; still free, still one request.

**CR-2 (D8) — mechanism is real, plumbing is under-specified (see CR-1 below).**
- `grep -rn loadSource` over `backend/src`: `src/main` consumers are exactly
  `JoinStep.scala:57`, `UnionStep.scala:71`, `LookupStep.scala:88`, plus the field declaration
  (`PipelineStep.scala:77`) and the single production binding
  `InProcessPipelineEngine.scala:200` (`loadSource = (ds: DataSource) => loadRows(ds, dataSourceRepo)`).
  The three-kind claim and the single-choke-point claim are both **TRUE**.
- **Concurrency is safe, and the `assertionSink` precedent does establish it.**
  `executeWithStepCounts` (`:83-110`) is a `steps.foldLeft` over `Future`s — strictly sequential,
  one step at a time; no step forks parallel `loadSource` calls (each of Join/Union/Lookup makes
  exactly one, then `.map`s). Independently, `AssertionSink` (`AssertionResult.scala:35-45`) is a
  `private var` guarded by `synchronized` on both `record` and `results`, constructed fresh per run
  (`PipelineRunService.scala:350`, and a defaulted `new AssertionSink` per call). So a mutable
  per-run accumulator of the same shape is safe on both grounds. This was the revision I was asked
  to scrutinise hardest; it survives.

**CR-3 — LANDS, and the line numbers are exact.** `grep "extends ConnectorDriver"` returns five:
`RestApiConnectorDriver.scala:49`, `SqlConnectorDriver.scala:12`, `ConnectorSpec.scala:19`,
`NewConnectorInferenceSpec.scala:25`, `CreateSourceEnvelopeSpec.scala:31`. Verified each cited
fixture line and each cited `fetch` line (`:37`, `:36`, `:43`) by reading the exact lines — all
three are `def fetch(config, maxRows, resolveContext)` returning
`Future[Either[String, Vector[JsValue]]]`, i.e. genuinely implementations that will fail to compile
under D1. Task 1.5 names all three and correctly distinguishes them from call sites (1.6).

**CR-4 — arities are right.** `RunResultResponse` (`PipelineProtocol.scala:95`) has exactly 7 fields
(`rows, rowCount, stepRowCounts, sourceRowCount, runId, blocked, blockedReason`) and
`jsonFormat7` at `:153`; +4 new fields ⇒ **`jsonFormat11` is correct**. `CreateSourceResponse`
(`DataSourceProtocol.scala:178`) has 3 fields, format `jsonFormat3` at `:465` ⇒ **`jsonFormat4` is
correct**; both cited line numbers are exact. proposal.md now says `jsonFormat7 → jsonFormat11`,
agreeing with task 3.1 — the round-1 contradiction is gone. Verification tasks 7.6a (create
advisory, three scenarios, content-asserted) and 7.6b (secondary-source truncation, explicitly
red-if-the-accumulator-is-dropped) exist and assert content, not presence.

**Independent set re-derivations (requirement 3):**
- `RunResultResponse` construction sites in `src/main`: **3** — `PipelineRunService.scala:135`
  (`recordUnrunnable`), `:212` (step preview), `:425` (real run). All three are now named in the
  artifacts (D4 and task 3.5). Matches.
- `ctx.loadSource` consumers: 3 (above). Matches.
- `InferredSchema` construction sites: 14 (above). Artifacts say 15 — cosmetic.
- `ConnectorDriver` implementations: 5 (2 production, 3 test). design.md now says so; tasks agree.
- `CreateSourceResponse` construction sites: **2**, both in `CreateSourceEnvelope.scala` (`:42`,
  `:60`) — so the defaulted `rowCapNotice` is trivially safe, and `SourceService` needs no edit.

**Artifact consistency (requirement 4).** The round-1 contradiction is resolved *by satisfying the
spec*, not by weakening it: D8 makes `sourceTruncated = truncatedReads.nonEmpty` (run-wide), and
design.md's Non-Goals now scope the exclusion to a per-secondary-source *total*, not to reporting.
The capability spec's unqualified "distinguishable at every surface" is now true as designed, and it
adds explicit union/join/lookup scenarios. proposal.md's "Secondary sources count too" bullet agrees.
No contradiction found among proposal/design/tasks/spec on this axis.

**Other new-prose spot checks against code (requirement 2):** `maxRunRows` docblock and value at
`InProcessPipelineEngine.scala:65` (`private val maxRunRows: Int = 1000`); preview path
`PipelineRunService.scala:203-212` calls `engine.loadRows` then `executeWithStepCounts` with **no**
assertion sink argument; run path `:365-368` passes `assertionSink` explicitly. MCP:
`types.ts:330-335` `RunResultResponse`, `helioApi.ts:86-90` `RunOutcome` + `:559-565` whitelist
mapping (`sourceRowCount: result.sourceRowCount ?? 0` — so task 4.2's "never `undefined`" instruction
matches the existing idiom), `write.ts:366-370` tool description does promise
`{ status, rowCount, outputDataTypeId }`. Frontend: `pipelineService.ts:138-143` `RunResult`,
`pipelinesSlice.ts:97-98` `runSourceRowCount`. Every cited line checked out.

### Verdict: REFUTE

Both change requests are the same failure class the gate exists to catch: an artifact elsewhere
*forbids* an outcome that the unspecified mechanism makes the likely implementation. Neither is
large; both are cheap to close now and expensive to discover at execution time.

### Change Requests

1. **D8's accumulator has no specified route out of the engine — and the step-preview path will
   ship a false `sourceTruncated: false`.** D8 and task 2.2a say `loadSource` appends to "a per-run
   accumulator … following the existing `assertionSink` precedent", but nothing states *how
   `PipelineRunService` obtains it*. The precedent's actual shape is a **caller-supplied output
   parameter** on `executeWithStepCounts` (`InProcessPipelineEngine.scala:87`,
   `assertionSink: AssertionSink = new AssertionSink`), constructed by the caller before the engine
   call (`PipelineRunService.scala:350`) and read after. Critically, following that precedent
   *literally* reproduces its gap: the **step-preview** site (`PipelineRunService.scala:205`) calls
   `executeWithStepCounts(sourceRows, slicedSteps, dataSourceRepo)` with **no sink**, i.e. on the
   default throwaway. A preview whose `union`/`join`/`lookup` reads a truncated secondary source
   would then report `sourceTruncated: false` — the exact "positive assertion of completeness that
   is false" D8 says is worse than the bug, and it is required by the spec ("The same fields SHALL
   be carried by the step-preview run result", `specs/pipeline-run-execution/spec.md`). Task 7.6b
   only covers the run path, so it would ship untested and green. Required: state in D8 and task
   2.2a that the accumulator is a new defaulted caller-supplied parameter on
   `executeWithStepCounts` (mirroring `assertionSink`, thread-safe the same way — `AssertionSink`
   guards its `var` with `synchronized`), and that **both** `PipelineRunService` sites — the run
   site (`:365`) *and* the preview site (`:205`, which currently passes none) — must construct one,
   pass it, and merge it with the primary read's stats. Extend 7.6b (or add 7.6c) to cover the
   preview path.

2. **Task 2.4's "public accessor for `maxRunRows`" does not reach `CreateSourceEnvelope`, so the
   create advisory has no cap value to interpolate.** `InProcessPipelineEngine` is a
   `class … (fileSystem, connector)(implicit ec)` (`:54`) with **no companion object**, and
   `maxRunRows` is an instance `private val` (`:65`). `PipelineRunService` holds an `engine`
   instance so an instance accessor works there — but `CreateSourceEnvelope.build`
   (`CreateSourceEnvelope.scala:31-39`) takes `(connector, config, source, now, dataTypeRepo, user,
   overrides)` and has **no engine reference and no way to get one** without a signature change.
   Task 6.4 asks it to compose `rowCapNotice` "when it exceeds the run cap"; with 2.4 as written the
   path of least resistance is a hardcoded `1000`, which design.md's final Risk bullet and the spec
   ("SHALL interpolate the cap value … rather than embedding a literal") both forbid. Required:
   make 2.4 specific — introduce `object InProcessPipelineEngine { val MaxRunRows: Int = 1000 }`
   (with the instance `private val maxRunRows` referring to it, so the value stays defined once) —
   and state in 6.4 which symbol `CreateSourceEnvelope` reads. If instead the cap is to be passed
   into `build` as a parameter, say that and name the callers that must supply it
   (`SourceService.createRestWithConfig:156` and the SQL create path).

### Non-blocking notes

- proposal.md still says "Exactly two implementations and exactly two production call sites exist"
  (What Changes, SPI bullet). design.md and task 1.5 were corrected to "two production, three test
  fixtures"; proposal.md was not. The actionable artifacts are right, so this is not blocking, but
  it is the same sentence round 1 refuted, still in the tree.
- proposal.md's Impact list names `SourceService.scala` for the create-time advisory, which D6/task
  6.4 explicitly says to leave untouched, and omits the two files the corrected design *does* change:
  `services/sources/CreateSourceEnvelope.scala` and `domain/model/model.scala`.
- proposal.md writes `FetchOutcome(rows, availableRowCount, truncated)`; design D1 and tasks 1.3/1.4
  use `(rows, truncated, availableRowCount)`. Harmless (tasks use named args), but pick one.
- "15 construction sites" for `InferredSchema` (D6, task 6.2) is 14; the 15th grep hit is the
  declaration at `model.scala:628`.
- D6/task 6.3 say `RestApiConnectorDriver.inferSchema` "populates `observedRowCount`"; it does not
  construct the `InferredSchema` (it delegates to `SchemaInferenceEngine.inferSchemaFromRows`), so
  the implementation is a `.copy(...)` on the returned schema. Still free, still one request — worth
  one clause so the executor does not restructure the facade call.
- `truncatedReads` is added to the wire body (task 3.1) but not to the MCP type (4.1) or the
  frontend types (5.1/5.2). Defensible — the composed notice names each truncated source, and no
  spec scenario requires `truncatedReads` at those two surfaces — but say so, or a later reader will
  read it as an oversight.
- Tests 7.1-7.5, 7.6a, 7.6b, 4.4 and 5.4 all assert *content* (the numbers inside the notice, the
  available count) rather than key/test-id presence, and 7.2 and 7.6b are each written to go red on
  a specific plausible regression (`>` → `>=`; dropping the accumulator). No
  green-over-the-wrong-input trap found in section 7.
