/**
 * `apply_combined_proposal`'s actual call-routing logic (HEL-387, mirrors
 * `pipelineProposalHandlers.ts`'s HEL-385 D4b split). This file imports
 * NEITHER `zod` NOR `@modelcontextprotocol/sdk`'s `McpServer` — the export
 * below is a plain async function taking `api: HelioApi` plus a plain
 * TS-typed argument, so a test can import this module directly and exercise
 * the real `api.applyCombinedProposal` call-routing + `HelioApiError`
 * propagation without pulling `combinedProposal.ts`'s
 * `server.registerTool(...)` call — combined with a large zod object type —
 * into the compile graph (see `pipelineProposalHandlers.ts`'s docstring for
 * the TS2589 reasoning this mirrors).
 *
 * `combinedProposal.ts` itself is a thin shell: a zod `inputSchema`
 * declaration + `guarded(() => applyCombinedProposalHandler(api, ...))`,
 * with no business logic of its own — everything below is that logic.
 */

import type { HelioApi } from "../helioApi.js";
import type { CombinedProposal, CombinedProposalApplyResponse } from "../types.js";

/** `apply_combined_proposal`'s handler: applies atomically via
 *  `POST /api/proposals/apply` — no client-side pre-validation, no retry.
 *  Every guardrail (the pipeline's own, the dashboard's own, and the
 *  sentinel-position structural check) is enforced server-side only, per
 *  design.md D7; a rejection propagates as a rejected promise (a
 *  `HelioApiError`), formatted verbatim by the tool shell's `guarded`
 *  handler. */
export function applyCombinedProposalHandler(
  api: HelioApi,
  combined: CombinedProposal,
): Promise<CombinedProposalApplyResponse> {
  return api.applyCombinedProposal(combined);
}
