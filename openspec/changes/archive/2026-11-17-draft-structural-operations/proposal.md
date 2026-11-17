## Why

HEL-1631's owner ruling (`block-during-draft-recommended`) disables every structural action while a pipeline draft is
open ("Save or discard your draft first"). A user who has started editing has to save or discard before adding a step,
which defeats the point of a live draft. The atomic save (HEL-1629) already accepts new steps by `clientId`,
re-parenting and trunk order, so the step-structure actions can be drafted with client work only.

Owner ruling on HEL-1684 (`split-as-proposed`): this change covers the step actions. Outputs and shapes go to HEL-1733.
Roots go to HEL-1734, which needs a backend extension of the save.

## What Changes

- While a draft is open, these actions become draft entries instead of being blocked: add step (append), insert step,
  duplicate step, "+ lane" (a new branch step) and trunk reorder (Move up/down and drag). With no draft open, each
  keeps its current immediate behavior.
- The draft model goes from `{configs, enabled, deleted}` to an ordered op log over the saved steps, so it can hold new
  steps (minted `clientId`s), their parents and positions. Each op mirrors the server primitive's semantics.
- Save & run sends new steps with `clientId`/`parentClientId`. Discard drops them. Kept drafts get a versioned format,
  and a draft kept in the old format still restores. The stale-base path is unchanged.
- The client evaluator and the draft-preview transport evaluate new steps.
- Root add/remove, shapes, "add Output" paths and Output create/edit/delete stay blocked during a draft with the same
  reason.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pipeline-draft-mode-ui`: the draft carries add, insert, duplicate, "+ lane" and reorder. The blocked set shrinks to
  roots, shapes and Outputs. Kept-draft format with old-format restore. Selection after a save of new steps.

## Impact

Frontend only: `features/pipelines/state/pipelineDraft.ts`, `state/keptDraft.ts`, `hooks/usePipelineDraft*.ts`,
`usePipelineDetailPage.ts` and the step-creation/reorder hooks it routes through, `state/draftEvaluation.ts`, and the
spine, mobile and step-card action wiring. New e2e spec. No backend, schema or migration change.

## Non-goals

- Outputs and shapes in a draft (HEL-1733). Roots in a draft (HEL-1734).
- Changing any action's behavior when no draft is open.
- Any backend, schema or migration change.
