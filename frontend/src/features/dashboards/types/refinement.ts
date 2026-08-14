import type { PatchSet } from "../../patchSets/types/patchSet";

/** `POST /api/refinements` request body (HEL-411 design.md D1/D5). `kind` is always `"dashboard"`
 *  for the in-app drawer (`refinement-chat-surface` spec — the id always comes from the app's
 *  already-selected dashboard, never user-typed); `"pipeline"` is reachable via the backend/MCP
 *  surfaces only (no in-app trigger yet, design.md Non-Goals). */
export interface RefinementTarget {
  kind: "dashboard" | "pipeline";
  id: string;
}

/** Mirrors `com.helio.api.protocols.RefinementRequest`. `conversationId` (design.md D3) is omitted
 *  for a fresh turn 1 and set to the prior turn's returned id to continue refining the same target —
 *  the server owns history/the working patch set entirely; this client never re-sends either. */
export interface RefinementRequest {
  target: RefinementTarget;
  message: string;
  conversationId?: string;
}

/** Terminal refinement outcome — mirrors `com.helio.api.protocols.RefinementResponse`. `patchSet` is
 *  already proven valid (server-side `PatchSetPreviewService.preview`) and unapplied — nothing is
 *  written until the user explicitly accepts it on `/patch-sets/review`. `conversationId` is passed
 *  back as the next turn's `RefinementRequest.conversationId`. */
export interface RefinementResult {
  patchSet: PatchSet;
  conversationId: string;
}
