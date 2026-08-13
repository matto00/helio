import type { AuthoringGoalRequest, AuthoringResult } from "../types/authoring";

/** `POST /api/authoring/dashboard` (HEL-392) — NL goal → grounded, validated
 *  `DashboardProposal`. The chat surface (design.md D1) only ever opens the
 *  `?stream=true` SSE variant; the fetch + SSE parsing itself lives in
 *  `useDashboardAuthoringStream` (`hooks/`), mirroring the existing
 *  hooks/services split (`usePipelineRunEvents.ts` / `proposalService.ts`).
 *  This module holds only the endpoint path and the wire types (design.md D3)
 *  — no fetch/stream logic here. */
export const AUTHORING_DASHBOARD_ENDPOINT = "/api/authoring/dashboard";

export type { AuthoringGoalRequest, AuthoringResult };
