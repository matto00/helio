# HEL-948: AssistantProposalToolSchemas.scala drifted from schemas/ (missing step `enabled`, missing patch-set `output` kind)

## Description

### Context

HEL-928 added a real parity check between `AssistantProposalToolSchemas.scala`'s hand-rolled `JsObject` tool schemas and the `schemas/**/*.schema.json` files they're meant to mirror. Turning that check on for the first time immediately surfaced two pre-existing, real drifts (not a false positive of the new checker — verified by direct reading of both files):

1. `PipelineProposalStepSchema` (used by the `propose_pipeline`/`propose_combined` `ClaudeTool`s) is missing the optional `enabled` boolean property that `schemas/pipelines/create-pipeline-transactional-step-request.schema.json` declares (`{ "type": ["boolean", "null"] }`). An agent authoring a pipeline proposal currently has no way to express a disabled step via these tools.
2. `EditTargetSchema` (used by the `propose_patch_set` `ClaudeTool`) declares `kind` as `enumSchema("panel", "dashboard", "dataSource", "pipeline", "pipelineStep")`, missing the `"output"` value that `schemas/patch-sets/patch-set.schema.json`'s `$defs.EditTarget.properties.kind.enum` has carried since HEL-907 task 1.2. An agent cannot propose a patch-set edit targeting an Output at all via `propose_patch_set`, even though the wire contract (and `EditTarget`'s own JSON Schema) supports it.

HEL-928's PR intentionally does not fix these — its author was scoped to `scripts/check-schema-drift.mjs` only and explicitly barred from editing backend Scala (parallel work was in flight on Output routes/services). The new check in `check-schema-drift.mjs` carries a narrow, clearly-commented allowance for exactly these two pre-existing mismatches (referencing this ticket) so the gate can still catch any other/new drift on these same surfaces without permanently blocking every future commit until this ticket is fixed.

## Acceptance Criteria

- Add `"enabled" -> JsObject("type" -> JsArray(Vector(JsString("boolean"), JsString("null"))))` (or equivalent) to `PipelineProposalStepSchema` in `AssistantProposalToolSchemas.scala`.
- Add `"output"` to `EditTargetSchema`'s `kind` `enumSchema(...)` call in the same file.
- Remove the corresponding narrow allowance comment/entries in `scripts/check-schema-drift.mjs`'s `KNOWN_PRE_EXISTING_DRIFT` (or equivalent) once both are fixed, so the check goes back to full strict parity with no exceptions.
- Add/extend `AssistantProposalToolSchemasSpec` coverage if useful (e.g. an example round-tripping an `enabled: false` step, or a patch-set edit targeting an `output`).

## References

Found via `check-schema-drift.mjs`'s new AssistantProposalToolSchemas parity check, added in HEL-928. Related: HEL-907 (added `output` to the JSON schema).
