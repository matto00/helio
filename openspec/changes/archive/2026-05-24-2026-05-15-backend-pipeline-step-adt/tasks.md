# Tasks — backend-pipeline-step-adt (CS2c-3a)

## 0. Bind to standards

- [x] 0.1 Read `WORKTREE_PATH/CONTRIBUTING.md` in full
- [x] 0.2 Read `ticket.md`, `proposal.md`, `design.md` (and inherit from `openspec/changes/2026-05-14-backend-domain-adts-foundations/design.md` for the CS2c-series pattern + `openspec/changes/2026-05-14-backend-datasource-adt/design.md` for the executed template)
- [x] 0.3 Read memory: `feedback-no-inline-fqns.md`, `feedback-refactor-discipline.md`, `feedback-pipeline-op-wiring.md`, `project-backend-architecture-remodel.md`

## 1. Exploration (resolve open design questions)

- [x] 1.1 Grep every `step.op` / `step.config` consumer (backend + frontend) — confirm the impact list in `design.md` §10 is complete
- [x] 1.2 Inspect every `apply<Op>` private method in `InProcessPipelineEngine.scala` — record the exact accepted config shape per kind (alias keys, optional fields, defaults). This is the source of truth for each `*Config` case class
- [x] 1.3 Inspect `PipelineAnalyzeService.inferOutputSchema(op, config, ...)` — record how it consumes config; align ADT design so the typed config maps cleanly to its current logic
- [x] 1.4 Inspect `SparkJobSubmitter` step-handling code — record whether the submitted Spark JSON consumes a typed shape or raw fields. Decide: (a) keep raw-JSON submission boundary unchanged (typed→JSON at submit), or (b) propagate ADT to Spark side as a separate spinoff
- [x] 1.5 Inspect existing `InProcessPipelineEngineSpec.scala` (703L) — record fixture construction shape; plan the minimal diff to test inputs (typed ADT constructors instead of `PipelineStepRow` with stringified config)
- [x] 1.6 Inspect frontend step editor components — list every config-reading or config-writing site that does `JSON.parse` / `JSON.stringify` and must change
- [x] 1.7 Record decisions in the executor report (cycle 1)

## 2. Backend domain

- [x] 2.1 Create `domain/Pipeline.scala` — `sealed trait PipelineStep` + 10 subtypes (Rename/Filter/Join/Compute/GroupBy/Cast/Select/Limit/Sort/Aggregate)
- [x] 2.2 Add typed config case classes per subtype (`FilterConfig`, `JoinConfig`, etc.) matching today's accepted shapes from §1.2
- [x] 2.3 Add `PipelineStepKind` helper object (string constants + `All: Set[String]`)
- [x] 2.4 Remove old flat `PipelineStep` case class from `domain/model.scala`
- [x] 2.5 `sbt compile` — green

## 3. Backend protocol

- [x] 3.1 Create or extend protocol file — `RootJsonFormat[PipelineStep]` discriminated on `type` with per-subtype `config` payload
- [x] 3.2 Per-subtype `*Config` round-trip formats (typed read/write, no string-of-JSON)
- [x] 3.3 `CreatePipelineStepRequest` / `UpdatePipelineStepRequest` wire shape evolved (`type`/`config` instead of `op`/`config: String`)
- [x] 3.4 `AnalyzeStepResponse` wire shape evolved
- [x] 3.5 Cross-type PATCH detection — `UpdatePipelineStepRequest` carrying a `type` different from the persisted row returns 400 with explicit message
- [x] 3.6 Create `api/protocols/PipelineStepConfigCodec.scala` — `decode(kind, jsonText): Try[PipelineStepConfig]` + `encode(config): String`
- [x] 3.7 Split `PipelineStepProtocol.scala` out of `PipelineProtocol.scala` if combined file exceeds 250 lines
- [x] 3.8 `sbt compile` — green

## 4. Backend infrastructure

- [x] 4.1 Update `PipelineStepRepository.rowToDomain` — dispatch on `op` column, parse `config` via codec, return typed subtype
- [x] 4.2 Update `PipelineStepRepository.domainToRow` — pattern-match subtype → `(op, configJson)` pair via codec
- [x] 4.3 Repo signatures evolve where natural: `insert(step: PipelineStep)`, `update(stepId, partial: UpdatePipelineStepRequest)`, etc.
- [x] 4.4 `sbt compile` — green

## 5. Backend services

- [x] 5.1 `PipelineService.AllowedOps` deleted — replaced by `PipelineStepKind.All` (sealed-trait-derived)
- [x] 5.2 `PipelineService.addStep` / `updateStep` accept typed configs; validation moves to protocol layer + cross-type-patch guard
- [x] 5.3 Create `services/PipelineRunService.scala`:
  - `submit(pipelineId, dry, user)` — pre-execution (insert run record + prune), source-type dispatch (in-process vs spark), SSE event publication, returns `RunSubmitResponse`
  - `status(runId)`, `result(runId)`, `history(pipelineId)`
  - `streamEvents(pipelineId)` for SSE
- [x] 5.4 SSE registry (`PipelineRunRegistry`) ownership moves to service (or stays as injected component if natural)
- [x] 5.5 Both services ≤ 300 lines after extraction
- [x] 5.6 `sbt compile` — green

## 6. Backend engine split

- [x] 6.1 Update `InProcessPipelineEngine.execute` / `executeWithStepCounts` signatures to accept `Seq[PipelineStep]` (typed ADT) instead of `Seq[PipelineStepRow]`
- [x] 6.2 Replace `applyStep` 11-case string match with sealed-trait dispatch
- [x] 6.3 Create `domain/PipelineStepHandlers.scala` (or co-locate in `Pipeline.scala` if small) — per-kind handler functions with typed signatures (no `JsObject` crossing boundaries inside handlers; numeric/string utility helpers stay on engine)
- [x] 6.4 `InProcessPipelineEngine.scala` ≤ 250 lines
- [x] 6.5 `PipelineStepHandlers.scala` ≤ 300 lines (split per-handler files if exceeded)
- [x] 6.6 `sbt compile` — green

## 7. Backend routes

- [x] 7.1 Update `routes/PipelineStepRoutes.scala` — typed request/response entity unmarshalling for create/update/list
- [x] 7.2 Update `routes/PipelineRoutes.scala` and analyze endpoint — typed shapes for analyze response
- [x] 7.3 Delete `routes/PipelineRunRoutes.scala` and replace with:
  - `routes/PipelineRunSubmitRoutes.scala`
  - `routes/PipelineRunStatusRoutes.scala`
  - `routes/PipelineRunHistoryRoutes.scala`
  - `routes/PipelineRunStreamRoutes.scala`
  (Executor may adjust partitioning if a different split reads more naturally; per-file ≤ 150 lines is hard.)
- [x] 7.4 Aggregator route in `ApiRoutes.scala` composes the new run-route files
- [x] 7.5 All new/updated route files ≤ 150 lines
- [x] 7.6 `sbt test` — full green (existing baseline + new tests; expect 0 regressions on count)

## 8. Spark submitter

- [x] 8.1 Update `SparkJobSubmitter.scala` — ADT dispatch instead of `step.op` string match
- [x] 8.2 If Spark JSON serialization changes, verify Spark-side consumer compatibility; if incompatible, scope a coordination plan as part of executor report
- [x] 8.3 `sbt compile` — green

## 9. Backend ADT-specific tests

- [x] 9.1 Create `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — per-subtype `kind` correctness + pattern-match coverage + `PipelineStepKind.All` parity with sealed-trait subclasses
- [x] 9.2 Create `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` — round-trip per subtype, cross-type-patch rejection (400), config-shape edge cases
- [x] 9.3 Create `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — decode/encode parity + malformed-JSON failure cases
- [x] 9.4 Update `InProcessPipelineEngineSpec.scala` (703L) — fixture construction uses typed ADT; every existing test passes. Any green→red is a blocker
- [x] 9.5 Create `backend/src/test/scala/com/helio/services/PipelineRunServiceSpec.scala` — extracted from `PipelineRunRoutesSpec`; cover submit, status, result, history, SSE registry publication
- [x] 9.6 Update existing route specs (`PipelineRunRoutesSpec.scala` → split or rename to match new route files); thin HTTP-layer tests, business logic covered in service spec
- [x] 9.7 Update `PipelineStepRepositorySpec` round-trip per subtype
- [x] 9.8 `sbt test` — full green

## 10. Frontend type sync

- [x] 10.1 Update `frontend/src/types/models.ts` — `PipelineStep` becomes a discriminated union over `type` with typed `config` per subtype; add per-subtype `*Config` interfaces; same for `AnalyzeStepResult`
- [x] 10.2 Add narrowing helpers (`isFilterStep`, `isJoinStep`, etc.) only if 3+ consumers need the same narrow (CS2c-2 rule)
- [x] 10.3 Update `frontend/src/features/pipelines/pipelinesSlice.ts` — thunk payloads + Redux state shape
- [x] 10.4 Update `frontend/src/services/pipelineService.ts` — request bodies match new wire shape
- [x] 10.5 Update `PipelineDetailPage.tsx` — step list renders branching on `step.type`
- [x] 10.6 Update `CreatePipelineModal.tsx` — step creation flow uses typed config from the start
- [x] 10.7 Update step editor components per kind — read/write typed config, no `JSON.parse(step.config)` / `JSON.stringify(config)` anywhere
- [x] 10.8 Remove every `JSON.parse(step.config)` / `JSON.stringify(config)` callsite under `frontend/src/`
- [x] 10.9 `npm run lint`, `npm test`, `npm run format:check` — green

## 11. Cross-cutting

- [x] 11.1 Grep `openspec/specs/*` for pipeline step request/response shape references; update the new wire shape
- [x] 11.2 No JSON Schema files for PipelineStep today (verify); do NOT create new ones unless schema drift surfaces
- [x] 11.3 `npm run check:schemas` and `npm run check:openspec` — green

## 12. Verification gates

- [x] 12.1 `sbt test` — full green
- [x] 12.2 `npm test` — full green
- [x] 12.3 `npm run lint` — zero warnings
- [x] 12.4 `npm run format:check` — clean
- [x] 12.5 `npm run check:schemas` — passes
- [x] 12.6 `npm run check:openspec` — clean
- [x] 12.7 `npm run check:scala-quality` — passes (no inline FQNs)
- [x] 12.8 File-size budget audit: routes ≤ 150, services ≤ 300, other src ≤ 250 (engine handlers ≤ 300 OK)
- [x] 12.9 No `step.op match { case "filter" => ... }` string-switch remains in service / route / engine code (one pattern match each in JSON formatter + repo `rowToDomain` is expected and fine)
- [x] 12.10 `PipelineService.AllowedOps` removed; allow-list sourced from `PipelineStepKind.All` (sealed-trait-derived)
- [x] 12.11 AuthService unchanged: `git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` shows no diff
- [x] 12.12 `PipelineRunRoutes.scala` deleted; replacement route files all under budget

## 13. Smoke validation (evaluator Phase 3 runs — executor does NOT run smoke)

- [ ] 13.1 Backend starts with `BACKEND_PORT=8081 sbt run`; `/health` returns 200
- [ ] 13.2 Frontend starts with `DEV_PORT=5174 npm run dev`
- [ ] 13.3 Manual smoke (8 steps from design.md §13): login → pipelines page → create pipeline → add 3 steps (filter, sort, limit) → analyze → dry-run → real run → refresh and verify steps reload

*(Smoke not run by the executor — evaluator runs Phase 3 against `DEV_PORT=5174` / `BACKEND_PORT=8081`.)*

## 14. Commit / PR handoff

- [x] 14.1 Multi-commit history matches per-area sequencing (exploration notes + commit-per-area: domain → protocol/codec → infra → services → engine split → routes+tests → spark → frontend → openspec specs)
- [x] 14.2 All commits on branch `task/backend-pipeline-step-adt/HEL-236`
- [x] 14.3 Orchestrator handles push + PR — do not push

## Spinoff candidates (capture, do NOT pull into CS2c-3a)

- [ ] 15.1 Engine row representation refactor (`Seq[Map[String, Any]]` → typed `Row` / columnar) — separate initiative
- [ ] 15.2 `PipelineStepHandlers.scala` further split per-handler files if file balloons later — CS3-era cleanup
- [ ] 15.3 Spark application-side ADT propagation if submitter changes break Spark-side consumer
- [ ] 15.4 `Redactable` typeclass for step configs (e.g. SQL password in `JoinConfig`) — defer until webhook secrets land
- [ ] 15.5 Anything else surfaced during work

## 16. Cycle 3 — per-step-file refactor (folded in before merge)

- [x] 16.1 Define `trait PipelineStep` with polymorphic `evaluate(rows, ctx)` method + `PipelineExecutionContext` bundle (dataSourceRepo + loadSource closure)
- [x] 16.2 Define `PipelineStep.Companion` contract + `PipelineStep.Registry` Map (single source of truth for kinds)
- [x] 16.3 Make `PipelineStepKind.All` registry-derived (no more hard-coded enumeration)
- [x] 16.4 Move shared row<->JsValue helpers (`anyToJsValue`, `jsValueToAny`, `toDouble`, `parseStaticRows`) into `domain/PipelineRowJson.scala`
- [x] 16.5 Create `domain/steps/<Kind>Step.scala` × 10 (Rename / Filter / Join / Compute / GroupBy / Cast / Select / Limit / Sort / Aggregate). Each file owns: `*Config` case class + JSON format + tolerant `decode(raw)` + `*Step` case class implementing `evaluate` + `companion` registry entry
- [x] 16.6 Add `domain/steps/StepCodecUtil.scala` for shared `asObject(raw)` + `stringOr(obj, key, default)` helpers used by per-step decoders
- [x] 16.7 Add `domain/package.scala` re-exports so `import com.helio.domain._` still resolves every step / config type
- [x] 16.8 Rewrite `InProcessPipelineEngine.applyStep` to `step.evaluate(rows, ctx)` polymorphic dispatch; engine assembles the execution context
- [x] 16.9 Reduce `PipelineStepConfigCodec` to a thin facade over `PipelineStep.Registry` (preserves the cycle-2 public surface: `decode` / `encode` / `encodeConfig` / `encodeJsObject`)
- [x] 16.10 Reduce `PipelineStepProtocol` to import per-config formats from the step modules (each `*Config.format`) instead of re-declaring them
- [x] 16.11 Migrate `PipelineRunService` from `PipelineStepHandlers.anyToJsValue` to `PipelineRowJson.anyToJsValue`
- [x] 16.12 Delete `domain/Pipeline.scala` (superseded)
- [x] 16.13 Delete `domain/PipelineStepHandlers.scala` (logic distributed to step files)
- [x] 16.14 Decide on `sealed` — drop it from the trait (Scala 2 sealed constrains subclasses to the same compilation unit; document in scaladoc; rely on Registry + exhaustiveness test for safety)
- [x] 16.15 Verify all 577 sbt tests still pass with zero regressions
- [x] 16.16 Verify all 664 jest tests still pass (frontend untouched)
- [x] 16.17 Verify all quality gates pass (lint / format / schemas / openspec / scala-quality)
- [x] 16.18 Verify file-size targets: every new step file ≤ 200; engine ≤ 250; codec ≤ 250
- [x] 16.19 Confirm `AuthService.scala` diff vs main is empty
- [x] 16.20 Capture deferred items as forward markers (analyze-layer typed inference; further per-step protocol split if Registry grows)
