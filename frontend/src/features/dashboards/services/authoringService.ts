import { isAxiosError } from "axios";

import { httpClient } from "../../../services/httpClient";
import type {
  AuthoringConversationView,
  AuthoringGoalRequest,
  AuthoringOutcome,
  AuthoringResult,
} from "../types/authoring";

/** `POST /api/authoring/dashboard` (HEL-392) — NL goal → grounded, validated
 *  `DashboardProposal`. The chat surface (design.md D1) only ever opens the
 *  `?stream=true` SSE variant; the fetch + SSE parsing itself lives in
 *  `useDashboardAuthoringStream` (`hooks/`), mirroring the existing
 *  hooks/services split (`usePipelineRunEvents.ts` / `proposalService.ts`).
 *  This module holds only the endpoint path and the wire types (design.md D3)
 *  — no fetch/stream logic here. */
export const AUTHORING_DASHBOARD_ENDPOINT = "/api/authoring/dashboard";

/** `GET /api/authoring/conversations/:id` (HEL-397 design.md D7) — rehydrates
 *  a conversation's visible thread after a reload. A plain `httpClient` GET
 *  (unlike the SSE POST above, this is a simple JSON round-trip, no streaming
 *  needed) — resolves `null` on a `404` (missing/not-owned, RLS-scoped) so
 *  the caller can degrade to a fresh conversation rather than surfacing an
 *  error for what is an expected, recoverable case (design.md D7). */
export async function fetchAuthoringConversation(
  conversationId: string,
): Promise<AuthoringConversationView | null> {
  try {
    const response = await httpClient.get<AuthoringConversationView>(
      `/api/authoring/conversations/${conversationId}`,
    );
    return response.data;
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      return null;
    }
    throw err;
  }
}

/** `POST /api/authoring/requests/:id/outcome` (HEL-401 design.md D4) — telemetry-only correlation
 *  signal fired from `ProposalReviewPage`'s Accept (after apply succeeds) and Reject actions,
 *  ONLY when the reviewed proposal carries an `authoringRequestId` (never for the pre-existing
 *  MCP/demo entry paths). Fire-and-forget by design (design.md D4's own stated trade-off): a
 *  network failure here must never block or surface an error for the real user-facing action
 *  (apply/reject) that already completed — callers should not `await` this for correctness, only
 *  to keep the request in flight past the calling function's own lifetime if needed. */
export async function postAuthoringOutcome(
  authoringRequestId: string,
  outcome: AuthoringOutcome,
): Promise<void> {
  await httpClient.post(`/api/authoring/requests/${authoringRequestId}/outcome`, { outcome });
}

export type { AuthoringConversationView, AuthoringGoalRequest, AuthoringOutcome, AuthoringResult };
