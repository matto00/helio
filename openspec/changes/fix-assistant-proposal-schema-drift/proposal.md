## Why

`AssistantProposalToolSchemas.scala`'s hand-rolled Claude tool schemas have drifted from the JSON
Schema contracts they're meant to mirror: `PipelineProposalStepSchema` is missing the optional
`enabled` boolean the pipeline-step wire contract already carries, and `EditTargetSchema`'s `kind`
enum is missing `output`, which the patch-set contract already accepts. Both gaps silently block an
authoring agent from expressing behavior the backend already supports. HEL-928's new
`check-schema-drift.mjs` parity check carries a narrow, ticket-referenced allowance for exactly
these two known gaps so it can still catch any other drift — this change removes that allowance by
fixing the drift itself.

## What Changes

- Add `enabled` (`type: [boolean, null]`) to `PipelineProposalStepSchema` in
  `AssistantProposalToolSchemas.scala`, matching
  `schemas/pipelines/create-pipeline-transactional-step-request.schema.json`.
- Add `"output"` to `EditTargetSchema`'s `kind` enum in the same file, matching
  `schemas/patch-sets/patch-set.schema.json`'s `$defs.EditTarget.properties.kind.enum`.
- Remove the two now-satisfied entries from `KNOWN_PRE_EXISTING_DRIFT` in
  `scripts/check-schema-drift.mjs`, restoring strict zero-exception parity.
- Extend `AssistantProposalToolSchemasSpec` with round-trip coverage for a step carrying
  `enabled: false` and a patch-set edit targeting `kind: "output"`.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — both `enabled` on pipeline steps and `output` as a patch-set target kind are already
established, spec-documented wire behavior; this change only brings the Assistant's own hand-rolled
Claude tool schema back into parity with contracts that already exist. No capability's documented
requirements change.)

## Non-goals

- No change to the underlying `PipelineProposalService`/`PatchSetService` validation or apply
  behavior — both already accept `enabled` and `output` today.
- No change to `check-schema-drift.mjs`'s parity-check mechanism itself, only removal of the two
  now-obsolete allowance entries.

## Impact

- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala`
- `backend/src/test/scala/.../AssistantProposalToolSchemasSpec.scala` (or wherever it lives)
- `scripts/check-schema-drift.mjs`
