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
import type { ProposalPanel } from "../types.js";
import { proposalControlSchema } from "./controlSchemas.js";
import { proposeDashboardHandler } from "./proposalHandlers.js";

// No `divider`: excluded for a stated product-scope reason (purely presentational layout chrome),
// mirroring create_panel (scripts/lib/agentFacingPanelTypes.mjs holds the reasoned exclusion table
// check:schemas enforces). No `metric`/`chart`/`table`/`collection`/`timeline` either — those panel
// kinds were deleted outright by HEL-904. `form` (HEL-1083) is here because this wire can express its
// required binding, the flat `dataSourceId` (HEL-1148).
// Exported so `replace_dashboard_contents` (write.ts, HEL-363) can reuse the
// exact same agent-facing panel-type set instead of redefining it.
export const PANEL_TYPES = ["text", "markdown", "image", "output", "form"] as const;

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
  // HEL-1148: a `form` panel's dataset-source binding (the source twin of `outputId`).
  dataSourceId: z.string().optional(),
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
  // HEL-1193: output panels only. Same shape/validation as add_output_control's controls.
  controls: z.array(proposalControlSchema).optional(),
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

/** Shared by every tool that takes proposal panels. The 400 wording was observed live against the
 *  running backend (HEL-1193 evidence), not copied from a spec. */
export const CONTROLS_COPY =
  "An output panel may declare `controls: [{ kind: date-range|dropdown|numeric-range|text, " +
  "column, label?, id? }]` (top-level `controls`, not inside `config`; do not also set " +
  "`config.controls`): `id` is minted when absent, `label` defaults to the column, and a " +
  "control is eligible only for kinds its column lists in `controlKinds` (get_output_filter_" +
  "capabilities). At apply an ineligible control fails the WHOLE call with HTTP 400 " +
  "`panel '<title>': control not eligible: column '<c>', kind '<k>'` and nothing is created; " +
  "`controls` on a non-output panel is HTTP 400 too. With apply_combined_proposal, a panel " +
  'bound to the "$pipelineOutput" sentinel is validated only once the pipeline exists, so its ' +
  "ineligible control fails at apply time and the pipeline is rolled back.";

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
        "`type` ∈ text/markdown/image/output/form (there is no `divider`: dropped for agent/UI parity, " +
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
        "• form — bind with the top-level `dataSourceId` set to the id of a caller-owned DATASET " +
        "source (obtained from list_data_sources / get_workspace_context, `type: dataset`); put the " +
        "form's `fields`/`submit` in `config`. NEVER put the binding in `config.dataSourceId` — " +
        "only the top-level field counts. A form with no `dataSourceId`, a non-dataset or " +
        "another tenant's source, a field the dataset does not declare, or an `outputId` as well " +
        "is rejected (HTTP 400, nothing created); `dataSourceId` on any other panel type is " +
        "rejected too. propose_dashboard reports each of these as a warning (applyReady false).\n" +
        "• text/markdown — `content` (literal/static text) seeds the initial body. There is no " +
        'data-bound "Source mode" anymore — a `config.outputId`/`outputId` on a text/markdown ' +
        "panel is silently inert, never a real binding.\n" +
        "• image — `url` seeds the initial imageUrl (imageFit defaults to contain; use " +
        "config.imageFit to override).\n" +
        "An output panel's `outputId` (and a form panel's `dataSourceId`) always stays " +
        "authoritative over anything `config` supplies.\n" +
        CONTROLS_COPY +
        " propose_dashboard checks each declared control against the bound Output's " +
        "get_output_filter_capabilities `controlKinds` and reports a violation as a warning " +
        "`control not eligible: column '<c>', kind '<k>'` (applyReady false) — the same wording " +
        "the backend's HTTP 400 uses at apply.",
      inputSchema: {
        dashboardName: z.string().min(1),
        panels: z.array(panelSchema),
      },
    },
    ({ dashboardName, panels }) =>
      guarded(() => proposeDashboardHandler(api, dashboardName, panels as ProposalPanel[])),
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
        "created if any panel is invalid; a form panel's FLAT `dataSourceId` must be a caller-owned " +
        "dataset source, never `config.dataSourceId`). Each panel's `config` (if any) is merged " +
        "over the config derived from its flat fields and decoded by the same panel-create path " +
        "place_outputs/create_content_panel uses. " +
        CONTROLS_COPY +
        " Returns the created dashboard + panels.",
      inputSchema: {
        dashboardName: z.string().min(1),
        panels: z.array(panelSchema),
      },
    },
    ({ dashboardName, panels }) =>
      guarded(() => api.applyProposal({ dashboardName, panels: panels as ProposalPanel[] })),
  );
}
