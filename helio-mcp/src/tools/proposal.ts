/**
 * Proposal → Review → Apply tools (HEL-223 / HEL-225).
 *
 * - `propose_dashboard` assembles a dashboard proposal and returns it as JSON,
 *   writing NOTHING. It validates the shape and (read-only) checks that each
 *   data panel binds to a real pipeline-output DataType, attaching warnings so
 *   an agent — or a human reviewer — can fix a proposal before applying it.
 *   (Wiring a natural-language → Claude call that authors the proposal is a
 *   deliberate follow-on; this tool is the artifact assembler/validator.)
 * - `apply_proposal` posts an accepted proposal to POST /api/dashboards/
 *   apply-proposal — the same reviewed-artifact write path the in-app Proposal
 *   Review UI uses.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import type { DashboardProposal, ProposalPanel } from "../types.js";

const DATA_PANEL_TYPES = new Set(["metric", "chart", "table"]);
const PANEL_TYPES = ["metric", "chart", "table", "text", "markdown", "image", "divider"] as const;

const layoutSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

const aggFnSchema = z.enum(["count", "sum", "avg", "min", "max"]);

// Viz-level aggregation spec (metric OR chart shape) — matches
// `MetricAggregation`/`ChartAggregation` in schemas/panel.schema.json.
// A single union keeps the zod schema simple; server-side validation is the
// authority on which shape applies to which panel type.
const aggregationSchema = z.union([
  z.object({ value: z.string().min(1), agg: aggFnSchema }),
  z.object({ groupBy: z.string().min(1), agg: aggFnSchema, yField: z.string().min(1) }),
]);

const panelSchema = z.object({
  title: z.string().min(1),
  type: z.enum(PANEL_TYPES),
  dataTypeId: z.string().optional(),
  fieldMapping: z.record(z.string()).optional(),
  aggregation: aggregationSchema.optional(),
  layout: layoutSchema.optional(),
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

export function registerProposalTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "propose_dashboard",
    {
      title: "Propose a dashboard (no writes)",
      description:
        "Assemble a dashboard proposal (name + panels) and return it as JSON WITHOUT writing " +
        "anything. Validates the shape and read-only-checks that each metric/chart/table panel " +
        "binds to a real pipeline-output DataType, returning { proposal, warnings }. Review the " +
        "proposal (in-app or by inspection), then apply it with apply_proposal.",
      inputSchema: {
        dashboardName: z.string().min(1),
        panels: z.array(panelSchema),
      },
    },
    ({ dashboardName, panels }) =>
      guarded(async () => {
        const proposal: DashboardProposal = { dashboardName, panels: panels as ProposalPanel[] };

        // Read-only validation against the workspace: resolve DataTypes once and
        // flag data panels whose binding is missing or not a pipeline output.
        const typesPage = await api.listDataTypes();
        const byId = new Map(typesPage.items.map((t) => [t.id, t]));
        const warnings: string[] = [];

        panels.forEach((panel, i) => {
          const where = `panel ${i + 1} ('${panel.title}')`;
          if (DATA_PANEL_TYPES.has(panel.type)) {
            if (!panel.dataTypeId) {
              warnings.push(`${where}: a ${panel.type} panel needs a dataTypeId`);
              return;
            }
            const dt = byId.get(panel.dataTypeId);
            if (!dt) {
              warnings.push(`${where}: dataTypeId ${panel.dataTypeId} not found in this workspace`);
            } else if ((dt.sourceId ?? null) !== null) {
              warnings.push(
                `${where}: dataType '${dt.name}' is a source companion, not a pipeline output — it cannot be bound`,
              );
            }
          }
        });

        return { proposal, warnings, applyReady: warnings.length === 0 };
      }),
  );

  server.registerTool(
    "apply_proposal",
    {
      title: "Apply a dashboard proposal",
      description:
        "Apply an accepted proposal via POST /api/dashboards/apply-proposal — the server validates " +
        "and creates the dashboard + panels atomically through the existing services (RLS + V41 " +
        "enforced; nothing is created if any panel is invalid). Returns the created dashboard + panels.",
      inputSchema: {
        dashboardName: z.string().min(1),
        panels: z.array(panelSchema),
      },
    },
    ({ dashboardName, panels }) =>
      guarded(() => api.applyProposal({ dashboardName, panels: panels as ProposalPanel[] })),
  );
}
