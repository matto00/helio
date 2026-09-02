/**
 * Proposal → Review → Apply tools (HEL-223 / HEL-225).
 *
 * - `propose_dashboard` assembles a dashboard proposal and returns it as JSON,
 *   writing NOTHING. It validates the shape and (read-only) checks that each
 *   `output`-kind panel binds to a real, caller-owned Output, attaching
 *   warnings so an agent — or a human reviewer — can fix a proposal before
 *   applying it. (Wiring a natural-language → Claude call that authors the
 *   proposal is a deliberate follow-on; this tool is the artifact
 *   assembler/validator.)
 * - `apply_proposal` posts an accepted proposal to POST /api/dashboards/
 *   apply-proposal — the same reviewed-artifact write path the in-app Proposal
 *   Review UI uses.
 *
 * HEL-907 task 1.1/1.3 dashboard half: retargeted onto Outputs. The
 * backend contract (`dashboard-proposal.schema.json`, `DashboardProposalService`/
 * `ProposalPanelSupport`) was already retargeted by HEL-904 (task 3.8-3.10,
 * already on `main` before this branch existed) -- `metric`/`chart`/`table`/
 * `collection`/`timeline` panel kinds no longer exist; `"output"` is the ONLY
 * kind with a real data binding, and `outputId` (kept under that name for
 * wire stability) now holds an Output id. This file was the one piece of the
 * contract still calling `GET /api/types` (deleted outright by HEL-904) for
 * its own grounding fetch -- a dead route, so every `propose_dashboard` call
 * has been silently degrading its own binding-warning check (or outright
 * failing) since HEL-904 landed. Fixed here by fetching Outputs instead.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import type { DashboardProposal, OutputResponse, ProposalPanel } from "../types.js";
import { computeProposalWarnings } from "./proposalValidation.js";

// No `divider`: dropped from the proposal flow's type set for parity with
// create_panel (HEL-249/HEL-315/HEL-316) — the backend wire still accepts it
// on other paths, this tool just no longer offers it. No `metric`/`chart`/
// `table`/`collection`/`timeline` either — those panel kinds were deleted
// outright by HEL-904; `dashboard-proposal.schema.json`'s enum is
// text/markdown/image/output only.
// Exported so `replace_dashboard_contents` (write.ts, HEL-363) can reuse the
// exact same agent-facing panel-type set instead of redefining it.
export const PANEL_TYPES = ["text", "markdown", "image", "output"] as const;

const layoutSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

// Exported so `replace_dashboard_contents` (write.ts, HEL-363) can validate
// its `panels` array with the exact same shape `propose_dashboard`/
// `apply_proposal` use — the backend's `ProposalPanel` wire shape is shared
// verbatim across all three (design.md D2). `aggregation`/
// `chartType`/`xAxisLabel`/`yAxisLabel`/`seriesColors`/`label`/`unit`/`sort`
// are kept on the wire shape for schema stability (dashboard-proposal.schema.json's
// own field descriptions: "legacy field, decoded but never applied") but are
// deliberately NOT part of this tool's description below, since none of
// them do anything anymore.
export const panelSchema = z.object({
  title: z.string().min(1),
  type: z.enum(PANEL_TYPES),
  outputId: z.string().optional(),
  fieldMapping: z.record(z.string(), z.string()).optional(),
  aggregation: z.record(z.string(), z.unknown()).optional(),
  // Initial config for non-data panels, applied at create time.
  content: z.string().optional(),
  url: z.string().optional(),
  orientation: z.enum(["horizontal", "vertical"]).optional(),
  chartType: z.enum(["bar", "line", "pie", "scatter"]).optional(),
  xAxisLabel: z.string().optional(),
  yAxisLabel: z.string().optional(),
  seriesColors: z.array(z.string()).optional(),
  label: z.string().optional(),
  unit: z.string().optional(),
  sort: z.enum(["asc", "desc"]).optional(),
  layout: layoutSchema.optional(),
  // Generic passthrough merged over the config derived from the flat fields
  // above, then decoded by the same panel-create path as create_panel's
  // `config`.
  config: z.record(z.string(), z.unknown()).optional(),
});

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

async function guarded(produce: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await produce());
  } catch (err) {
    const message =
      err instanceof HelioApiError
        ? `${err.name} (status ${err.status}) for ${err.url}: ${err.message}`
        : `${(err as Error)?.name ?? "Error"}: ${(err as Error)?.message ?? String(err)}`;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

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

export function registerProposalTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "propose_dashboard",
    {
      title: "Propose a dashboard (no writes)",
      description:
        "Assemble a dashboard proposal (name + panels) and return it as JSON WITHOUT writing " +
        "anything. Validates the shape and read-only-checks that each `output`-kind panel binds " +
        "to a real, caller-owned Output, returning { proposal, warnings }. Review the proposal " +
        "(in-app or by inspection), then apply it with apply_proposal.\n" +
        "`type` ∈ text/markdown/image/output (there is no `divider`: dropped for agent/UI parity, " +
        "mirroring create_content_panel/place_outputs — the backend wire still accepts it on other " +
        "paths; there is no " +
        "metric/chart/table/collection/timeline either — those panel kinds were retired). Each " +
        "panel accepts a generic `config` passthrough on top of the flat fields below, merged over " +
        "the config those fields derive and decoded by the same panel-create path " +
        "place_outputs/create_content_panel uses:\n" +
        "• output — bind with `outputId` set to a real Output id (obtained from " +
        "get_workspace_context's pipelines[].outputs[] or list_outputs) — despite the field name, " +
        "this is an Output id, kept under that name for wire stability. `fieldMapping` is NOT " +
        "meaningful for an output panel (an Output's own `schema` is already the grounding " +
        "source) — do not set it.\n" +
        "• text/markdown — `content` (literal/static text) seeds the initial body. There is no " +
        'data-bound "Source mode" anymore — a `config.outputId`/`outputId` on a text/markdown ' +
        "panel is silently inert, never a real binding.\n" +
        "• image — `url` seeds the initial imageUrl (imageFit defaults to contain; use " +
        "config.imageFit to override).\n" +
        "An output panel's `outputId` always stays authoritative over anything `config` " +
        "supplies.",
      inputSchema: {
        dashboardName: z.string().min(1),
        panels: z.array(panelSchema),
      },
    },
    ({ dashboardName, panels }) =>
      guarded(async () => {
        const typedPanels = panels as ProposalPanel[];
        const proposal: DashboardProposal = { dashboardName, panels: typedPanels };

        // Read-only validation against the workspace: resolve the caller's
        // Outputs once and flag panels whose binding is missing/invalid.
        // Extracted to `proposalValidation.ts` (HEL-223) — see that module's
        // docstring for why.
        const outputs = await fetchAllOutputs(api);
        const byId = new Map(outputs.map((o) => [o.id, o]));
        const warnings = computeProposalWarnings(typedPanels, byId);

        return { proposal, warnings, applyReady: warnings.length === 0 };
      }),
  );

  server.registerTool(
    "apply_proposal",
    {
      title: "Apply a dashboard proposal",
      description:
        "Apply an accepted proposal via POST /api/dashboards/apply-proposal — the server validates " +
        "and creates the dashboard + panels atomically through the existing services (an output " +
        "panel's FLAT `outputId` -- never `config.outputId`, which is not consulted for " +
        "binding on ANY panel kind -- must resolve to a real, caller-owned Output; nothing is " +
        "created if any panel is invalid). Each panel's `config` (if any) is merged " +
        "over the config derived from its flat fields and decoded by the same panel-create path " +
        "place_outputs/create_content_panel uses. Returns the created dashboard + panels.",
      inputSchema: {
        dashboardName: z.string().min(1),
        panels: z.array(panelSchema),
      },
    },
    ({ dashboardName, panels }) =>
      guarded(() => api.applyProposal({ dashboardName, panels: panels as ProposalPanel[] })),
  );
}
