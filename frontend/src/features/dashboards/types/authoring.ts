import type { DashboardProposal } from "./proposal";

/** `POST /api/authoring/dashboard` request body (HEL-392). `contextOptions`
 *  (budget tuning) is intentionally omitted — not exposed in the chat
 *  surface UI (design.md Non-Goals). */
export interface AuthoringGoalRequest {
  goal: string;
}

/** Terminal authoring outcome — mirrors `DashboardAuthoringProtocol.scala`'s
 *  `DashboardAuthoringResponse` (buffered call) and `AuthoringStreamEvent.Result`
 *  (the streamed `authoring-result` SSE event, same shape). `warnings` is
 *  exposed on `useDashboardAuthoringStream`'s state but not rendered anywhere
 *  yet — an explicit Non-Goal of design.md, not an oversight. */
export interface AuthoringResult {
  proposal: DashboardProposal;
  warnings: string[];
}
