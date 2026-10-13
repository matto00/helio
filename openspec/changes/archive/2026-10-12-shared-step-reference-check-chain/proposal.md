## Why

Step create (`PipelineStepCreate`), update (`PipelineStepWrites.updateStep`) and duplicate
(`PipelineStepWrites.duplicateReferenceChecksF`) each hand-copy the same reference-check chain: secondary-source
ownership (caller), then lane reference, then upsert target (pipeline owner). HEL-1514 had to add the third copy by hand.
The copies can drift. The duplicate lane tests pin only status codes, not the "same status and message" contract. Update's
lane check never considers the step's own descendants. And the only e2e that covers step duplicate is quarantined.

## What Changes

- One shared, behaviour-preserving reference-check chain used by all three write paths. Each caller supplies only its
  own lane scope (prospective ancestors, self id) and keeps any work it already does between stages (create's
  pipeline lookup and editor check run between lane and upsert today, and stay there).
- `DuplicateStepReferenceChecksSpec` lane tests assert the exact message as well as the status.
- Audit and reproduce the update-time descendant lane reference first. If it reproduces as a pipeline that saves but
  can never run, the write is rejected with `400` ("would create a cycle (it depends on this step)"), the same status as
  today's ancestor case. This is an ASSUMED product call under the owner's overnight rule (C1): it is built now, flagged
  OWNER REVIEW in the PR, and parked for the owner. The rejected set is every step that depends on the writing step
  through parent or lane links. It applies on update and on any create whose placement re-parents existing steps,
  including a plain append onto a trunk step that owns a tail. Duplicate is unchanged.
- Investigate `e2e/hel908-tail-attach.spec.ts`. If its failure is a stale locator for a renamed affordance and the
  behaviour is intact, repair it and remove it from `testIgnore`. Otherwise report why and leave it quarantined.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-lane-rejoin-input`: a lane reference naming a step that depends on the referencing step (via parent or lane
  links) is rejected at write time as a cycle, on update and on any re-parenting create. This is an assumed product
  call (C1).

## Impact

- Backend: `PipelineStepCreate.scala`, `PipelineStepWrites.scala`, possibly `PipelineService.validateLaneReference`,
  and a new small helper file in `services/pipelines`.
- Tests: `DuplicateStepReferenceChecksSpec`, a new descendant-cycle spec, plus mutation evidence.
- E2E: `e2e/hel908-tail-attach.spec.ts` and `playwright.config.ts` (only if un-quarantined).
- No migration, no API shape change. The only status change is the conditional descendant `400`.

## Non-goals

- Trunk reorder (`reorderSteps`) making an existing lane reference cyclic. It is not a write of the referencing step's
  config. It will be reported as a follow-up if observed.
- Rewriting stored rows that already hold a descendant reference.
- Other quarantined specs under HEL-951.
