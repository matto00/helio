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

const DATA_PANEL_TYPES = new Set(["metric", "chart", "table", "collection", "timeline"]);
// No `divider`: dropped from the proposal flow's type set for parity with
// create_panel (HEL-249/HEL-315/HEL-316) — the backend wire still accepts it
// on other paths, this tool just no longer offers it.
const PANEL_TYPES = [
  "metric",
  "chart",
  "table",
  "text",
  "markdown",
  "image",
  "collection",
  "timeline",
] as const;

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

const chartTypeSchema = z.enum(["bar", "line", "pie", "scatter"]);
const dividerOrientationSchema = z.enum(["horizontal", "vertical"]);

const panelSchema = z.object({
  title: z.string().min(1),
  type: z.enum(PANEL_TYPES),
  dataTypeId: z.string().optional(),
  fieldMapping: z.record(z.string()).optional(),
  aggregation: aggregationSchema.optional(),
  // Initial config for non-data panels, applied at create time (HEL-293).
  content: z.string().optional(),
  url: z.string().optional(),
  orientation: dividerOrientationSchema.optional(),
  // Chart appearance, applied as a best-effort follow-up update (HEL-293).
  chartType: chartTypeSchema.optional(),
  xAxisLabel: z.string().optional(),
  yAxisLabel: z.string().optional(),
  seriesColors: z.array(z.string()).optional(),
  // Metric literal label/unit override — distinct from fieldMapping.label/
  // fieldMapping.unit, which bind to a data column (HEL-293).
  label: z.string().optional(),
  unit: z.string().optional(),
  layout: layoutSchema.optional(),
  // Generic passthrough merged over the config derived from the flat fields
  // above, then decoded by the same panel-create path as create_panel's
  // `config` (HEL-316) — see the propose_dashboard/apply_proposal
  // descriptions below for the per-type v1.5 shapes this unlocks.
  config: z.record(z.unknown()).optional(),
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
        "anything. Validates the shape and read-only-checks that each " +
        "metric/chart/table/collection/timeline panel binds to a real pipeline-output DataType, " +
        "returning { proposal, warnings }. Review the proposal (in-app or by inspection), then " +
        "apply it with apply_proposal.\n" +
        "`type` ∈ metric/chart/table/text/markdown/image/collection/timeline (there is no " +
        "`divider`: dropped for agent/UI parity, mirroring create_panel — the backend wire still " +
        "accepts it on other paths). Each panel accepts a generic `config` passthrough on top of " +
        "the flat fields below, merged over the config those fields derive and decoded by the same " +
        "panel-create path create_panel uses — use it for any v1.5 surface with no flat field:\n" +
        "• metric — bind with dataTypeId/fieldMapping; literal `label`/`unit` overrides " +
        "optional.\n" +
        "• chart — bind with dataTypeId/fieldMapping; config.chartOptions keyed by chart " +
        "type (line {smooth,showPoints,areaFill}; bar {orientation:vertical|horizontal, " +
        "stacking:none|stacked|normalized, barGapPct:0-100}; pie {donutHolePct:0-90, " +
        "showPercentLabels}; scatter {sizeField,colorField}). Set the chart's TYPE via the " +
        "top-level `chartType` field (applied as a best-effort follow-up appearance update), not " +
        "config.\n" +
        "• table — bind with dataTypeId/fieldMapping; config.density " +
        "(condensed|normal|spacious) and config.columnOrder (string[] of visible column keys, in " +
        "order).\n" +
        "• collection — bind with dataTypeId/fieldMapping (base-type slots, e.g. baseType " +
        "metric → {value,label?,unit?}); config.baseType (metric) and config.layout " +
        "(grid|list). One bound row = one rendered item.\n" +
        "• timeline — bind with dataTypeId/fieldMapping ({time, event} slots — time is a " +
        "timestamp/order column, event is the text description); config.timelineOptions.sort " +
        "(asc|desc, default asc) sets chronological order. One bound row = one rendered event.\n" +
        "• text/markdown — `content` (literal/static text) seeds the initial body; optionally bind " +
        "to a pipeline-output DataType via config.dataTypeId/config.fieldMapping (Source mode — " +
        "the DataType column named by fieldMapping.content fills the body instead of the literal " +
        "`content`).\n" +
        "• image — `url` seeds the initial imageUrl (imageFit defaults to contain; use " +
        "config.imageFit to override).\n" +
        "A metric/chart/table/collection/timeline panel's dataTypeId always stays authoritative " +
        "over anything `config` supplies. A text/markdown panel's config.dataTypeId IS a real " +
        "binding attempt and is validated against the same pipeline-only rule (V41) as any other " +
        "binding — a source-companion or non-owned DataType 400s; a valid pipeline-output DataType " +
        "succeeds.",
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
        "enforced for every panel's binding, flat OR via config; nothing is created if any panel is " +
        "invalid). Each panel's `config` (if any) is merged over the config derived from its flat " +
        "fields and decoded by the same panel-create path create_panel uses (see " +
        "propose_dashboard's description for the per-type v1.5 config shapes, including " +
        "text/markdown's config.dataTypeId binding). Returns the created dashboard + panels.",
      inputSchema: {
        dashboardName: z.string().min(1),
        panels: z.array(panelSchema),
      },
    },
    ({ dashboardName, panels }) =>
      guarded(() => api.applyProposal({ dashboardName, panels: panels as ProposalPanel[] })),
  );
}
