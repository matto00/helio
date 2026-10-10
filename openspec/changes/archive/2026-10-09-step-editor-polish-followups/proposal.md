## Why

HEL-1416 added save-time rejection of clearly invalid fillnull/window/pivot enum values and surfaced the server's 422 inline. Review left five small inconsistencies (HEL-1422): an unspaced error under the fillnull editor, an invalid choice shown with no invalid marking, an odd-one-out validator comment, a regressed run-time error order for lag/lead, and op specs that never describe the write-time rule.

## What Changes

- FillNullConfig's root container uses the same tokenized column layout (`pipeline-detail-page__aggregate-config`, `gap: var(--space-5)`) as WindowConfig/PivotConfig, so its InlineError is spaced like theirs.
- After a rejected save, fillnull/window/pivot keep the user's choice (the established keep-intent rule in `useStepCardState.persist`) and mark the offending control invalid, aria-linked to the InlineError (HEL-1407 aggregate / `FormField` `errorId` precedent). `InlineError` gains an optional `id` prop on its text variant.
- Comment-only: pivot validator comments reworded to match fillnull/window.
- `WindowStep.apply` checks the missing `field` before the offset, restoring the pre-HEL-1416 order and matching analyze.
- Spec deltas: write-time validation, the window error-order scenario and the rejected-save editor scenario for the fillnull/window/pivot op specs.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-fillnull-op`: write-time scenarios + rejected-save editor behaviour.
- `pipeline-window-op`: write-time scenarios, lag/lead run-time error order, rejected-save editor behaviour.
- `pipeline-pivot-op`: write-time scenarios + rejected-save editor behaviour.

## Impact

- Frontend: `shared/chrome/InlineError.tsx`, `features/pipelines/ui/stepConfigs/{FillNull,Window,Pivot}Config.tsx` (+ tests).
- Backend: `domain/steps/WindowStep.scala` (`apply` order), comment edits in `PivotStep.scala` and `domain/engine/StepConfigValidation.scala` (+ a WindowStep spec test).
- No API, schema, migration or wire-shape change.
