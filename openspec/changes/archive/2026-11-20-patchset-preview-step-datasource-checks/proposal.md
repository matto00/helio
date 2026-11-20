## Why

A patch set can preview clean and then fail on apply, because preview still skips apply's checks for `pipelineStep`
create/update, `dataSource` create/update, and a `pipeline` create whose roots have no steps or Outputs (HEL-1638
deferred these to HEL-1722).

## What Changes

- Extract `addStep`'s and `updateStep`'s pre-write checks (access, type, config, reference/ownership, lane/descendant,
  placement) into one read-only check function per write that the service calls before persisting and the patch-set
  resolvers call at resolve time (preview and apply both run `resolveAll`).
- `dataSource` create preview calls `DataSourceService.validateStatic` with the real row cap; `dataSource` update
  preview calls a new shared `DataSourceService.validateUpdate` that `update` also calls.
- `pipeline` create preview runs the inline-root create checks even when preflight returns early.
- An inventory of every `updateStep`/`addStep` check, each classified dry-run or apply-only with a reason.
- A parity spec (preview vs the direct service write) over all four gaps, red on main, with mutation proofs.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `proposal-dry-run-validation`: the "patch-set step add/update and data-source edit checks" exclusion is removed;
  those edits now run apply's checks at preview.

## Non-goals

- No change to what apply accepts. A check moves earlier (before any write); it never becomes stricter or looser.
- No change to patch-set undo (HEL-1720 owns it) and no migration.
- Cross-edit simulation stays out of scope: a step edit after another step edit of the same pipeline keeps its graph
  checks at apply only (design D7).
- The pipeline run, row reads and model calls stay apply-only.

## Impact

Backend: `services/patchsets` (step, data-source and pipeline resolvers; `PatchSetApplyContext`),
`services/pipelines` (`PipelineStepCreate`, `PipelineStepWrites`, `StepReferenceChecks`, `PipelineService` wiring),
`services/sources/DataSourceService`. New spec under `backend/src/test/scala/com/helio/services/patchsets/`.
No API shape change; preview returns 4xx for inputs apply already refused.
