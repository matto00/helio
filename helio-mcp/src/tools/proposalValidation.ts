/**
 * `propose_dashboard`'s read-only binding-warning computation (`proposal.ts`,
 * HEL-223), split into its own small module for the same reason
 * `metricSchemas.ts` documents for `write.ts` (HEL-541): a unit test can
 * import just this narrow, zod-free surface without pulling `proposal.ts`'s
 * `server.registerTool(...)` calls — combined with `panelSchema`'s full Zod
 * object type — into the compile graph. That combination is TS2589
 * ("Type instantiation is excessively deep and possibly infinite") under
 * this repo's root `tsconfig.json`/ts-jest configuration (probe: importing
 * `proposal.ts` directly from `proposal.test.ts` fails the jest run with
 * TS2589 at both `server.registerTool(...)` call sites) — see
 * `write.test.ts`'s docstring for the sibling case this mirrors.
 *
 * HEL-907 task 1.1/1.3 dashboard half: retargeted onto Outputs. The backend
 * (`DashboardProposalService`/`ProposalPanelSupport`, HEL-904 task 3.8/3.9,
 * already on `main` before this branch existed) has validated an
 * `"output"`-kind panel's `outputId` field as a real Output id (via
 * `OutputRepository.findByIdOwned`) since HEL-904 -- this file was the one
 * piece of the contract left calling `GET /api/types` (deleted outright by
 * HEL-904), a dead route, for its own read-only grounding fetch. There is no
 * "source companion" concept for an Output (unlike a DataType) -- every
 * Output IS the panel-bindable projection by construction, so the only
 * client-side check possible/needed is existence in the caller's own Output
 * set (server-side `findByIdOwned` is still the authority on ownership).
 */

import type { OutputResponse, ProposalPanel } from "../types.js";

/** Panel types whose binding is a `outputId` (flat field, checked here) --
 *  really an Output id, kept under this field name for wire stability
 *  (see `dashboard-proposal.schema.json`'s own field description). Mirrors
 *  the backend's `DashboardProposalService.DataPanelKinds`. */
export const DATA_PANEL_TYPES = new Set(["output"]);

/** Read-only validation against an already-fetched workspace snapshot: flags
 *  a data panel whose `outputId` (Output id) binding is missing or does
 *  not resolve to a real, caller-owned Output. Pure -- no I/O; the caller
 *  (`propose_dashboard`) owns the Output fetch and the `Map` construction. */
export function computeProposalWarnings(
  panels: ProposalPanel[],
  outputsById: Map<string, OutputResponse>,
): string[] {
  const warnings: string[] = [];

  panels.forEach((panel, i) => {
    const where = `panel ${i + 1} ('${panel.title}')`;

    if (DATA_PANEL_TYPES.has(panel.type)) {
      if (!panel.outputId) {
        warnings.push(`${where}: a ${panel.type} panel needs a outputId`);
      } else if (!outputsById.has(panel.outputId)) {
        warnings.push(`${where}: output ${panel.outputId} not found in this workspace`);
      }
    }
  });

  return warnings;
}
