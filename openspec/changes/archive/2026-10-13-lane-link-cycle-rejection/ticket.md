# HEL-1521: Reject lane references that would cycle through lane links, and disable cyclic choices in the lane picker (cut from HEL-1515)

## Description

origin_kind: followup
origin_ticket: HEL-1515

The owner trimmed HEL-1515 (PR matto00/helio#974) back to the reject-at-write ruling: a lane reference that names the writing step's own **descendant** (through the parent chain) now gets `400 "Lane reference '<id>' would create a cycle (it is a descendant of this step)."`. This applies on step update and on any create that re-parents existing steps under the new step. Two pieces were built and then cut from that PR. This ticket keeps them.

### 1. Lane-transitive cycles

**Case:** step A lanes to X, and X lanes to a descendant of A. The pipeline can never run. The engine's Kahn walk (`InProcessPipelineEngine.executeTree`, the `loop`/`isReady` fallback) treats lane links as dependencies, so every run fails with `Cyclic or unresolved lane reference among pipeline steps: ...`. HEL-1515's parent-chain descendant check accepts this write.

**Cut implementation:** a dependents closure over reverse edges (children plus lane referrers), for example `dependentStepIds` next to `PipelineService.descendantStepIds`. It fed the same `validateLaneReference` branch. Found by HEL-1515's design-gate skeptic (round 1, #4). The executor's repro (`StepLaneDependentsRoutesSpec`, lane-transitive case) returned 200 on the unmodified code.

**Product question:** the cut version would reject these writes, which extends the "descendant" rule to "anything that depends on this step". Get the owner's call on that before building it.

### 2. Picker disables cyclic choices

`SecondaryInputPicker` disables only ancestors (`computeAncestorIds`). It still offers descendants, and (after part 1) lane-linked dependents, which the server rejects.

**Cut implementation:**

* `computeDependentIds` in `laneLayout.ts`, mirroring the backend closure.
* The picker disables those choices with "(would create a cycle)".
* An e2e, `e2e/hel1515-lane-picker-dependents.spec.ts`.
* A modified delta for `openspec/specs/pipeline-lane-rejoin-picker`.

HEL-1515 kept the related captureErrors fix, so a rejected join/union/lookup save is now shown inline instead of being silently dropped. This ticket is about preventing the bad choice up front.

The cut code is in the PR matto00/helio#974 history (commits 567001f48 / a08deb582 / 25b32c23e on `task/shared-step-reference-checks/HEL-1515`), and the design is in `openspec/changes/archive/2026-10-12-shared-step-reference-check-chain/design.md` (D4).

## Acceptance Criteria

1. A `lane` reference whose target already depends on the writing step through any mix of parent and lane links (not only the parent-chain descendant set) is rejected with `400` on step update and on step create (create: dependents of the steps the insert re-parents), and the step is not persisted / the stored config is unchanged. Self / missing / ancestor / parent-chain descendant keep their existing status, message and precedence.
2. Trunk reorder (`PUT /api/pipelines/:id/steps/order`) rejects a newly introduced lane-link cycle the same way it rejects the direct relations (HEL-1523), with no placement change; a pre-existing violation still does not block.
3. ONE pure implementation of the relation (domain `LaneCycleViolations`) serves create, update, duplicate and reorder (unifying `validateLaneReference` with HEL-1523's reorder check).
4. `SecondaryInputPicker` disables (with "(would create a cycle)") every lane choice the server would reject for a cycle: parent-chain descendants and lane-linked dependents, in addition to today's ancestors.
5. Spec deltas for `pipeline-lane-rejoin-input` and `pipeline-lane-rejoin-picker`.
6. Red-first backend repro (lane-transitive update returns 200 on unmodified code), unit tests for the closure on both sides, and an e2e for the picker.

## Driver context (overnight rules)

- The extension from "descendant" to "anything that depends on this step", and the new message wording, are ASSUMED PRODUCT CALLS: record them in the PR's OWNER REVIEW section; the PR is parked unmerged for the owner.
