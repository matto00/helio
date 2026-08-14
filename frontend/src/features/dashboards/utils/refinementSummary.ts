import type { PatchSet } from "../../patchSets/types/patchSet";

/** The deterministic, human-readable summary an assistant turn's thread entry carries (design.md
 *  D6 precedent, carried over from HEL-397) — NEVER the model's raw JSON output. Mirrors
 *  `RefinementConversationTurns.summaryFor` on the backend byte-for-byte, so a live (just-completed)
 *  turn's thread entry and a reload-rehydrated one (`GET /api/authoring/conversations/:id`'s
 *  `displayTurns`) read identically. Falls back to an edit count when the model didn't (or a repair
 *  round-trip didn't) produce a `summary`. */
export function summarizeRefinementPatchSet(patchSet: PatchSet): string {
  const summary = patchSet.summary?.trim();
  if (summary) return summary;
  const n = patchSet.edits.length;
  return `Proposed ${n} edit${n === 1 ? "" : "s"}`;
}
