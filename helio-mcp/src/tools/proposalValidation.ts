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
 */

import type { DataTypeResponse, ProposalPanel } from "../types.js";

/** Panel types whose binding is a `dataTypeId` (flat field, checked here).
 *  Mirrors the backend's `DashboardProposalService.DataPanelKinds`. */
// HEL-904 task 3.10: retargeted to the one panel kind requiring an Output binding.
export const DATA_PANEL_TYPES = new Set(["output"]);

// HEL-904 decision 11: metrics are deleted wholesale by this migration — the
// former HEL-549 `metricId` check (additive to dataTypeId, missing/not-owned/
// deprecated/unsupported-type validation against a fetched metrics catalog)
// is removed outright, not disabled. There is no metric concept left to
// validate against.

/** Read-only validation against an already-fetched workspace snapshot: flags
 *  a data panel whose `dataTypeId` binding is missing or not a pipeline
 *  output. Pure — no I/O; the caller (`propose_dashboard`) owns the
 *  `api.listDataTypes()` fetch and the `Map` construction. */
export function computeProposalWarnings(
  panels: ProposalPanel[],
  dataTypesById: Map<string, DataTypeResponse>,
): string[] {
  const warnings: string[] = [];

  panels.forEach((panel, i) => {
    const where = `panel ${i + 1} ('${panel.title}')`;

    if (DATA_PANEL_TYPES.has(panel.type)) {
      if (!panel.dataTypeId) {
        warnings.push(`${where}: a ${panel.type} panel needs a dataTypeId`);
      } else {
        const dt = dataTypesById.get(panel.dataTypeId);
        if (!dt) {
          warnings.push(`${where}: dataTypeId ${panel.dataTypeId} not found in this workspace`);
        } else if ((dt.sourceId ?? null) !== null) {
          warnings.push(
            `${where}: dataType '${dt.name}' is a source companion, not a pipeline output — it cannot be bound`,
          );
        }
      }
    }
  });

  return warnings;
}
