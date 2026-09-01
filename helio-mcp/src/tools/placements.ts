/**
 * `place_outputs`/`create_content_panel` (HEL-907 task 3.6) — replace
 * `create_panel`/`create_panels`/`bind_panel`/`create_bound_panel`. This
 * file is a thin shell (mirrors `pipelineProposal.ts`'s design.md D4b
 * split): zod `inputSchema` declarations + `guarded(() =>
 * xHandler(api, ...))` one-liners, with no business logic of its own —
 * `placementsHandlers.ts` holds that.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import { createContentPanelHandler, placeOutputsHandler } from "./placementsHandlers.js";

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

export function registerPlacementTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "place_outputs",
    {
      title: "Place one or more Outputs onto a dashboard",
      description:
        "Create a placement panel for each of one or more Outputs on ONE dashboard, in a single " +
        "all-or-nothing call (POST /api/panels/batch) — replaces create_panel/create_panels/" +
        "bind_panel/create_bound_panel for the data-bound case. Each item's `outputId` MUST be a " +
        "real, existing Output id (create it first with create_pipeline's outputs[], add_output, " +
        "or add_outputs_from_shape) — a placement carries ONLY `config.outputId`; there is no " +
        "fieldMapping/aggregation/chartType on a panel anymore, that all lives on the Output " +
        "itself (update_output to change it). Optional per-item `w`/`h` (12-column grid units) " +
        "position that item via a follow-up auto_layout_dashboard call — omit both on an item to " +
        "leave it at its auto/default position; if only one of w/h is given the other defaults to " +
        "4. Returns every created panel, with ids, in the same order supplied.",
      inputSchema: {
        dashboardId: z.string().min(1),
        items: z
          .array(
            z.object({
              outputId: z.string().min(1),
              title: z.string().optional(),
              w: z.number().int().positive().optional(),
              h: z.number().int().positive().optional(),
            }),
          )
          .min(1),
      },
    },
    ({ dashboardId, items }) => guarded(() => placeOutputsHandler(api, { dashboardId, items })),
  );

  server.registerTool(
    "create_content_panel",
    {
      title: "Create a content panel (text/markdown/image/divider)",
      description:
        "Create ONE panel with no data binding — text/markdown/image/divider only (use " +
        "place_outputs for a data-bound panel instead). config by type:\n" +
        "• text/markdown — `content` (literal/static text). In markdown `content`, reference an " +
        "uploaded image with the `helio://uploads/image/<id>` scheme (get <id> from upload_image).\n" +
        "• image — `imageUrl` (use an uploaded image's served `url`, or its " +
        "`helio://uploads/image/<id>` ref), optional `imageFit` (contain|cover|fill), and optional " +
        "`caption` (static string) rendered as a strip beneath the image; omit it for no caption.\n" +
        "• divider — optional `orientation` (horizontal|vertical, default horizontal), `weight`, " +
        "`color`.\n" +
        "`appearance` is an optional passthrough (same shape as update_panel_appearance) — " +
        "background/color/transparency; its `chart` sub-object has no meaningful effect on a " +
        "content panel (there is no chart-shaped kind to decorate here). Returns the created " +
        "panel.",
      inputSchema: {
        dashboardId: z.string().min(1),
        title: z.string().optional(),
        type: z.enum(["text", "markdown", "image", "divider"]),
        config: z.record(z.string(), z.unknown()).optional(),
        appearance: z.record(z.string(), z.unknown()).optional(),
      },
    },
    ({ dashboardId, title, type, config, appearance }) =>
      guarded(() =>
        createContentPanelHandler(api, { dashboardId, title, type, config, appearance }),
      ),
  );
}
