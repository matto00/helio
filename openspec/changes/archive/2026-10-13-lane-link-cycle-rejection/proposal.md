## Why

A lane reference whose target reaches the writing step through a lane link (A lanes to X, X lanes to a descendant of A) is accepted at write time, but the engine's Kahn walk treats lane links as dependencies, so every run of that pipeline fails with `Cyclic or unresolved lane reference among pipeline steps`. The editor's lane picker also still offers descendants and lane-linked dependents that the server rejects or that can never run. HEL-1515 built both pieces and the owner cut them pending a product call; HEL-1523 then added a second, separate implementation of the direct-relation check for reorder and left a note to unify the two here.

## What Changes

- The write-time lane check rejects a target that already depends on the writing step through any chain of parent and lane links (the "dependents" of the step), not only its parent-chain descendants. Applies to step update, step create (dependents of the steps the insert re-parents), and trunk reorder (newly introduced violations only).
- New `400` wording for the lane-link case: `Lane reference '<id>' would create a cycle (it depends on this step through a lane link).` Existing self / missing / ancestor / descendant messages and their precedence are unchanged. **Assumed product call (overnight rules) -- OWNER REVIEW.**
- One pure implementation: `com.helio.domain.pipelines.LaneCycleViolations` gains the dependents closure and the relation classification; `PipelineService.validateLaneReference` and the reorder check both use it.
- Frontend: `computeDependentIds` in `laneLayout.ts` mirrors the backend closure; `SecondaryInputPicker` disables those choices with the existing "(would create a cycle)" reason.
- No migration, no new endpoint, no new status code on any endpoint.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-lane-rejoin-input`: the write-time cycle rejection (create, update, reorder) covers targets that depend on the writing step through lane links, with its own message.
- `pipeline-lane-rejoin-picker`: the picker disables descendants and lane-linked dependents with the cycle reason, not only ancestors.

## Impact

- Backend: `domain/pipelines/LaneCycleViolations.scala`, `services/pipelines/{PipelineService,StepReferenceChecks,PipelineStepCreate,PipelineStepWrites}.scala`, `infrastructure/persistence/pipelines/PipelineStepRepository.scala` (reorder message), tests.
- Frontend: `features/pipelines/state/laneLayout.ts`, `features/pipelines/ui/stepConfigs/SecondaryInputPicker.tsx`, tests; one e2e spec.
- API: the same `400` on the same endpoints, for a wider (strictly cyclic) set of writes. Clients already render non-2xx lane saves inline (HEL-1515 captureErrors).
