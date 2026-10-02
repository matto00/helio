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

import type { HelioApi } from "../helioApi.js";
import type {
  DataSourceResponse,
  OutputFilterCapabilitiesResponse,
  OutputResponse,
  ProposalPanel,
} from "../types.js";

/** Panel types whose binding is a `outputId` (flat field, checked here) --
 *  really an Output id, kept under this field name for wire stability
 *  (see `dashboard-proposal.schema.json`'s own field description). Mirrors
 *  the backend's `DashboardProposalService.DataPanelKinds`. */
export const DATA_PANEL_TYPES = new Set(["output"]);

/** HEL-1148: panel types whose binding is a flat `dataSourceId` (a dataset source), the source twin
 *  of `DATA_PANEL_TYPES`. Mirrors the backend's `DashboardProposalService.SourceBoundKinds`
 *  (scripts/check-schema-drift.mjs asserts the two sets are equal). */
export const SOURCE_BOUND_PANEL_TYPES = new Set(["form"]);

/** Read-only validation against an already-fetched workspace snapshot: flags
 *  a data panel whose `outputId` (Output id) binding is missing or does
 *  not resolve to a real, caller-owned Output, and (HEL-1148) a `form` panel whose flat
 *  `dataSourceId` is missing or is not one of the caller's `dataset` sources, plus a
 *  `dataSourceId` on a panel that is not source-bound. Pure -- no I/O; the caller
 *  (`propose_dashboard`) owns the fetches and the `Map` construction. `datasetSourcesById` omitted
 *  skips only the existence check (a missing/misplaced `dataSourceId` is still flagged). */
export function computeProposalWarnings(
  panels: ProposalPanel[],
  outputsById: Map<string, OutputResponse>,
  datasetSourcesById?: Map<string, Pick<DataSourceResponse, "id" | "name" | "type">>,
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

    if (SOURCE_BOUND_PANEL_TYPES.has(panel.type)) {
      if (!panel.dataSourceId) {
        warnings.push(`${where}: a ${panel.type} panel needs a dataSourceId (a dataset source id)`);
      } else if (datasetSourcesById && !datasetSourcesById.has(panel.dataSourceId)) {
        warnings.push(
          `${where}: dataSourceId ${panel.dataSourceId} is not a dataset source in this workspace`,
        );
      }
    } else if (panel.dataSourceId !== undefined) {
      warnings.push(`${where}: dataSourceId is only supported on a form panel`);
    }
  });

  return warnings;
}

/** HEL-1193: propose-time control check. Eligibility is NOT decided here: each declared control
 *  is looked up in the bound Output's own `filter-capabilities` contract (`controlKinds` comes
 *  from the backend's `OutputControlEligibility.kindsFor`, the function the panel write path
 *  validates with), and a miss is reported with the backend's exact message. A panel whose Output
 *  cannot be fetched is skipped: the missing-Output warning above already covers it, and the
 *  backend re-validates at apply regardless. */
export async function computeControlWarnings(
  panels: ProposalPanel[],
  api: Pick<HelioApi, "getOutputFilterCapabilities">,
): Promise<string[]> {
  const contracts = new Map<string, Promise<OutputFilterCapabilitiesResponse | null>>();
  const contractFor = (outputId: string) => {
    if (!contracts.has(outputId)) {
      contracts.set(
        outputId,
        api.getOutputFilterCapabilities(outputId).catch(() => null),
      );
    }
    return contracts.get(outputId)!;
  };

  const warnings: string[] = [];
  for (const [i, panel] of panels.entries()) {
    const raw = panel.controls ?? (panel.config?.controls as ProposalPanel["controls"]);
    if (panel.type !== "output" || !panel.outputId || !Array.isArray(raw) || raw.length === 0) {
      continue;
    }
    const contract = await contractFor(panel.outputId);
    if (!contract) continue;
    for (const control of raw) {
      const column = contract.columns.find((c) => c.column === control.column);
      if (!column?.controlKinds.includes(control.kind)) {
        warnings.push(
          `panel ${i + 1} ('${panel.title}'): control not eligible: column '${control.column}', kind '${control.kind}'`,
        );
      }
    }
  }
  return warnings;
}
