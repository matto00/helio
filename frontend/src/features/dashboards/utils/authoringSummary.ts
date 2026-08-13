import type { DashboardProposal } from "../types/proposal";

/** The deterministic, human-readable summary an assistant turn's thread entry
 *  carries (HEL-397 design.md D6) — NEVER the model's raw JSON output.
 *  Mirrors `AuthoringConversationTurns.summaryFor` on the backend byte-for-
 *  byte, so a live (just-completed) turn's thread entry and a reload-
 *  rehydrated one (`GET /api/authoring/conversations/:id`'s `displayTurns`)
 *  read identically. */
export function summarizeAuthoringProposal(proposal: DashboardProposal): string {
  return `Proposed "${proposal.dashboardName}" (${proposal.panels.length} panel(s))`;
}
