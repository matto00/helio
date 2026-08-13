import type { DashboardProposal } from "./proposal";

/** `POST /api/authoring/dashboard` request body (HEL-392, extended by HEL-397).
 *  `contextOptions` (budget tuning) is intentionally omitted — not exposed in
 *  the chat surface UI (design.md Non-Goals). `conversationId` (HEL-397
 *  design.md D1) is omitted for a fresh turn 1 and set to the prior turn's
 *  returned id to continue refining the same proposal — the server owns
 *  history/the working proposal entirely; this client never re-sends either. */
export interface AuthoringGoalRequest {
  goal: string;
  conversationId?: string;
}

/** Terminal authoring outcome — mirrors `DashboardAuthoringProtocol.scala`'s
 *  `DashboardAuthoringResponse` (buffered call) and `AuthoringStreamEvent.Result`
 *  (the streamed `authoring-result` SSE event, same shape). `warnings` is
 *  exposed on `useDashboardAuthoringStream`'s state but not rendered anywhere
 *  yet — an explicit Non-Goal of design.md, not an oversight. `conversationId`
 *  (HEL-397) is passed back as the next turn's `AuthoringGoalRequest.conversationId`. */
export interface AuthoringResult {
  proposal: DashboardProposal;
  warnings: string[];
  conversationId: string;
}

/** One human-readable turn in the visible thread — mirrors
 *  `AuthoringConversationProtocol.scala`'s `AuthoringDisplayTurn` (HEL-397
 *  design.md D6). A user turn's `text` is the typed text verbatim; an
 *  assistant turn's `text` is a deterministic `"Proposed \"<name>\"
 *  (<n> panel(s))"` summary — never raw model JSON. */
export interface AuthoringDisplayTurn {
  role: "user" | "assistant";
  text: string;
}

/** `GET /api/authoring/conversations/:id` response — mirrors
 *  `AuthoringConversationProtocol.scala`'s `AuthoringConversationView` (HEL-397
 *  design.md D7). The server-internal `apiHistory` never crosses this
 *  boundary. */
export interface AuthoringConversationView {
  conversationId: string;
  displayTurns: AuthoringDisplayTurn[];
  latestProposal?: DashboardProposal;
}
