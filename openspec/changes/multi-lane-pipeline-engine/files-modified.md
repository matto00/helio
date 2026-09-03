## Backend — engine, domain, wire

- `backend/src/main/scala/com/helio/domain/steps/SecondaryInput.scala` (new) — the discriminated `secondaryInput` ADT (`Source`/`Lane`) shared by join/union/lookup, its JSON codec, and the strict `decodeStrict` (Decisions 1/1a/1b).
- `backend/src/main/scala/com/helio/domain/steps/JoinStep.scala`, `UnionStep.scala`, `LookupStep.scala` — replace the flat second-source field with `secondaryInput`; `evaluate` branches on `kind`, resolving `Lane` via `ctx.resolveLane` (no re-evaluation) or `Source` via the existing `dataSourceRepo`/`loadSource` path.
- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — `PipelineExecutionContext` gains `resolveLane: String => Option[Seq[Row]]`.
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — deletes `validateGraph`/the `InvalidGraph` pre-flight; adds `LaneReferenceError`; replaces the trunk/tails `executeTree` walk with a general topological (Kahn's-algorithm) DAG walk (`structuralRank` + `laneDependencyOf`), including run-time cycle/membership/self-reference rejection before any step evaluates.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — removes the HEL-930 `InvalidGraph` throw in `executionOrder`; generalizes to walk ALL "position 0" children (plural) rather than picking one, preserving the pre-existing emission order for the common case.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — write-time lane-reference validation (`validateLaneReference`, `ancestorChainOf`) wired into `addStep`/`updateStep`; `classifyDbError` gains a `LaneReferenceError` arm.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala` — `secondaryDataSourceId` reworked for the new shape; new `secondaryLaneStepId` extractor for the write-time lane-reference check.
- `backend/src/main/scala/com/helio/services/patchsets/RefinementEditShape.scala` — join worked example updated to `secondaryInput`.
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — `JoinStep` handling branches on `secondaryInput.kind`; `lane`-kind fails loudly (HEL-238 scope), `source`-kind unchanged.
- `backend/src/main/resources/db/migration/V97__discriminated_secondary_input.sql` (new) — rewrites persisted `join`/`union`/`lookup` configs to the discriminated shape; `NO FORCE`/`FORCE ROW LEVEL SECURITY` bracket per V96.

## Backend — dev/ops scripts and docs

- `backend/scripts/repair-dev-db.sql` — writes the new shape instead of the legacy flat field.
- `backend/README.md` — legacy-shape references corrected.
- `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` — corrects the now-false "No data-model change." sentence.

## Backend — tests

- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineTreeWalkSpec.scala` — converts the two `InvalidGraph`-expecting tests to multi-lane-evaluates-both tests; adds the multi-lane rejoin/cycle/diamond/determinism/disabled-lane test suite (tasks 11.1–11.5, 11.7, item 9).
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositoryTreeOrderingSpec.scala` — same conversion for the repository-level guard.
- `backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepSecondSourceGuardSpec.scala` — reworked to reflect on the `SecondaryInput`-typed field and re-prove HEL-950's guard for both the source and lane legs independently.
- `backend/src/test/scala/com/helio/infrastructure/persistence/FlywayNonSuperuserMigrationSpec.scala` — V97 migration evidence: before/after counts for all three legacy field names, idempotence, byte-identical passthrough control, and the two empty-id draft rows' post-migration shape; seeds a synthetic `join` legacy row (dump has none).
- All other listed spec files: mechanical conversion of `JoinConfig`/`UnionConfig`/`LookupConfig` construction and raw wire-JSON bodies from the legacy flat field to `secondaryInput` (see design.md "Change record" for the blanket justification), required because the decoder now hard-rejects the legacy shape.

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `SecondaryInput` type; `JoinConfig`/`UnionConfig`/`LookupConfig` updated.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `defaultConfigFor`/`unionConfigOf`/`lookupConfigOf` updated to the new wire shape (UI-narrowed value shape unchanged, since editor-lanes authoring is P2.2).
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — `onUnionChange`/`onLookupChange` widen the narrowed UI value back to `secondaryInput` before persisting (a real bug fix — this seam was sending the narrowed shape directly to the backend).
- `frontend/src/features/pipelines/state/stepNarrowing.test.ts` — wire-shape literals updated.

## helio-mcp

- `helio-mcp/src/tools/write.ts` — `add_pipeline_step`/`update_pipeline_step` tool descriptions for union/lookup updated to document `secondaryInput` (source vs. lane) instead of the legacy flat field.

## Cycle 2 (evaluation-1.md change requests) — additional files

- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — CR1: restores trunk-terminal semantics for `TreeWalkResult.rows` (via `stepRepo.trunkOf(steps).lastOption`), removing the `lastFrame` var entirely.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — CR2: `tailsOf`'s `expand` generalized to never drop a descendant; `trunkOf`/`deleteInternal` documented explicitly as deliberate single-anchor conventions; indentation drift fixed (non-blocking suggestion).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — CR2: documents the `addStep` anchor/cycle-check consistency; CR5: `validateStepCrossOwnerRefs` extended with request-scoped lane-reference validation (exists/not-self/not-ancestor) for the single-call transactional create path.
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — CR3: `analyzeNodes` generalized to a topological, lane-aware pass; `inferUnion`/new `inferJoin`/`inferLookup` derive a real merged schema from a resolved `lane`-kind secondary input.
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineTreeWalkSpec.scala` — CR1: two new parity tests (trunk-terminal-with-a-tail, root-with-only-a-lane), red/green verified.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositoryTreeOrderingSpec.scala` — CR2: `trunkOf` determinism test, `tailsOf` no-drop test.
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — CR3: six new `analyzeNodes` tests exercising the shipped delta's rejoin-schema scenario for real (union merge, join right-wins collision, join's new dispatch case, lookup real typing, source-kind degrade).
- `backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodecSpec.scala` — CR4: seven codec-layer legacy-field/malformed-secondaryInput tests, individually red/green verified.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` — CR4: three route-layer 422 tests for the legacy flat shape; CR5: five lane-reference write-time tests (foreign pipeline, nonexistent, self-ancestor cycle, valid acceptance, PATCH arm), individually red/green verified; stale test-name/comment cleanup.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCreateTransactionalSpec.scala` — CR5: three transactional-create lane-reference tests, individually red/green verified; stale test-name cleanup.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — stale test-name cleanup (non-blocking suggestion).
- `frontend/src/features/pipelines/hooks/useStepCardState.test.ts` — CR6: two new tests asserting the exact wire-shape-widened persisted payload.
- `openspec/changes/multi-lane-pipeline-engine/specs/pipeline-lane-rejoin-input/spec.md` — non-blocking: RFC-2119 wording fix (SHALL/NOT REQUIRED), zero `openspec validate --strict` warnings now.
- `openspec/changes/multi-lane-pipeline-engine/design.md` — "Cycle 2 (evaluation-1.md)" change-record section documenting all six CRs' resolutions.

## Cycle 3 (skeptic-final-1.md) — additional files

- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `buildStepsAction` now rewrites a `lane`-kind `secondaryInput.stepId` through `clientIdMap` (new `rewriteLaneClientId` helper), mirroring the pre-existing `parentStepId` rewrite; a forward lane reference (not yet resolvable, since `buildStepsAction` inserts steps strictly in request order) now fails loudly with a named `BadRequest` instead of silently re-persisting the clientId or crashing.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCreateTransactionalSpec.scala` — replaces the vacuous `result shouldBe a[Right[_, _]]`-only test with two independently-red-verified assertions on persisted state (`secondaryInput.stepId` is the real step id, not the clientId) and behaviour (the pipeline actually runs through the real engine).
- `openspec/changes/multi-lane-pipeline-engine/design.md` — "Cycle 3 (skeptic-final-1.md)" change-record section: the defect, the scoped fix, the related forward-reference limitation (reported, not fixed), and the generalizable "a test that asserts success, not what was produced, is not coverage" lesson.

## Cycle 4 (skeptic-final-2.md) — comment-only fold-in + one test

- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — comment-only: corrects the stale `listSteps` comment claiming `listByPipelineInternal` can fail with `InvalidGraph`; that path is deleted (HEL-911). No logic changed.
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — comment-only: removes the `analyzeNodes` doc's reference to the deleted Phase-1 `InvalidGraph` structural invariant; points to `isReady` for the current tolerance mechanism. No logic changed.
- `backend/src/test/scala/com/helio/infrastructure/persistence/FlywayNonSuperuserMigrationSpec.scala` — comment-only: removes the citation of a nonexistent `V97Hel911MigrationCoverageSpec`, points to design.md's change record and the in-file assertions instead. No logic changed.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCreateTransactionalSpec.scala` — new test pinning the forward-lane-reference rejection (`rewriteLaneClientId`'s `Left` arm): a lane `secondaryInput.stepId` naming a LATER clientId in the same single-call create request fails with a named `BadRequest`, nothing persisted. Verified red against a temporarily simplified `Right(typedConfig)` arm before being accepted.

`git diff --stat` for this cycle (verified, see summary): exactly these four files -- three comment-only, one test-only.

## OpenSpec

- `openspec/changes/multi-lane-pipeline-engine/design.md` — "Change record" section appended (tasks 10.3, 12.6, 7.1/7.2 finding, 11.14 justification, 2.7 note, repository-listing-order rationale).
- `openspec/changes/multi-lane-pipeline-engine/tasks.md` — all tasks checked off.
- `openspec/changes/multi-lane-pipeline-engine/{proposal.md,specs/**,tools/**}` — pre-existing planning artifacts (authored during the planning phase, not previously committed); included here since this is the first commit for this change.

## Declaration completed at Delivery (orchestrator)

`squash-branch.sh`'s guard (CON-129) refused the squash because these 13 paths
appear in the branch diff but were not declared above. Each was verified to
carry substantive `secondaryInput` / lane / `InvalidGraph` edits belonging to
this change before being added — the declaration was incomplete, the diff was
not wrong. Recorded here rather than bypassed with `--allow-empty-declaration`.

Core rejoin ops (the other two of the three; `JoinStep` was declared):

- `backend/src/main/scala/com/helio/domain/steps/UnionStep.scala` — flat `otherDataSourceId` replaced by the discriminated `secondaryInput`; lane-kind resolution.
- `backend/src/main/scala/com/helio/domain/steps/LookupStep.scala` — flat `referenceDataSourceId` replaced by `secondaryInput`; lane-kind resolution.

Test files converted from the legacy wire shape (part of the ~20-file conversion
recorded in the change record, each assertion justified there):

- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala`
- `backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepProtocolSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalRollbackSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala`
- `backend/src/test/scala/com/helio/domain/model/PipelineStepSpec.scala`
- `backend/src/test/scala/com/helio/domain/steps/PipelineStepRequiredConfigSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpec.scala`
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/patchsets/RefinementEditShapeSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala`
