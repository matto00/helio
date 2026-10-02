/**
 * `propose_dashboard`'s call logic (HEL-1148 split it out of `proposal.ts`, mirroring
 * `combinedProposalHandlers.ts`): a plain async function over `HelioApi` that imports neither `zod`
 * nor the MCP server, so a test can drive the real handler (read-only fetches + warning
 * computation) without compiling `proposal.ts`'s `registerTool` calls. `proposal.ts` is the thin
 * zod-schema shell that calls it.
 */

import type { HelioApi } from "../helioApi.js";
import type {
  DashboardProposal,
  DataSourceResponse,
  OutputResponse,
  ProposalPanel,
} from "../types.js";
import { computeControlWarnings, computeProposalWarnings } from "./proposalValidation.js";

/** Fetches every Output the caller owns, across every page (`limit=200` per
 *  page, mirroring `context.ts`'s `fetchAllOutputs` -- duplicated locally
 *  rather than shared/exported, per this codebase's established convention
 *  for a small file-local concern, design.md D10). Bounded to a sane max
 *  page count so a pagination bug elsewhere can never spin this into an
 *  unbounded loop. */
async function fetchAllOutputs(api: HelioApi): Promise<OutputResponse[]> {
  const items: OutputResponse[] = [];
  let offset = 0;
  const limit = 200;
  const maxPages = 50; // 10,000 Outputs — far beyond any real workspace
  for (let page = 0; page < maxPages; page++) {
    const result = await api.listAllOutputs(limit, offset);
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) break;
    offset += limit;
  }
  return items;
}

/** The caller's `dataset` sources, paged like `fetchAllOutputs` (HEL-1148: a `form` panel may only
 *  bind a dataset source). */
async function fetchDatasetSources(api: HelioApi): Promise<DataSourceResponse[]> {
  const items: DataSourceResponse[] = [];
  let offset = 0;
  const limit = 200;
  const maxPages = 50;
  for (let page = 0; page < maxPages; page++) {
    const result = await api.listDataSources(limit, offset);
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) break;
    offset += limit;
  }
  return items.filter((s) => s.type === "dataset");
}

/** Assembles the proposal and read-only-validates it against the workspace (Outputs for
 *  output-kind panels, dataset sources for form panels, eligibility for declared controls),
 *  returning `{ proposal, warnings, applyReady }`. Writes nothing. */
export async function proposeDashboardHandler(
  api: HelioApi,
  dashboardName: string,
  panels: ProposalPanel[],
): Promise<{ proposal: DashboardProposal; warnings: string[]; applyReady: boolean }> {
  const proposal: DashboardProposal = { dashboardName, panels };

  const outputs = await fetchAllOutputs(api);
  const outputsById = new Map(outputs.map((o) => [o.id, o]));
  const needsSources = panels.some((p) => p.type === "form" && p.dataSourceId);
  const datasetSourcesById = needsSources
    ? new Map((await fetchDatasetSources(api)).map((s) => [s.id, s]))
    : undefined;
  const warnings = computeProposalWarnings(panels, outputsById, datasetSourcesById);
  warnings.push(...(await computeControlWarnings(panels, api)));

  return { proposal, warnings, applyReady: warnings.length === 0 };
}
