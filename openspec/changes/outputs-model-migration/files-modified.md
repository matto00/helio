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
