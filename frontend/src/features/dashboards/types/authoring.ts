import type { DashboardProposal } from "./proposal";
import type { PatchSet } from "../../patchSets/types/patchSet";

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
