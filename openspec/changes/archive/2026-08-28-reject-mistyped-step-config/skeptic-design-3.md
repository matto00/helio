## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold review. Every claim below is derived from the tree in this worktree, not from prior reports.

### What I verified (with evidence)

**1. Decision 5's two-surface distinction — CORRECT, traced end to end.**
- `PipelineService.analyze` (`services/pipelines/PipelineService.scala:158-168`) builds
  `PipelineAnalyzeService.PipelineStepInput(..., config = PipelineStepConfigCodec.encode(s))` from
  `pipelineStepRepo.listByPipelineInternal`. `PipelineStepRepository.rowToDomain:258-261` decodes the row
  with the tolerant `PipelineStepConfigCodec.decode`. `CastConfig.decode` (`domain/steps/CastStep.scala:20-27`)
  maps a non-`JsObject` `casts` to `Map.empty` via `case _`, so the re-encode (jsonFormat1) yields
  `{"casts":{}}`.
- `inferCast` (`domain/engine/PipelineAnalyzeService.scala:245-250`) does
  `json.fields("casts").convertTo[Map[String,String]]` inside `parseConfig` (`:638-651`). On `{"casts":{}}`
  that succeeds → `(schema, None)`. **No validationError on the stored route — confirmed.**
- `PipelineService.analyzeProposal:251-257` builds `config = req.config.compactPrint` — never round-tripped.
  A list-shaped `casts` reaches `inferCast` intact, `convertTo[Map[String,String]]` on a `JsArray` throws,
  `parseConfig` catches → `Some("cast config error")`. **Non-empty validationError on the proposal route —
  confirmed.**
- `validateStepConfig:102-127` has no `cast`/`rename` case (`case _ => Vector.empty`) — confirmed, so
  Decision 5's statement that the hook itself observes nothing raw is right.

**2. Task 2.1 implementability.** `PipelineAnalyzeProposalRoutesSpec.scala` exists and already has a
precedent test at :317 ("surface a per-step validationError (not a 500) for a step with an invalid config").
Task 2.1 is directly implementable there. Task 2.1a has a gap — see CR-2.

**3. Decision 6's table — accurate in classification, mildly incomplete in per-file listing.**
`domain/steps/` holds 24 `.scala` files (23 step files + `StepCodecUtil`); `grep -l 'def decode(raw'`
returns exactly 23. `GroupByStep.scala:22-27` and its `stringOr(obj,"aggFunction","sum")` are real, as
described. `AssertStep.decodeRule:58-73`'s non-object → all-defaults arm is real. `StringOpsStep:49`
(`fields`) is real. See non-blocking note 1 for two omitted sites.

**4. Decisions 1/2/3/4/7 — verified.**
- D1: `PipelineStep.Companion` trait (`domain/model/PipelineStep.scala:91-110`) with the
  "must be tolerant" `decodeConfig` scaladoc; `Registry` has exactly 23 entries, each an anonymous
  `new PipelineStep.Companion { ... }` — so "21 others untouched" is right, and a defaulted method is
  source- and binary-safe for them.
- D2: `ServiceError.UnprocessableEntity` (`services/ServiceError.scala:27`) →
  `StatusCodes.UnprocessableEntity` (`api/routes/ServiceResponse.scala:82`);
  `helio-mcp/src/httpClient.ts:237-243` renders `<status> <statusText>: <message>`. The
  `PipelineShapeService.scala:55` precedent is real. `addStep`'s `PipelineStepKind.All` 400 check at :461-463
  precedes the decode at :466 as described; `updateStep`'s config branch decode is at :631.
- D3: `StepCodecUtil` is `private[steps]` and both step files are in that package — the shared helper
  placement works.
- D4: commit `a8ea26ae` added 8 validators and exactly 5 analyze test cases (window ×1, stringops ×2,
  fillnull ×2), so the uncovered failure-path set is exactly `aggregate/groupby/pivot/union/join` plus the
  `validateStepConfig` join. The union *pass*-path citation (`PipelineAnalyzeServiceSpec.scala:138`) and the
  window `include("median")` citation (`:695`) both check out. Line 126 (`validateStepConfig` join) vs line
  619 (`inferAssert`'s own join) — both exist, task 1.3's warning is correct.
  Round-trip survivability check for task 1.2: the values these five validators inspect (`Aggregation.fn`,
  `JoinConfig.joinType` via `stringOr`, union `mode`, pivot `agg`, groupby `aggFunction`) all survive
  decode→encode, so seeding via `pipelineStepRepo.insert` with a typed config genuinely reaches them.
- D7a: `inferOutputSchema:201-227` — the identity group is `filter|limit|sort|dedupe|fillnull|union` and
  neither `"groupby"` nor `"join"` appears in any arm; both fall to `case unknown`. Confirmed. And
  `validateStepConfig` does run first (`:71`), so the new invalid-enum assertions are honest while the
  valid-config negative is genuinely unassertable — task 1.4 is correct.
- D7b: every enum `match` is guarded by a preceding `SupportedX.contains` throw, so `MatchError` is
  unreachable today; deferring is defensible.

**5. Cross-artifact consistency.** ticket.md, design.md, tasks.md and both spec deltas now agree on the
two-surface story. `proposal.md` does not — see CR-1.

### Verdict: REFUTE

### Change Requests

1. **`proposal.md` still carries the exact claim round 2 refuted, and now contradicts its own spec delta.**
   - `proposal.md:29-30`: *"Add a test demonstrating HEL-859 Decision 7's raw-config-string contract: **the
     hook** sees a key that `CastConfig.decode` would silently reduce to `Map.empty`."* The hook
     (`validateStepConfig`) has no `cast` case and returns `Vector.empty`; a test asserting against it would
     assert the opposite of the truth. ticket.md's clarified AC7 and design Decision 5 both say so
     explicitly; proposal.md says the retracted thing.
   - `proposal.md:41-43`: *"the analyze-time validation contract gains an explicit, testable guarantee that
     **its hook** receives the RAW config string (so it observes keys the typed decoder drops)"* — stated
     unqualified, i.e. of the analyze surface generally. The spec delta it summarises
     (`specs/pipeline-step-config-validation/spec.md:28-37`) now binds the property to the **proposal**
     surface and explicitly disclaims the stored surface.
   Required: rewrite both bullets to (a) name `POST /api/pipelines/analyze-proposal` as the surface, (b)
   state that the observation happens in `inferCast`/`parseConfig`'s `validationError`, not in
   `validateStepConfig`, and (c) record that the stored-pipeline surface cannot report it, which is why the
   write-path 422 is the only detection point for a persisted step. This is not cosmetic: proposal.md is the
   capability-defining artifact, and as written it points an executor straight at the `validateStepConfig`
   test that task 2.2 forbids.

2. **Task 2.1a specifies no seeding mechanism, and the obvious one makes the test vacuous.**
   Every write seam in `PipelineStepRepository` (`insert:66`, `insertInternal:162`, `insertAtInternal:214`)
   takes a **typed** config and calls `encodeConfig`, and `stepsTable`/`PipelineStepRow` are `private`. So an
   executor following 2.1a as written will most naturally call
   `pipelineStepRepo.insert(pid, "cast", CastConfig(Map.empty), user)` — which stores `{"casts":{}}`, never
   the mistyped shape, and then "asserts" no validationError over a config that was never mistyped. That is a
   green test over the wrong input (standing requirement 3), and it would certify Decision 5's central claim
   without exercising it. After task 3 lands, the HTTP route cannot create such a row either.
   Required: amend task 2.1a to (a) seed the row with a raw `sqlu"INSERT INTO pipeline_steps ..."` carrying
   the literal `{"casts":[{"field":"x","to":"float"}]}` text — the mechanism `PipelineAnalyzeRoutesSpec.scala:73-95`
   already uses for `data_sources`/`data_types`/`pipelines` — and (b) assert the stored raw text is that
   mistyped shape *before* asserting the analyze response carries no `validationError`, so the negative is
   bound to real input.

### Non-blocking notes

1. Decision 6's table is complete at the *file-classification* level (every one of the 23 decoders lands in
   some row) but two sites are missing from their rows: `FilterStep.scala:35` uses
   `StepCodecUtil.stringOr(obj,"combinator","AND")` yet `FilterStep` appears only in the `flatMap(it => Try(...))`
   row, not the `stringOr/intOr` row; and `StringOpsStep.scala:42-43` (`pattern`, `separator`, both
   `collect { case JsString(s) => s }` → `None` on a wrong-typed value) is not listed anywhere — only
   `StringOpsStep:49` is. Task 5.1's raw unabridged re-enumeration at delivery is the binding artifact, so
   this does not change scope or any conclusion; fix the table opportunistically.
2. `proposal.md:6` and ticket.md say the create route "returns 200"; it returns **201** (design.md:19 has it
   right). Cosmetic.
3. `specs/pipeline-step-config-validation/spec.md:87` says "`join` step whose `type` is not supported"; the
   config key is `joinType` (`JoinConfig`). Inherited wording from HEL-859, not introduced here.
4. design.md cites the `decodeConfig` tolerance scaladoc as `PipelineStep.scala:95-98`; it is at 93-97 in
   this tree. Off-by-two, harmless.
