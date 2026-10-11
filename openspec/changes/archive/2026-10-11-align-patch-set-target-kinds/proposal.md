## Why

The set of patch-set target kinds (`panel`, `dashboard`, `dataSource`, `pipeline`, `pipelineStep`, `output`) is enumerated independently in the JSON schemas, the backend decoder, the assistant tool schema and description, the refinement prompt, the frontend type and helio-mcp. Several copies have drifted (HEL-1459): the frontend type still allows the removed `dataType`, lacks `output` and `parentId`; the `propose_patch_set` tool description and the refinement prompt skeleton omit `output`, steering the model away from editing Outputs; the preview-response schema's `kind` enum omits `output` although the backend previews output edits. Nothing fails when they drift.

## What Changes

- One backend source for the target-kind list; the decoder, the `propose_patch_set` tool schema enum, its description, and the refinement prompt skeleton all read it (description and skeleton now name `output`; the skeleton gets no `parentId` line — see design Non-Goals).
- Frontend: one `PATCH_SET_TARGET_KINDS` const; `EditTarget.kind` derives from it (drops `dataType`, adds `output`), `EditTarget.parentId?: string` added.
- `patch-set-preview-response.schema.json` `EditPreview.kind` enum gains `output` (documents what the backend already returns); stale schema description text about `output` being future work corrected.
- Labelled GUARD tests (HEL-1311 pattern), backend + frontend + helio-mcp, pinning each side's list to every patch-set target-kind enum under `schemas/patch-sets/`, and pinning the tool description / prompt skeleton to name every kind. Proven red by mutation.
- No behavior change to apply/preview/undo; no new kind is supported anywhere it was not already.

## Capabilities

### New Capabilities

### Modified Capabilities
- `patch-set-contract`: adds a requirement that every contract surface (schemas, backend decoder, assistant tool schema/description, refinement prompt, frontend type, MCP schema) enumerates the same target-kind set, enforced by guard tests; preview-response `kind` includes `output`.

## Impact

- Backend: `api/protocols/patchsets/PatchSetProtocol.scala`, `api/protocols/assistant/AssistantProposalToolSchemas.scala`, `services/patchsets/RefinementEditShape.scala`, new kinds object + guard spec.
- Frontend: `features/patchSets/types/patchSet.ts`, `PatchSetReview.test.tsx` fixtures (`dataType` → a live kind), new guard test.
- helio-mcp: guard test only (lists already correct); optionally a shared const.
- Schemas: `patch-set-preview-response.schema.json` (enum + description), description-only fixes in `patch-set-apply-response.schema.json` if stale.
- Prompt text change: the model now sees `output` in the patch-set kind list (intended per AC).
