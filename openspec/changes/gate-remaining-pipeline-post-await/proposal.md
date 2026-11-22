## Why

HEL-1798 gated eight pipeline page hooks with HEL-1634's session epoch so work finishing after a sign-out no longer
dispatches actions or issues requests carrying the previous user's ids. Its enumeration
(`openspec/changes/archive/2026-11-20-gate-pipeline-hooks-session-epoch/post-await-sites.md`) left four sites outside
that ruling, each of which still dispatches or sends after an `await` with no session check (re-verified on
de44f85fb, see `.concertino/runs/HEL-1810/evidence/premise-validation.md`):

- `usePipelineDraftCreate.ts`: the `.then` of a draft AI step's create flushes an in-flight edit with
  `updatePipelineStep(persisted.id, ...)` (line 86).
- `usePipelineShapeInstantiation.ts`: the shape loop issues the next `createPipelineStep`/`createOutput` after each
  await (lines 83-108), and its `catch` pushes a toast.
- `usePipelineRunStream.ts`: the SSE terminal handler dispatches `resetRunScopedState`, per-Output `previewOutput`
  and calls `refreshRunHistoryAfterRun()` (lines 39-75).
- `usePipelineDraftUndo.ts`: after `undoPatchSet` it dispatches `dismissToast`, requests `getPipelineWithDefinition`,
  then dispatches via `adoptDefinition`, `fetchPipelineById` (line 57) and a success toast, guarded only by
  `mountedRef`.

Separately, `handleAddOutputViaAggregateTail`'s same-session rollback (`deletePipelineStep` when `createOutput`
fails) has no test: HEL-1798's evaluator replaced its guard with `if (false)` and the whole pipelines suite passed.

## What Changes

- Each of the four sites captures the session epoch when its work starts and, after each await (or in the terminal
  callback), skips every dispatch, dispatching helper and service request when the epoch has changed.
- One failing-first test per site proves nothing is dispatched or sent after sign-out.
- A same-session test proves the aggregate-tail rollback deletes the orphaned step; it is red under the
  `if (false)` and inverted-condition mutations.
- No behaviour change within one session. No backend change, no migration.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `sign-out-client-state-reset`: the pipeline-page scenario of "A load started before sign-out cannot repopulate
  state after it" extends to creating a draft AI step, applying a shape, a live run's stream ending, and undoing a
  save.

## Impact

- `frontend/src/features/pipelines/hooks/`: `usePipelineDraftCreate.ts`, `usePipelineShapeInstantiation.ts`,
  `usePipelineRunStream.ts`, `usePipelineDraftUndo.ts`, plus new `*.sessionEpoch.test.tsx` files and one added test in
  `usePipelineStepStructure.sessionEpoch.test.tsx`.
- Non-goals: the epoch mechanism/middleware (`shared/session/`), the eight hooks HEL-1798 already gated (beyond the
  one added test), toast-only or local-state-only sites in other hooks, the draft evaluator (HEL-1807) and
  dependency bumps (HEL-1820).
