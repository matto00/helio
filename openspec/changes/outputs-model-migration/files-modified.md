# Files modified — cycle 8 (round-5 skeptic findings: splice-ordering bug, sibling-scoped PATCH
position, discretionary doc close-outs)

Scope: `final-skeptic-migration-correctness-5.md` Findings 1 (splice-ordering) and 2 (PATCH
position, ESCALATION-CLASS per the skeptic, resolved by the coordinator per this ticket's binding
position-renumbering ruling — sibling-scoped, reject-or-rescope), plus the exhaustive
reader/writer inventory this cycle was required to produce, plus the discretionary doc closures
from `final-skeptic-wire-contract-diff-5.md` and `final-skeptic-deletion-sweep-5.md`.

## Finding 1 — `spliceInsertAtInternal` misplaced the new step relative to a tail-bearing anchor

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` —
  `spliceInsertAtInternal` now reparents ALL of the anchor's existing direct children (both the old
  position-0 trunk continuation AND any position!=0 tail roots), not just the position-0 occupant.
  This fixes the reproduced defect: an anchor whose only child was a migration-created tail (no
  position-0 occupant at all) previously left that tail attached to the anchor, so `executionOrder`
  emitted it BEFORE the newly-spliced-in step (tails precede the trunk continuation in the walk).
  Reparenting every existing child preserves each child's own `position` (so their relative order
  among themselves is unchanged; only their common parent moves one hop down onto the new step).

## Finding 2 — `PATCH /api/pipeline-steps/:id {"position": N}` wrote the raw column unscoped

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` —
  new private `positionScopedUpdateAction`, shared by both `update` (owner-scoped) and
  `updateInternal` (ACL-bypassing, the one `PipelineService.updateStep`/the PATCH route/the MCP
  `update_pipeline_step` tool/`PatchSetApplyRollback`/`PatchSetUndoService` all route through). A
  requested `position` is now clamped to `[0, siblingCount]` and resolved WITHIN the step's own
  existing sibling group only (same idiom as `reorderInternal`/`insertAtInternal`), so a PATCH can
  never produce two position-0 children at one node or sever a trunk. `insert` (owner-scoped, dead
  code, test-only caller) also re-scoped its `max(position)` query to root siblings only, closing
  the "loaded gun" non-blocking note from round 4/5.

## Exhaustive reader/writer inventory (this cycle's completeness proof — see execution-progress.md)

Confirmed clean (sibling-scoped or read-only, no fix needed): `siblingsQuery`, the deleted-row
children query in `deleteInternal`, `childrenOf`, `trunkOf`, `tailsOf`, `executionOrder`,
`insertInternal`, `insertAtInternal`, `reorderInternal`, `listByPipelineInternal`/`listByPipeline`,
`PipelineRunService.scala:266`, `RefinementPrompt.scala:87,155`, the MCP `update_pipeline_step` tool
(routes through the same fixed backend PATCH), `PatchSetApplyRollback`/`PatchSetUndoService`
(route through the same fixed `updateStep`), the proposal-apply path (`PipelineProposalService`
only writes Outputs, never raw `pipeline_steps.position`). Fixed this cycle: `updateInternal`,
`update`, `insert` (position-scoping), `spliceInsertAtInternal` (reparent-all-children ordering).
Noted, not fixed (preview-only, not a DB writer, out of this cycle's explicit "writer" scope):
`PatchSetPreviewProjection.pipelineStepUpdateAfter`/`PipelineStepProjectionSupport.withPosition`
now echoes the raw requested `position` in a PREVIEW response without applying the same clamp
`positionScopedUpdateAction` applies on the real write — a cosmetic preview/apply drift, not a
corruption path (nothing is persisted from a preview call). Flagged for a future ticket.

## Regression coverage (all mutation-tested)

- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpliceSpec.scala` —
  new test groups for both findings: a tail-only anchor, a trunk-plus-tail anchor, and a mutation
  proof (old position-0-only reparenting reproduces the misplacement; the real fixed method does
  not) for Finding 1; a mid-trunk PATCH invariant test, a run-result-node-key-stability test, and a
  mutation proof (raw unscoped write severs a real trunk; the fixed `updateInternal` cannot) for
  Finding 2.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala` —
  new test group exercising the PATCH-severing proof against the REAL 20-step migrated pipeline
  (`6ba5075b-2291-4508-881b-a517b1f300cf`) the round-5 report reproduced the collapse on: a
  position PATCH on a mid-trunk step leaves the 20-step trunk and the run-result node key
  (`trunkOf(...).lastOption`) intact, plus a mutation proof reproducing the exact 20→2 collapse via
  a raw unscoped write, then confirming the real fixed method cannot reproduce it.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` — updated
  the pre-existing "POST with position: 0" route test's expectations to match the corrected
  (Finding-1-fixed) exec order (both root siblings now reparent onto the new step, not just the
  position-0 one); added a new tail-bearing-anchor regression test for `POST
  /pipeline-steps/:id/duplicate`, exercised through the real route against a migrated
  (parent-chained) pipeline shape with a real tail — the exact shape the round-5 report noted the
  existing pure-chain tests "provably cannot catch."

## Discretionary doc close-outs (delegated by the human as ordinary/contained)

- `schemas/authoring/combined-proposal.schema.json` — stale sentinel-rule text
  ("outside metric/chart/table/collection/timeline" → "outside `output`").
- `schemas/dashboards/dashboard-proposal.schema.json` — 3 stale strings asserting a text/markdown
  `dataTypeId`/`fieldMapping` binding that no longer exists (`dataTypeId`, `fieldMapping`, `config`
  property descriptions).
- `backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala` — fixed the
  `:153-157` comment's self-contradiction with `:101-107`/`bindingCandidate`.
- `backend/src/test/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemasSpec.scala` —
  added the missing `PanelType.fromString`/`ProposalPanelSupport.validatePanel` pin over every
  panel in every `propose_combined`/`propose_dashboard` worked example, closing the gap that let
  this defect class (stale panel-kind literal in a worked example) recur silently across three
  rounds.
- `openspec/changes/outputs-model-migration/specs/pipeline-compute-op/spec.md` — corrected the
  `InProcessPipelineEngine.applyCompute` reference to `ComputeStep.apply` (the op's real home,
  `domain/steps/ComputeStep.scala`), preventing the wrong name from being republished into the base
  spec at archive time.

## Round-5 skeptic reports (committed, not authored this cycle)

- `openspec/changes/outputs-model-migration/final-skeptic-migration-correctness-5.md`
- `openspec/changes/outputs-model-migration/final-skeptic-wire-contract-diff-5.md`
- `openspec/changes/outputs-model-migration/final-skeptic-deletion-sweep-5.md`

## Cycle 9 (round-6 skeptic findings, 3 named items)

- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `addStep`'s
  no-`position` default branch (`persistNewStep`) now resolves the current trunk's last step
  (`pipelineStepRepo.trunkOf(current).lastOption`) and splices via `spliceInsertAtInternal`,
  instead of calling `insertInternal` with a bare `parentStepId = None`. Fixes round-6
  migration-correctness Finding 1: the primary/default step-creation path was producing a flat
  root sibling per step instead of extending the trunk, so `PipelineRunService`'s node key
  (`trunkOf(steps).lastOption`) and `PipelineProposalService`'s Output binding
  (`createdSteps.lastOption`) silently diverged on every ordinarily-created pipeline.
- `backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringPrompt.scala` — rewrote
  `ProposalShapeDescription`/`Instructions`/`groundingSection` to the shipped 4-kind panel set
  (`text | markdown | image | output`), dropping the deleted `metric | chart | table | collection |
  timeline` kinds and their now-nonexistent `fieldMapping`/`aggregation`/`chartType`/`label`/`unit`/
  `sort` fields. Fixes round-6 deletion-sweep Finding 2 (CR2): `POST /api/authoring/dashboard` was
  functionally broken for every data-bound panel — every model-generated proposal following the
  stale prompt was rejected at `PanelType.fromString`, and the single repair round-trip pointed
  back at the same wrong shape.
- `backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala` — corrected the
  `:153-157` comment: `fieldMapping` is decoded but never applied on ANY current panel kind
  (including `output`, which was still wrongly claimed) — only `dataTypeId` (which becomes
  `outputId`) is meaningful for `output` panels. Fixes round-6 deletion-sweep Finding 1 (CR1),
  second instance.
- `schemas/dashboards/dashboard-proposal.schema.json` — `fieldMapping` property description
  corrected to match `buildDataConfig`'s actual `{outputId}`-only emission for `output` panels
  (was still claiming pass-through "alongside dataTypeId"). Fixes round-6 deletion-sweep Finding 1
  (CR1), first instance.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` — added the
  required-proof regression test (addStep x3 with no position → `trunkOf` returns all 3 in order,
  `lastOption` matches what the run-result node key/Output binding would use; mutation-tested:
  reverting the `PipelineService` fix reproduces the failure, restoring it goes green). Updated
  every pre-existing fixture that relied on `addStep`-with-no-position producing flat root
  siblings (now a genuine trunk chain) — either adjusted expectations (2 tests) or switched fixture
  seeding to a direct SQL `seedRootStep` helper for tests whose actual purpose is exercising
  sibling-scoped splice/reorder behavior (7 tests) — matching the `PipelineId.equals`-free two-line
  idiom the pre-existing sibling-group reorder test already used.
- `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala` — same fixture fix
  as above for the `pipeline.step.reorder` audit test (two `addStep` calls no longer produce a
  reorderable sibling pair; seeded directly via SQL instead).
- `backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringPromptSpec.scala` —
  updated the grounding-section string assertion to the corrected `"Available pipeline
  Outputs:"` wording; added a regression test pinning the rendered prompt's panel-kind list
  against `PanelType.fromString`'s accepted set, so this class of drift (a stale panel-kind
  literal in the live prompt) cannot recur silently the way it did this cycle.

## Round-6 skeptic reports (committed, not authored this cycle)

- `openspec/changes/outputs-model-migration/final-skeptic-migration-correctness-6.md`
- `openspec/changes/outputs-model-migration/final-skeptic-wire-contract-diff-6.md`
- `openspec/changes/outputs-model-migration/final-skeptic-deletion-sweep-6.md`

## Round-7 fix cycle (this commit)

- `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala` — round-7
  deletion-sweep CR1: retargeted the worked `propose_dashboard` mini-transcript from the deleted
  `"metric"` panel kind to `"output"` (dropping the inert `fieldMapping`/`aggregation` keys);
  dropped "and metrics" from the `find` tool description (metrics were already removed from
  `WorkspaceAssistantTools.ResourceTypeEnum`); dropped `metricId` from the "never fabricate a
  resource id" rule; dropped "DataType" from the `propose_patch_set` editable-target list
  (`PatchSetProtocol.recognizedKinds` no longer accepts `"dataType"`, task 3.3).
- `backend/src/test/scala/com/helio/services/assistant/AssistantSystemPromptSpec.scala` — added
  regression tests pinning: no deleted panel kind / retired Metrics-DataType id literals anywhere
  in the rendered prompt; the worked example uses `"type": "output"`; the `propose_patch_set`
  target list no longer offers DataType.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepProtocol.scala` — round-7
  migration-correctness CR1: updated `CreatePipelineStepRequest` scaladoc to describe the shipped
  trunk/tail splice semantics (position-absent = trunk continuation with sibling-scoped
  `position = 0`, not the old whole-pipeline `MAX(position)+1`), replacing the now-false
  "pre-existing behavior, unchanged" claim.
- `schemas/pipelines/create-pipeline-step-request.schema.json` — same correction to the wire
  contract's `description` (source of truth per CLAUDE.md).
- `openspec/changes/outputs-model-migration/specs/pipeline-steps-persistence/spec.md` — new spec
  delta (previously missing) reconciling the sibling `pipeline-steps-persistence` capability's
  `POST /api/pipelines/:id/steps` requirement with the `pipeline-step-tree` delta's trunk/tail
  model: position-absent trunk continuation, position-present splice-anchor translation, and
  `position` as a sibling-scoped tiebreaker rather than a whole-pipeline ordering key.
- `openspec/changes/outputs-model-migration/final-skeptic-deletion-sweep-7.md`,
  `final-skeptic-migration-correctness-7.md` — round-7 final-gate skeptic reports (committed, not
  authored this cycle).

## Round-8 fix cycle (this commit)

- `schemas/pipelines/create-pipeline-step-request.schema.json` — corrected the round-7 fix's own
  overclaim: `position = count` is equivalent to trunk continuation ONLY when the trunk-last step
  has no existing tails. `executionOrder` emits a node's tails after its trunk continuation, so on
  a tail-bearing pipeline `position = count` anchors on the trunk-last step's last tail, not on
  trunk-last itself — `persistNewStep` (`PipelineService.addStep`'s position-absent branch)
  anchors on `current(index - 1)` where `current = executionOrder(...)`, exposing the gap.
- `openspec/changes/outputs-model-migration/specs/pipeline-steps-persistence/spec.md` — same
  correction in the position-present bullet, plus scoped the "Insert at count equals append"
  scenario to the tail-free case and added the general-case note.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — corrected the
  same overclaim in `persistNewStep`'s source comment (round-7's own non-blocking note 1,
  propagated into binding surfaces).

Reword-only; no behavior change, no new tests (existing fixtures are tail-free and stay green).
