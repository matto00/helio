## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 2dd4ed6237817b1feef22d69f8bc8058e58541db (planning artifacts untracked under the change dir).

### What I verified (with evidence)

- **Core defect is real.** `PipelineService.buildStepsAction` (PipelineService.scala:524-602) checks duplicate clientId, type,
  parentStepId, `PipelineStepConfigCodec.decode`, lane rewrite. It never calls `validateRawConfig`. `validateStepCrossOwnerRefs`
  (L399-471) only decodes, and a decode failure there falls through to `buildStepsAction`.
- **422 over the ticket's 400 is correct.** Every existing `validateRawConfig` surface returns `UnprocessableEntity`:
  `addStepReporting` L1830-1838, `updateStep` L2184-2187, `PipelineProposalService.validateSteps` L295-297,
  `PatchSetApplyResolvers` L205. `openspec/specs/pipeline-step-config-rejection/spec.md` L4 and L97-104 make 422 the
  capability's status, and its compute requirement already says "so no write surface can accept what another rejects". The AC
  asks for a response "consistent with validateRawConfig", so 422 matches what it wants. The planned order (type, then
  validateRawConfig, then decode with 400) matches `addStepReporting`.
- **The message carries the function name and the supported list.** `ComputeStep.validateRawConfig` (ComputeStep.scala:99-104)
  returns `compute: invalid expression: <parseProblem>`. `checkArity` (ExpressionEvaluator.scala:221-229, called from the strict
  parser at L293) produces `'x' is not a recognized function; supported functions: ...`.
- **The red tests for single-call create are plausible.** On base, cast `casts`-as-array and an aggregate with an unsupported
  `fn` decode without error: `CastStep.scala:91-93` says the read-path decode stays lenient, and `AggregateStep.scala:182-187`
  layers its check on top of decode. So base returns 201 and these tests will actually go red.
- **Callers of `create`.** I grepped `CreatePipelineRequest(` and `pipelineService.create(` and found exactly three callers:
  `PipelineRoutes.scala:34` (REST/MCP), `PipelineProposalService.scala:455-468` (proposal apply) and
  `PatchSetApplyForward.scala:87` (patch-set pipeline-create). The frontend `createPipeline`
  (frontend/src/features/pipelines/services/pipelineService.ts:35-53) sends no steps. The table has no missing caller of `create`.
- **Legacy reads are untouched.** No read or analyze path is in scope. Analyze already reads `validateRawConfig` as an issue
  (PipelineAnalyzeService.scala:370). Task 4.4 pins this.
- **helio-news (read-only grep).** Step configs come from three places. `news/projects/build.py:85-88` sends filter
  `{combinator,conditions:[{field,operator:"=",value:"true"}]}` and aggregate `{groupBy:[],aggregations:[{alias,field,fn:"count"}]}`.
  `news/enrichers/series.py:76-84` sends aggregate with `groupBy:[{name,type}]` and `fn:"avg"`, plus sort `{sortBy:[{direction,field}]}`.
  `news/enrichers/__init__.py:62-66` sends the default select `{fields:[...]}`. This matches design decision 6 exactly.
  `build_shape_pipeline` (news/helio_client.py:239-265) creates a bare pipeline and then calls `add_outputs_from_shape`. That tool
  writes each expansion with `addPipelineStep` (helio-mcp/src/tools/pipelinesHandlers.ts:241-251), which goes through
  `addStepReporting` and is already validated. It never reaches the create path this change touches. Planned task 4.1 is enough.
- **Patch-set apply HTTP semantics.** This is the basis for CR1. `PatchSetApplyService.apply` (L71-75) maps a resolve-phase
  `Left` to an HTTP error status. A forward-apply failure (`applyResolved`, L111-129) is rolled back and returned as
  `Right(PatchSetApplyResponse(..., failure = Some(err.message)))`. The route always returns `StatusCodes.OK`
  (PatchSetRoutes.scala:41-43). `resolvePipelineCreate` (PatchSetApplyResolvers.scala:538-578) pre-checks roots only.
- **Undo, rollback and duplicate.** This is the basis for CR2. `PatchSetUndoService.scala:231,265,270` and
  `PatchSetApplyRollback.scala:158,209,216` call `pipelineService.addStep` and `updateStep`. Both already run
  `validateRawConfig`, and `fullPipelineStepInverse` always carries `config` (PatchSetUndoInverse.scala:122-133). Only
  `duplicateStep` (PipelineService.scala:2348+) is really unvalidated: it only round-trips the stored config through decode and
  encode.
- **Server-generated steps.** Also the basis for CR2. First-run (FirstRunDashboardService.scala:66) and persona templates
  (L99-105, PersonaTemplates.scala:42) both call `pipelineProposalService.apply`. `apply` runs `validateStructure`, and
  `validateStructure` runs `validateSteps` (PipelineProposalService.scala:114-118, 152-158), so those configs are already
  validated today. `PipelineShapeService.expand` (L51-57) is pure and persists nothing.

### Verdict: REFUTE

### Change Requests

1. **The patch-set pipeline-create outcome contradicts the code: required revision.** spec.md says "A patch-set pipeline-create
   edit with an invalid step config is rejected ... THEN the apply is rejected with 422". Task 2.3 says "apply rejected 422", and
   design decision 4 says "A test pins the apply-time 422". Decision 4 also keeps `resolvePipelineCreate` unchanged, so the
   rejection happens in `PatchSetApplyForward` at apply time. An apply-time failure always returns **HTTP 200** with `failure`
   set and earlier edits rolled back (PatchSetApplyService.scala:111-129, PatchSetRoutes.scala:41-43). It is never a 422. As
   written, the test either fails after the fix or pushes the executor into a resolver change that decision 4 rules out. Pick one
   option and make spec, design and tasks agree:
   - (a) Keep validation at apply time only. Change the scenario and task 2.3 to: 200, `failure` contains
     `Step '<clientId>': compute: invalid expression: ... nosuchfn ...`, no pipeline persisted, and any edit applied earlier in
     the set rolled back. The red on base is "applied, pipeline exists".
   - (b) Also add the same `validateRawConfig` loop to `resolvePipelineCreate`. This matches how pipelineStep create/update edits
     are already validated at resolve time with 422 (PatchSetApplyResolvers.scala:205), and preview would surface the error too.
     Then 422 is correct, and decision 4 plus the Impact list must say so.
   Either is acceptable. The current text contradicts itself.

2. **Fix the write-path table and non-goals so they match ground truth: required revision.** The user asked specifically for this
   table to be checked.
   - The "Step duplicate, patch-set undo/rollback ... Out of scope" row and the matching non-goal ("a legacy invalid step must
     stay duplicable/restorable") are wrong for undo and rollback. Those re-writes already go through `addStep`/`updateStep` with
     `validateRawConfig` today (see above). Today a legacy invalid step can already *not* be restored through them. Reclassify
     undo/rollback as "Yes (already validated via addStep/updateStep), unchanged by this ticket". Keep `duplicateStep` as the only
     genuinely unvalidated re-write. Otherwise the executor or evaluator may "preserve" a property that doesn't exist, or claim
     credit for a non-goal.
   - The "Server-generated (shape expansion, first-run) ... Becomes validated" row is misclassified. First-run and persona
     templates (which the table doesn't list) already pass `validateSteps` in `PipelineProposalService.apply` before `create`.
     Shape expansion is not a write path: its MCP consumer writes through `addStep`, which is already validated. Correct the row.
     Design decision 5 and task 4.2 can stay as a cheap guard, but their rationale ("becomes validated", "would break
     shapes/first-run") should say they are a non-regression pin, not a newly exposed risk.
   - Design decision 6's line "build_shape_pipeline ... covered by decision 5" should say these steps go through
     `add_outputs_from_shape` → `addPipelineStep`, which is already validated and untouched here.

### Non-blocking notes

- The delta uses `## ADDED Requirements`. The existing compute requirement (spec.md L97-104 of the base capability) lists the
  surfaces as "step create, step update, pipeline-proposal apply, and patch-set apply". Consider adding single-call create to
  that list with a MODIFIED delta, so the base spec doesn't keep an incomplete enumeration.
- Task 2.4 (proposal apply) can't go red: `validateStructure` rejects first with `step N:`. The design already says so. The
  executor should label 2.4 a regression pin, not a red-first proof.
- When stating the response on the cast scenario, check that `requireStringMap`'s message is what reaches the caller after the
  `Step '<id>': ` prefix. The spec only asserts that it names `casts`, which is fine.
