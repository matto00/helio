import type { DashboardProposal } from "./proposal";
import type { PatchSet } from "../../patchSets/types/patchSet";

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

/** Mirrors `com.helio.services.AuthoringErrorKind` (HEL-401 design.md D1) — distinguishes WHY an
 *  authoring call failed so the chat surface can branch on a real value instead of string-matching
 *  a message. `ModelFailure`: the upstream Claude API/transport failed. `InvalidProposal`: a
 *  repair-exhausted, still-invalid proposal. `EmptyWorkspace`: no pipeline-output DataTypes to
 *  ground against. `BudgetExceeded`: a token/cost guardrail was exceeded. */
export type AuthoringErrorKind =
  | "ModelFailure"
  | "InvalidProposal"
  | "EmptyWorkspace"
  | "BudgetExceeded";

/** Terminal authoring outcome — mirrors `DashboardAuthoringProtocol.scala`'s
 *  `DashboardAuthoringResponse` (buffered call) and `AuthoringStreamEvent.Result`
 *  (the streamed `authoring-result` SSE event, same shape). `warnings` is
 *  exposed on `useDashboardAuthoringStream`'s state but not rendered anywhere
 *  yet — an explicit Non-Goal of design.md, not an oversight. `conversationId`
 *  (HEL-397) is passed back as the next turn's `AuthoringGoalRequest.conversationId`.
 *  `authoringRequestId` (HEL-401 design.md D4) is a fresh id minted per successful call —
 *  forwarded to Proposal Review so a later accept/reject can correlate back to this outcome. */
export interface AuthoringResult {
  proposal: DashboardProposal;
  warnings: string[];
  conversationId: string;
  authoringRequestId: string;
}

/** `{outcome}` accepted by `POST /api/authoring/requests/:id/outcome` (HEL-401 design.md D4) — the
 *  telemetry-only correlation signal Proposal Review's Accept/Reject actions fire. */
export type AuthoringOutcome = "accepted" | "rejected";

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
 *  design.md D7, generalized by HEL-411 design.md D3/D4 to also carry a refinement
 *  conversation's `latestPatchSet`). The server-internal `apiHistory` never crosses this
 *  boundary. Exactly one of `latestProposal`/`latestPatchSet` is ever populated for a real
 *  conversation id — an authoring drawer reads `latestProposal`, a refinement drawer reads
 *  `latestPatchSet`; each ignores the other. */
export interface AuthoringConversationView {
  conversationId: string;
  displayTurns: AuthoringDisplayTurn[];
  latestProposal?: DashboardProposal;
  latestPatchSet?: PatchSet;
}
