# HEL-1459: Patch-set target kinds drifted between backend, frontend type and tool description

## Description

The patch-set target kinds have drifted apart in three places:

* **Backend (reference):** the enum is panel, dashboard, dataSource, pipeline, pipelineStep, output (`AssistantProposalToolSchemas.scala:364`).
* **Frontend type:** `frontend/src/features/patchSets/types/patchSet.ts:8-11` (`EditTarget.kind`) differs from the backend:
  * it still lists the removed `"dataType"`;
  * it lacks `"output"` (added in HEL-907);
  * it has no `parentId` (added in HEL-914).
* **Tool description:** the `propose_patch_set` description (`AssistantProposalToolSchemas.scala:~527`) lists "panel/dashboard/dataSource/pipeline/pipelineStep" and leaves out `output`. That steers the model away from editing Outputs.

Verified against origin/main e4289e6c.

## Acceptance criteria

* The frontend type matches `schemas/patch-sets/patch-set.schema.json`: remove `dataType`, add `output`, add `parentId?`.
* The tool description lists `output`.
* A drift test fails CI when the schema enum changes and the frontend union or tool description doesn't. Ideally the test generates from the schema or asserts against it.

## Premise validation (orchestrator, 2026-10-11, origin/main c58764338)

All three claims CONFIRMED (line numbers moved: tool-schema enum now :370, description :534). Additional drift found in the same family, folded in because it is the same list drifting:

* `schemas/patch-sets/patch-set-preview-response.schema.json` `EditPreview.kind` enum lacks `output` although the backend previews `output` edits.
* `RefinementEditShape.Skeleton` (refinement prompt) lists `panel | dashboard | dataSource | pipeline | pipelineStep` (no `output`, no `parentId`).
* helio-mcp (`types.ts`, `refinementSchemas.ts`) is already aligned; covered by the guard so it cannot drift later.
