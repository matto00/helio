# Files modified — HEL-914 (cycle 12, partial)

## Cycle 12 additions (backing tests for the narrow-and-defer patch-set-lane-edits delta edit)

- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — new negative-scenario test backing `patch-set-lane-edits`' "Omitting attachAsTail splices rather than branching" (creating a `pipelineStep` whose `patch.parentStepId` names a step with an existing child, WITHOUT `attachAsTail: true`, reparents the existing child under the new step -- asserted on the actual splice/reparent structure, not merely a `200`). The pre-existing sibling test already set `attachAsTail: true` explicitly, so no change was needed there.

# Files modified — HEL-914 (cycle 11, partial)

## Cycle 11 additions (item 6 — task 6.9 docs worked example; test confirming peer's delta edit)

- `docs/agent-native.md` — NEW "Worked example: multi-root, multi-lane pipeline (HEL-914)" section: a `create_pipeline` request/response and `get_workspace_context` lane-tree read-back for a two-root "Projections ⨝ ADP" shape, captured from a REAL execution of `Hel914Ac1EndToEndSpec` (domain names substituted for the test's literal `Orders`/`Regions`, every id shape/field name/structural rule is the actual, proven wire contract) -- not hand-typed.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — new test confirming the peer's `patch-set-apply` delta edit (empty `dataSourceId` on a `pipelineStep` CREATE's secondaryInput is a draft, not a reference -- no lookup, no 404, matching the pre-existing `update`-side test).

# Files modified — HEL-914 (cycle 10, partial)

## Cycle 10 additions (peer-approved fix: pipelineStep create's second-source ACL moves to pre-validation)

- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` — `resolvePipelineStepCreate` now runs a new `authorizeSecondSourceForCreate` (the SAME decode+`secondaryDataSourceId`-extract+`findByIdOwned` ownership check `resolvePipelineStepUpdate` already runs) at pre-validation time, closing the enumeration gap `patch-set-apply`'s "Pre-validation also authorizes resources referenced inside a patch" requirement disclosed for `update` but not `create`.

## Cycle 10 tests

- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — new test: a `pipelineStep` create referencing a foreign-owned `JoinConfig.secondaryInput.dataSourceId` is rejected pre-validation, creating nothing (mirrors the existing `update`-time test).

# Files modified — HEL-914 (cycle 9, partial)

## Cycle 9 additions (item 5 — task 7.2 AC1 E2E, 7.3/6b.5/7.6 dual sweeps)

- `backend/src/test/scala/com/helio/services/pipelines/Hel914Ac1EndToEndSpec.scala` — NEW: task 7.2's AC1 end-to-end test. One `create_pipeline`-shaped `PipelineService.create` call builds a real two-root, two-lane pipeline with a `join` rejoin and three Outputs; `place_outputs`-shaped `PanelService.create` calls place them; `get_workspace_context`-shaped `WorkspaceContextService.assemble` reads the graph back. Asserts the PRODUCED GRAPH structurally: both root ids in request order, each parentless step's bound root, the join's resolved second-input node (its clientId rewritten to the real persisted step id), each Output's node, and the lane tree read back. Caught two of my own test-authoring mistakes on first run (position isn't a valid tiebreak between two parentless steps -- both are position 0; `PipelineLaneTreeNode.rootId` is `String`, not `Option[String]`, unlike `PipelineStepResponse.rootId`) — probed each before changing the assertion.
- `backend/src/main/scala/com/helio/services/assistant/AssistantToolExecutor.scala` — task 7.3's completeness grep (from task 1.1) surfaced a stale doc-comment reference to the retired singular `proposal.source`/`pipeline.source` shape; corrected to `roots`.
- `backend/src/test/scala/com/helio/services/assistant/AssistantToolExecutorSpec.scala` — same sweep, same fix, in this file's own stale doc comment/test name.
- `frontend/src/features/proposals/utils/unresolvedConnectorRefs.ts` — same sweep, same fix: the stale `proposal.source.config` doc comment corrected to `proposal.roots[i].config`/`root.config`.

## Cycle 9 findings reported, not yet resolved

- 6b.5/7.6's requirement-title diff (canonical `grep -c "^### Requirement:"` vs. each delta) surfaced one real, unresolved inconsistency in `patch-set-apply`'s "Pre-validation also authorizes resources referenced inside a patch" requirement: its explicit list covers `pipelineStep update`'s second-source (`JoinConfig`/`UnionConfig`/`LookupConfig` `secondaryInput`) ACL check at PRE-VALIDATION time, but never mentions `pipelineStep create` (this ticket's own new op) — and `PatchSetApplyResolvers.resolvePipelineStepCreate` confirms it does NOT perform this check; only forward-apply's `PipelineService.addStep` does (later, with its own atomic rollback safety net — not a security hole, but an inconsistency the requirement's own enumerated list doesn't disclose). Reported to the peer; not resolved this cycle.

# Files modified — HEL-914 (cycle 8, partial)

## Cycle 8 additions (peer-approved: attachAsTail documented in the 4th, last remaining surface)

- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` — `EditSchema.patch`'s description now documents `attachAsTail: true` (consistent wording with the MCP `apply_patch_set` tool description fixed in cycle 7) — the in-app assistant's own decodable tool schema was the last of four guidance surfaces (prompt, this schema, the MCP tool schema, the MCP tool description) not yet carrying this.

## Cycle 8 tests

- `backend/src/test/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemasSpec.scala` — anchors the new `patch` description text.

# Files modified — HEL-914 (cycle 7, partial)

## Cycle 7 additions (item 4 follow-up — a real silent-drop defect in a THIRD guidance surface)

- `helio-mcp/src/tools/refinementSchemas.ts` — NEW: extracted `editTargetSchema`/`editSchema`/`patchSetSchema` out of `refinement.ts` (TS2589 workaround, same reason `pipelineProposalValidation.ts` documents) so a test can decode through them without pulling in `registerTool`/`McpServer`. **Real defect fixed**: the inline schema this replaces had NO `parentId` field at all, and its `kind` enum still carried the retired `dataType` and omitted `output`. Since zod's `z.object()` strips unrecognized keys by default, a hand-authored `target.parentId` sent through `apply_patch_set` (an external-MCP-client-facing tool, separate from the in-app assistant) was SILENTLY DROPPED before reaching the backend.
- `helio-mcp/src/tools/refinement.ts` — imports `patchSetSchema` from the new module; `apply_patch_set`'s tool description now documents `target.parentId` and states a `pipelineStep` create's `patch` must set `attachAsTail: true` to add a sibling lane (omitting it splices/reparents instead).
- `helio-mcp/src/types.ts` — `EditTarget` gains `parentId?: string`; `kind` union fixed (drops `dataType`, adds `output`), matching the backend's real enum.

## Cycle 7 tests

- `helio-mcp/src/tools/refinementSchemas.test.ts` — NEW: 4 decode tests (parentId/attachAsTail round-trip through a real pipelineStep-create edit; every real `kind` including `output`; retired `dataType` now rejected; absent `parentId` decodes as `undefined`, never required).

# Files modified — HEL-914 (cycle 6, partial)

## Cycle 6 additions (item 4 — task 6b spec-to-code conformance sweep)

Swept all seven capabilities named in the peer's ordered plan (`pipeline-proposal-contract`,
`pipeline-proposal-apply`, `pipeline-proposal-analyze-api`, `assistant-conversation-loop`,
`pipeline-proposal-review-ui`, `patch-set-contract`, `patch-set-apply`/`patch-set-lane-edits`).
Most requirements (6b.1-6b.4, 6b.3a, 6b.4b-6b.4g, 6b.6, 6b.7) were ALREADY conformant from cycles
1-2's work (verified, not re-implemented) — code comments already cited the exact task numbers.
Two genuine gaps found and fixed:

- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProposalProtocol.scala` — NEW `OutputAnalyzeResponse(name, kind, validationError)`; `PipelineAnalyzeProposalResponse` gains `outputs: Vector[OutputAnalyzeResponse]`. **Gap**: `pipeline-proposal-analyze-api`'s "Proposal analysis grounds each Output at its own node" requirement had NEVER been implemented in the dry `analyze-proposal` endpoint — only the real `apply`/`create` path (`PipelineService.buildOutputsAction`) grounded Output fieldMapping validation at all; the dry endpoint didn't even look at `proposal.outputs`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `analyzeProposal` now calls new `resolveProposalOutputAnalyses`/`resolveOneProposalOutputAnalysis`/`resolveProposalOutputNodeSchema`, grounding each Output's fieldMapping at its own node (a rejoin's dual-lane schema, via the already-computed `projections` map — no re-derivation) or its own root's schema for a root-bound Output, reusing the existing `validateOutputFieldMapping` validator.
- `schemas/pipelines/pipeline-analyze-proposal-response.schema.json` — `outputs` (required) + `OutputAnalyze` $def.
- `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala` — **Gap found via a self-discriminating test**: the `propose_patch_set` guidance told an agent to add a lane via a `pipelineStep` create naming an existing step as `patch.parentStepId`, but never mentioned `attachAsTail: true` — omitting it makes `addStep` SPLICE the new step in and reparent the anchor's existing children onto it (HEL-908's pre-existing trunk-insert semantic), not add a sibling lane. An agent following only the previously-documented guidance would silently corrupt the pipeline's existing tail structure instead of branching it. Added the missing sentence.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` — comment-only fix (6b.7): the `output`-create rejection's comment still said "same reason as pipelineStep above," stale now that `pipelineStep` create is implemented; rewritten to state the parent-id gap is closed and only lack of test coverage keeps `output` create rejected.

## Cycle 6 tests

- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala` — 3 new tests: a trunk-valid/tail-invalid Output mapping is rejected; a rejoin-node Output's mapping is grounded against BOTH incoming lanes (valid); an Output mapping a never-rejoined sibling lane's field is rejected. The rejoin test initially failed against a first draft (sibling lane built as a child of the wrong node) — a probe-confirmed test-authoring bug, not a product bug; fixed by rooting the sibling lane at the pipeline root instead of off the primary lane's own tail.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — new test proving a `pipelineStep` create with `attachAsTail: true` produces a sibling (existing child NOT reparented); this test FAILED on its first run without `attachAsTail`, which is exactly what surfaced the system-prompt gap above (systematic-debugging: probed `spliceInsertAtInternal`'s doc comment before concluding the test, not the product, needed a fix — then found the SEPARATE, real prompt-guidance gap this raised).
- `backend/src/test/scala/com/helio/services/assistant/AssistantSystemPromptSpec.scala` — anchors the new `attachAsTail: true` sentence.

## Escalation raised, not resolved this cycle

`patch-set-lane-edits`' "A multi-edit lane applies in order" scenario (two `pipelineStep` create
edits in one patch set, the second naming the first's not-yet-existing step as parent) requires a
forward-reference mechanism the current resolve-then-apply architecture has no equivalent of
(`resolveAll` fully decodes every edit before any edit is applied). Escalated to the peer rather
than inventing an undocumented sentinel convention unilaterally; not yet implemented.

# Files modified — HEL-914 (cycle 5, partial)

## Cycle 5 additions (task 6.8 — proposal review UI renders the lane structure)

- `frontend/src/features/pipelines/utils/proposalLaneGraph.ts` — NEW: `proposalStepsToSteps`/`buildProposalLaneGraph` bridge a `PipelineProposalStep[]` (loose, `clientId`-keyed proposal wire shape) into the SAME `Step[]`/`buildLaneGraph`/`computeLaneLayout` machinery `PipelineRiverView` uses for a persisted pipeline, via a documented `as unknown as PipelineStep` cast (design.md D4 — this review surface never validates/edits config client-side).
- `frontend/src/features/pipelines/state/laneLayout.ts` — `secondaryInputOf` exported (was module-private) so the proposal review UI can detect a rejoin's `{kind:"lane"}` secondary input without a second implementation of the same shape-check.
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalSummary.tsx` — "Proposed steps" now groups by lane (`graph.lanes`, via `buildProposalLaneGraph`), each lane labeled "Primary lane" or `Lane branching off step <parentStepId>`; `StepRow` gains a rejoin annotation (`second input (rejoin): step <id>`, via a new `rejoinSecondInputOf` helper) and a per-step "Outputs: ..." annotation (via a new `outputsByStep` map built from `proposal.outputs`), replacing the prior flat step list.
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReview.css` — new `.pipeline-proposal-review__lane`/`.pipeline-proposal-review__lane-label` rules (existing `--app-*`/`--space-*`/`--text-*` tokens only, per DESIGN.md).

## Cycle 5 tests

- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReview.test.tsx` — new test: a 3-step/3-lane proposal (two children of one step, one a `join` with a `{kind:"lane"}` secondaryInput) renders lane grouping, both branch-lane labels, the rejoin annotation, and the per-step Output annotation.

# Files modified — HEL-914 (cycle 4, partial)

## Cycle 4 additions (task 5.8 — undo of a lane deletion restores Outputs/placements)

- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` — `resolvePipelineStepDelete`'s captured `priorState` is now `{"step": <PipelineStepResponse>, "boundOutputs": [{"output": <OutputResponse>, "placements": [<PanelResponse>, ...]}, ...]}` (new `buildPipelineStepDeletePriorState` helper), captured BEFORE the delete since V94's `ON DELETE CASCADE` destroys the Outputs/placements by the time undo would otherwise need them.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoService.scala` — `restorePipelineStepDelete` unwraps the new envelope (tolerating a legacy bare-step-JSON journal entry with no `boundOutputs` key) and, after recreating the step, recreates every captured Output (bound to the step's NEW id) and every one of those Outputs' panel placements (bound to each Output's NEW id, with `config.outputId` repointed) via the new `restoreBoundOutputs` helper.

## Cycle 4 tests

- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala` — new test proving a pipelineStep-delete undo restores its bound Output and that Output's placement (panel), after confirming the DB cascade actually destroyed both on the original delete; both this spec's and its sibling `applyService` fixture's `PatchSetApplyService` construction now wire `outputRepo` (a probe-confirmed gap: without it, `buildPipelineStepDeletePriorState` silently captured `boundOutputs: []`).

# Files modified — HEL-914 (cycle 3, partial)

## Cycle 3 additions (tasks 6.4-6.6 — concise analyze mode, byte budget, lane tree)

- `backend/src/main/scala/com/helio/domain/engine/RuntimeGraphPath.scala` — NEW: extracts the runtime graph path builder (`root:<rootId> > s1 > s4`) out of `InProcessPipelineEngine.executeTree`'s local `chainToRoot`/`buildLanePath` so it is genuinely the ONE implementation (design.md D5), reused by concise analyze and the lane tree.
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — `laneDependencyOf` moved to the companion object (pure, no instance dependency) so `RuntimeGraphPath` can call it; `executeTree` now calls `RuntimeGraphPath.build(...).pathOf(step)` instead of its own local walk (behavior-preserving — proven by the full existing `InProcessPipelineEngineTreeWalkSpec` "the lane path" suite, unchanged, still green).
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` — `ConciseAnalyzeNode`/`PipelineAnalyzeConciseResponse` (+ `ByteBudget` constant) and `PipelineLaneTreeNode`, plus their JSON formats.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `analyzeConcise` (task 6.4) and `laneTree` (task 6.6), both reusing `RuntimeGraphPath`.
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRoutes.scala` — `GET /pipelines/:id/analyze?concise=true` opt-in dispatch; absent/false stays byte-identical to the pre-existing full response.
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` — no change needed for this section (noted for completeness).
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala` — `WorkspaceContextPipeline` gains `laneTree: Vector[PipelineLaneTreeNode]`.
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala` — `buildPipeline` fetches `pipelineService.laneTree` alongside `analyze`, degrading to `[]` on the same failure basis as `steps`/`stepsError`.
- `schemas/pipelines/pipeline-analyze-concise-response.schema.json` — NEW schema for the concise response.
- `schemas/workspace/workspace-context.schema.json` — `PipelineEntry.laneTree` + `LaneTreeNode` $def.
- `helio-mcp/src/types.ts` — widens `PipelineStepResponse` with `parentStepId`/`rootId` (already present on the wire, just not on this narrower client-side type).
- `helio-mcp/src/context.ts` — `WorkspaceContext.pipelines[].laneTree`, computed client-side from `getPipeline` + the already-fetched `outputsByPipeline` map, in its own independent try/catch (degrades to `[]` without affecting `steps`/`outputs`).

## Cycle 3 tests

- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` — concise-mode route tests (shape, `validationError` omitted when absent).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeConciseByteBudgetSpec.scala` — NEW: proves both directions of the byte budget on a 12-node/40-column/2-root graph.
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala` — `laneTree` content test (id/parentId/rootId/op/outputIds); fixed a pre-existing test-fixture gap (`pipelineService` wasn't wired with `outputRepo`, so `laneTree`'s bound-Output lookup silently returned `[]` — matches `ApiRoutes`'s real production wiring, which already passes `outputRepoOpt.orNull` at the same slot).
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceApplyBudgetSpec.scala` — updated fixture for the new `laneTree` field.
- `helio-mcp/src/context.test.ts` — two new tests: `laneTree` populated correctly, and degrades to `[]` on a `getPipeline` failure without affecting `steps`/`outputs`.



Cycle 1 (source → roots[] wire-shape lift) plus cycle 2's task 5 (patch-set lane edits:
`EditTarget.parentId`, `pipelineStep` create, the add-lane undo cascade + conflict check) and the
9.3 `target.parentId` system-prompt restoration this unblocks. Tasks 6.4-6.6 (concise `analyze_pipeline`
+ byte budget, workspace-context lane tree), 6.8 (`computeLaneLayout`-based review-UI render), 6.9-6.10
(docs example, HEL-865 update), 6b's remaining spec-body-to-code sweep beyond patch-set-contract/
patch-set-apply/patch-set-lane-edits, the AC1 E2E test (7.2), and 5.8 (undo of a lane **deletion**
restoring its Outputs/placements) are **NOT** included in this cycle — see the executor's final report.

## Cycle 2 additions (task 5 — patch-set lane edits)

- `backend/src/main/scala/com/helio/api/protocols/patchsets/PatchSetProtocol.scala` — `EditTarget` gains `parentId`; hand-written tolerant reader/writer (never a decode failure on absence, omitted on write); doc comment rewritten per task 5.4 (the `output`-create-gap explanation now states the gap is closed and `output` create is unimplemented because untested, not impossible).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` — generic `target.parentId` rejection for update/delete; `resolvePipelineStepCreate` (authorizes the named parent pipeline, decodes the create patch).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyTypes.scala` — `ResolvedAction.PipelineStepCreate(pipelineId, request)`.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyForward.scala` — forward-apply for `PipelineStepCreate` via `pipelineService.addStep`.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyRollback.scala` — mid-set rollback for `PipelineStepCreate` (deletes the just-created step).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjection.scala` — preview `after` for a `pipelineStep` create (pending-id echo of the create patch).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoTypes.scala` — `PatchSetUndoContext` gains an `outputRepo`.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoService.scala` — `restorePipelineStepCreate` (task 5.6): deletes the step via `pipelineService.deleteStep`, whose existing V94 cascade removes bound Outputs/placements atomically; reports the placement count (read before delete) in the outcome.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoConflictCheck.scala` — `checkPipelineStepCreate` (task 5.7): refuses the undo when another step in the same pipeline has a `lane`-kind `secondaryInput` referencing the node being undone.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `outputRepo` into `PatchSetUndoService`.
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` — `EditTargetSchema` gains `parentId` (check:schemas parity).
- `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala` — restores the `target.parentId` instruction (task 9.3 third bullet), now that 5.1 makes it true.
- `schemas/patch-sets/patch-set.schema.json` — `EditTarget.parentId`; conditional constraints (required for a `pipelineStep` create, forbidden for update/delete).

## Cycle 2 tests

- `backend/src/test/scala/com/helio/api/protocols/patchsets/PatchSetProtocolSpec.scala` — `EditTarget.parentId` round-trip/tolerance/omit-on-write tests.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — pipelineStep-create accept/reject (missing parentId, foreign parent pipeline, output/dataType still rejected), target.parentId rejected on update.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala` — undo of a pipelineStep create cascades its Output/placement and reports the placement count; undo is refused when a later sibling's lane secondaryInput references the node being undone.
- `backend/src/test/scala/com/helio/services/assistant/AssistantSystemPromptSpec.scala` — restores the `target.parentId` anchor test.


## Backend

- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProposalProtocol.scala` — `PipelineProposalSource` gains `clientId`; `PipelineProposal.source` → `roots: Vector[PipelineProposalSource]`; `PipelineProposalApplyResponse.source` → `sources: Vector[DataSourceResponse]`; hand-written reader rejects a payload carrying `source`, requires non-empty `roots`.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProposalProtocol.scala` — `sourceName`/`sourceSchema` → `sourceSchemas: Vector[RootSourceSchemaResponse]`, matching the persisted-pipeline twin.
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` — `PipelineProposalSourceSchema` gains `clientId`; `PipelineProposalSchema`'s `source` → `roots` array + updated `required`; both worked examples (`PipelineProposalExample`, `CombinedProposalExample`) rewritten to `roots: [...]`.
- `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala` — roots-array wording with per-root branch exclusivity and `rootClientId`; `test_connection` guidance now covers every inline root independently (task 9.3, first two of three sub-bullets; the `propose_patch_set`/`target.parentId` sub-bullet is deferred alongside task 5, not implemented).
- `backend/src/main/scala/com/helio/services/assistant/AssistantToolExecutor.scala` — `requireVerifiedInlineSource` verifies every root in `proposal.roots`/`proposal.pipeline.roots`, not just the first.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala` — `validate`/`apply`/structural validation/resolve/rollback all iterate `roots` in order; resolve-time rollback of already-created roots on a later root's failure; rootClientId binding validation for parentless steps on multi-root proposals; blocked-run reasons name every failing root.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `analyzeProposal` reuses `PipelineAnalyzeService.analyzeNodes`'s multi-root/lane projection (per-root schema keyed by root `clientId` or index), replacing the old single-source projection; `resolveOneProposalRootSchema` replaces `resolveProposalSourceSchema`.

## Schemas

- `schemas/pipelines/pipeline-proposal.schema.json` — `source` → `roots` (non-empty array); `PipelineProposalSource` $def gains `clientId`.
- `schemas/pipelines/pipeline-analyze-proposal-response.schema.json` — `sourceName`/`sourceSchema` → `sourceSchemas` (array of the persisted twin's `RootSourceSchema` shape).

## helio-mcp

- `helio-mcp/src/types.ts` — `PipelineProposalSource` gains `clientId`; `PipelineProposal.source` → `roots`; `PipelineAnalyzeProposalResponse.sourceName`/`sourceSchema` → `sourceSchemas`; `PipelineProposalApplyResponse.source` → `sources`.
- `helio-mcp/src/tools/pipelineProposal.ts` — zod schema and all three tools' (`propose_pipeline`/`analyze_pipeline_proposal`/`apply_pipeline_proposal`) input/description updated to `roots`.
- `helio-mcp/src/tools/pipelineProposalHandlers.ts` — `proposePipelineHandler` takes `roots`, calls `computePipelineProposalWarnings` with the array.
- `helio-mcp/src/tools/pipelineProposalValidation.ts` — `computePipelineProposalWarnings` is per-root, prefixing each warning with `roots[i]:`.
- `helio-mcp/src/tools/combinedProposal.ts` — description text and payload construction updated to `pipeline.roots`.

## Frontend

- `frontend/src/features/pipelines/types/pipelineProposal.ts` — `PipelineProposalSource` gains `clientId`; `PipelineProposalStep` gains `rootClientId`; `PipelineProposal.source` → `roots`; `PipelineProposalApplyResponse.source` → `sources`.
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalSummary.tsx` — renders every `proposal.roots[]` entry (not `computeLaneLayout`-based lane tree — see report); shows a parentless step's `rootClientId` when present.
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx` — demo fixture and connector-resolve callback updated to `roots`.
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReview.tsx` — `onConnectorResolved` callback signature widened to `(connectorId, key)`.
- `frontend/src/features/proposals/ui/CombinedProposalReviewPage.tsx` — demo fixture and connector-resolve callback updated to `roots`.
- `frontend/src/features/proposals/ui/CombinedProposalReview.tsx` — `onConnectorResolved` callback signature widened to `(connectorId, key)`.
- `frontend/src/features/proposals/utils/unresolvedConnectorRefs.ts` — connector detection runs per root (`detectForPipelineSource` iterates `proposal.roots`); `resolvePipelineConnectorRef`/`resolveCombinedConnectorRef` take a `key` naming which root to patch.
- `frontend/src/features/connectors/ui/InlineConnectorSetup.tsx` — `onResolved` now passes `(connectorId, reference.key)`.

## Tests (decode/consumer coverage per design.md D7, plus fixed call sites)

- `backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineProposalProtocolSpec.scala` — round-trip/rejection tests for `roots`, including a payload carrying `source` and an empty `roots` array.
- `backend/src/test/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemasSpec.scala` — updated to `roots`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala` — updated to `roots`/`sourceSchemas`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalSpec.scala` — updated to `roots`/`sources`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalRollbackSpec.scala` — updated to `roots`.
- `backend/src/test/scala/com/helio/api/routes/proposals/CombinedApplyProposalSpec.scala` — updated to `roots`.
- `backend/src/test/scala/com/helio/api/routes/proposals/CombinedApplyProposalRollbackSpec.scala` — updated to `roots`.
- `backend/src/test/scala/com/helio/api/routes/proposals/CombinedApplyProposalDanglingRefSpec.scala` — updated to `roots`.
- `backend/src/test/scala/com/helio/api/routes/proposals/CombinedApplyProposalRegressionSpec.scala` — updated to `roots`.
- `backend/src/test/scala/com/helio/services/assistant/AssistantServiceSpec.scala` — updated to `roots`.
- `backend/src/test/scala/com/helio/services/assistant/AssistantSystemPromptSpec.scala` — anchors the corrected roots/test_connection prose (task 9.5); removed the stale "never both in the same call" assertion.
- `backend/src/test/scala/com/helio/services/assistant/AssistantToolExecutorSpec.scala` — updated to `roots`.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineProposalServiceValidateSpec.scala` — updated to `roots`.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineServiceInlineRestBodySpec.scala` — updated to `roots`/`sourceSchemas`.
- `backend/src/test/scala/com/helio/services/proposals/CombinedProposalServiceValidateSpec.scala` — updated to `roots`.
- `helio-mcp/src/tools/pipelineProposalHandlers.test.ts` — updated to `roots`/`sources`.
- `helio-mcp/src/tools/pipelineProposalValidation.test.ts` — per-root warning test added.
- `helio-mcp/src/tools/combinedProposalHandlers.test.ts` — updated to `roots`/`sources`.
- `frontend/src/features/assistant/ui/ProposalHandoff.test.tsx` — updated to `roots`.
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts` — updated to `roots`/`sources`.
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReview.test.tsx` — updated to `roots`.
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.test.tsx` — updated to `roots`/`sources`.
- `frontend/src/features/proposals/state/combinedProposalsSlice.test.ts` — updated to `roots`/`sources`.
- `frontend/src/features/proposals/ui/CombinedProposalReview.test.tsx` — updated to `roots`.
- `frontend/src/features/proposals/ui/CombinedProposalReviewPage.test.tsx` — updated to `roots`/`sources`.
- `frontend/src/features/proposals/utils/unresolvedConnectorRefs.test.ts` — updated to `roots`; added a multi-root non-interference test.
- `frontend/src/features/connectors/ui/InlineConnectorSetup.test.tsx` — updated `onResolved` assertion to the two-arg signature.
