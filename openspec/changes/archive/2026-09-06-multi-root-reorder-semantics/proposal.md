## Why

`PUT /api/pipelines/:id/steps/order` was written when a pipeline had exactly one root. HEL-913 made pipelines
multi-root and shipped this route **failing closed** (a named 400) rather than leave a silent cross-root
corruption reachable: `reorderTrunkInternal` derives "the trunk" root-unaware via `trunkOf`, and writes the
`idx == 0` step's `root_id` from `firstRootIdAction` (the lowest-positioned root) unconditionally — so a step
of root B could be silently reassigned to root A. This ticket replaces that fence with real behaviour and
closes HEL-903, the Pipelines & Outputs remodel epic.

## What Changes

- **Whole-pipeline reorder semantics** (owner ruling, final): `stepIds` is a permutation of the union of
  **every** root's trunk, with roots interleaved by position. `ReorderPipelineStepsRequest` keeps its current
  shape — **no** `rootId` field, so no request-shape break for existing callers.
- **Root membership becomes invariant by construction.** The requested order is partitioned by each step's
  *current* root membership and each root's subsequence is relinked as that root's own trunk chain. A step's
  `root_id` after the call always equals its `root_id` before it; reorder permutes position only.
- **`firstRootIdAction` is removed from `reorderTrunkInternal`** — deleted, not bypassed or guarded
  (HEL-913 task 7.3d: a reachable arm is a defect, not debt). Each root's new head carries *its own* root id.
- **`trunkOf` in this path is replaced by root-aware derivation** built on the existing `trunkOfRoot`/`rootIdsOf`.
- **HEL-913's multi-root 400 in `PipelineService.reorderSteps` is removed.**
- The request schema's description — singular-root, and now wrong in a second way — is rewritten.
- Frontend: the reorder payload is currently root-0-only, which would fail the union permutation contract on a
  multi-root pipeline. It becomes each root's trunk lane (that root's `position == 0` root-level chain), one per root — not every
  root-level lane, which would include tail roots and 422.
- **AC1 is restated** for whole-pipeline semantics (the original was written for the rejected per-root option);
  `design.md` records the restatement and its reasoning explicitly.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-step-reorder`: the endpoint's `stepIds` contract changes from "the pipeline's single trunk" to
  "the union of every root's trunk", relinking is per-root rather than one flat chain, and root membership is
  specified as invariant under reorder.

## Impact

- `backend/.../persistence/pipelines/PipelineStepRepository.scala` (`reorderTrunkInternal`,
  `validateTrunkReorderRequest`)
- `backend/.../services/pipelines/PipelineService.scala` (`reorderSteps` — fence removal)
- `schemas/pipelines/reorder-pipeline-steps-request.schema.json` (description; `check:schemas` must stay green)
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` (payload construction)
- No database migration: this is a relink over existing columns.

## Non-goals

- Re-opening the per-root vs. whole-pipeline decision. It is ruled; only a demonstrated invariant violation
  reopens it.
- Any cross-root *semantic* meaning for the interleaved order. R3 says inter-root order carries no weight; this
  change does not give it any.
- Reordering tails. A tail still follows its trunk step by id, untouched.
- Coordination with HEL-968 (already merged) and any change to HEL-590's or HEL-890's files.
