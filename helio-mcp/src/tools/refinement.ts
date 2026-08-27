/**
 * Propose → Review → Apply tools for conversational refinement over LIVE state (HEL-411).
 *
 * - `propose_patch_set` calls `POST /api/refinements`: grounds Claude in a target
 *   dashboard/pipeline's REAL current live state + workspace-wide context, and returns a
 *   validated `PatchSet` as JSON, writing NOTHING.
 * - `apply_patch_set` posts an accepted `PatchSet` to `POST /api/patch-sets/apply` (HEL-406,
 *   already shipped) — the SAME atomic, reviewable primitive `PatchSetReviewPage`'s own Accept
 *   action uses, so an external agent refines through one atomic call instead of firing raw
 *   per-resource PATCH tool calls (`update_panel`, etc.) one-by-one.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import type { PatchSet } from "../types.js";
import {
  applyPatchSetHandler,
  proposePatchSetHandler,
  undoPatchSetHandler,
} from "./refinementHandlers.js";

// Mirrors `PatchSetProtocol.scala`'s recognized `target.kind`/`op` sets — `patch` stays an
// untyped passthrough (`z.record(z.string(), z.unknown())`, absent for `op: "delete"`), same convention
// `proposal.ts`'s own `panelSchema.config` already uses for a per-kind opaque payload.
const editTargetSchema = z.object({
  kind: z.enum(["panel", "dashboard", "dataSource", "dataType", "pipeline", "pipelineStep"]),
  id: z.string().optional(),
});

const editSchema = z.object({
  target: editTargetSchema,
  op: z.enum(["update", "delete", "create"]),
  patch: z.record(z.string(), z.unknown()).optional(),
});

const patchSetSchema = z.object({
  summary: z.string().optional(),
  edits: z.array(editSchema),
});

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

async function guarded(produce: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await produce());
  } catch (err) {
    const message =
      err instanceof HelioApiError
        ? `${err.name} (status ${err.status}) for ${err.url}: ${err.message}`
        : `${(err as Error)?.name ?? "Error"}: ${(err as Error)?.message ?? String(err)}`;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

export function registerRefinementTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "propose_patch_set",
    {
      title: "Propose a patch set over a live dashboard/pipeline (no writes)",
      description:
        "Turn a natural-language refinement message into a reviewable PatchSet, grounded in the " +
        "target dashboard/pipeline's REAL current live state (its panel/step ids) plus " +
        "workspace-wide pipeline-output DataTypes and their panel-capability menus — writes " +
        "NOTHING. Calls POST /api/refinements: the returned PatchSet is already proven valid " +
        "(run through the SAME PatchSetPreviewService.preview check the apply path itself uses) " +
        "before it is ever returned, so a follow-up apply_patch_set call should succeed as-is. " +
        "Pass the SAME conversationId back on a follow-up call to continue refining the same " +
        "target across turns — history is server-owned, never re-send it. Review the patch set " +
        "(in-app at /patch-sets/review, or by inspection), then apply it with apply_patch_set.",
      inputSchema: {
        target: z.object({
          kind: z.enum(["dashboard", "pipeline"]),
          id: z.string().min(1),
        }),
        message: z.string().min(1),
        conversationId: z.string().optional(),
      },
    },
    ({ target, message, conversationId }) =>
      guarded(() => proposePatchSetHandler(api, { target, message, conversationId })),
  );

  server.registerTool(
    "apply_patch_set",
    {
      title: "Apply a patch set atomically",
      description:
        "Apply an accepted PatchSet via POST /api/patch-sets/apply — the SAME atomic, reviewable " +
        "primitive apply-proposal uses for dashboards, applying every edit in order and rolling " +
        "back everything already applied if a mid-set edit fails (nothing is left half-applied). " +
        "Does NOT decompose the patch set into individual per-resource PATCH tool calls — pass " +
        "the exact PatchSet propose_patch_set returned (or one built/edited by hand matching the " +
        "same shape: { summary?, edits: [{ target: {kind, id?}, op: update|delete|create, " +
        "patch? }] }, where `patch` reuses each kind's existing PATCH/create request shape " +
        "verbatim and is absent entirely for op: delete). Returns the PatchSetApplyResponse " +
        "verbatim (per-edit status/newId/priorState/resultingState, plus `failure` when a " +
        "rollback happened).",
      inputSchema: {
        patchSet: patchSetSchema,
      },
    },
    ({ patchSet }) => guarded(() => applyPatchSetHandler(api, patchSet as PatchSet)),
  );

  server.registerTool(
    "undo_patch_set",
    {
      title: "Undo a previously-applied patch set",
      description:
        "Undo a previously-applied PatchSet via POST /api/patch-sets/:id/undo, using the " +
        "applicationId returned by a prior apply_patch_set call (present on its response exactly " +
        "when that apply succeeded and was journaled). Restores every edit in that application to " +
        "its pre-apply state, or restores NONE of them: if any touched resource changed since the " +
        "apply, or the application contains a delete edit with no restoring create API " +
        "(dashboard/dataSource/dataType/pipeline), the whole undo is refused and nothing is " +
        "touched. Returns the PatchSetUndoResponse verbatim (per-edit status/newId/resultingState) " +
        "— never attempts a partial or manual per-resource restore itself.",
      inputSchema: {
        applicationId: z.string().min(1),
      },
    },
    ({ applicationId }) => guarded(() => undoPatchSetHandler(api, applicationId)),
  );
}
