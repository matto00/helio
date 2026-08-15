/**
 * `propose_patch_set`/`apply_patch_set`'s actual call-routing logic (HEL-411, mirrors
 * `combinedProposalHandlers.ts`'s HEL-387 split). This file imports NEITHER `zod` NOR
 * `@modelcontextprotocol/sdk`'s `McpServer` — each export below is a plain async function taking
 * `api: HelioApi` plus a plain TS-typed argument, so a test can import this module directly and
 * exercise the real `HelioApi` call-routing + `HelioApiError` propagation without pulling
 * `refinement.ts`'s `server.registerTool(...)` calls (combined with its zod schema surface) into
 * the compile graph (see `combinedProposalHandlers.ts`'s docstring for the TS2589 reasoning this
 * mirrors).
 *
 * `refinement.ts` itself is a thin shell: a zod `inputSchema` declaration per tool +
 * `guarded(() => …Handler(api, …))`, with no business logic of its own — everything below is that
 * logic.
 */

import type { HelioApi } from "../helioApi.js";
import type {
  PatchSet,
  PatchSetApplyResponse,
  PatchSetUndoResponse,
  RefinementResult,
} from "../types.js";

/** `propose_patch_set`'s handler: calls `POST /api/refinements` via `HelioApi.proposePatchSet` —
 *  read-only, writes NOTHING (spec.md "propose_patch_set SHALL assemble and return a patch set
 *  without writing anything" — this function never calls `applyPatchSetHandler`/
 *  `api.applyPatchSet`). */
export function proposePatchSetHandler(
  api: HelioApi,
  input: {
    target: { kind: "dashboard" | "pipeline"; id: string };
    message: string;
    conversationId?: string;
  },
): Promise<RefinementResult> {
  return api.proposePatchSet(input);
}

/** `apply_patch_set`'s handler: posts to the EXISTING `POST /api/patch-sets/apply` (HEL-406) via
 *  `HelioApi.applyPatchSet` — no client-side re-validation, no decomposition into individual
 *  per-resource PATCH calls (spec.md "apply_patch_set SHALL post to the existing patch-set apply
 *  endpoint, not raw PATCH calls"). */
export function applyPatchSetHandler(
  api: HelioApi,
  patchSet: PatchSet,
): Promise<PatchSetApplyResponse> {
  return api.applyPatchSet(patchSet);
}

/** `undo_patch_set`'s handler: posts to the EXISTING `POST /api/patch-sets/:id/undo` (HEL-413) via
 *  `HelioApi.undoPatchSet` — no client-side re-validation, no per-resource decomposition (mirrors
 *  `applyPatchSetHandler` exactly; returns the result verbatim, including a conflict, which
 *  surfaces as an `HelioApiError` propagated by `guarded()` in `refinement.ts`). */
export function undoPatchSetHandler(
  api: HelioApi,
  applicationId: string,
): Promise<PatchSetUndoResponse> {
  return api.undoPatchSet(applicationId);
}
