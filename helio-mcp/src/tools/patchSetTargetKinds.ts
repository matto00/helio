/**
 * The MCP surface's single patch-set `target.kind` set (HEL-1459). `refinementSchemas.ts` builds its
 * zod `kind` enum from it and `types.ts` derives `EditTarget.kind` from it.
 * `patchSetTargetKinds.guard.test.ts` pins it to the backend `PatchSetTargetKinds.All` set via every
 * `schemas/patch-sets/` kind enum.
 */
export const PATCH_SET_TARGET_KINDS = [
  "panel",
  "dashboard",
  "dataSource",
  "pipeline",
  "pipelineStep",
  "output",
] as const;

export type McpPatchSetTargetKind = (typeof PATCH_SET_TARGET_KINDS)[number];
