/**
 * Output-panel control tools (HEL-1193): `get_output_filter_capabilities`, `add_output_control`,
 * `update_output_control`, `remove_output_control`. Thin shell over `outputControlsHandlers.ts`
 * (zod declarations + one-liners), mirroring `outputs.ts`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import { CONTROL_ERROR_COPY, controlKindSchema } from "./controlSchemas.js";
import {
  addOutputControlHandler,
  getOutputFilterCapabilitiesHandler,
  removeOutputControlHandler,
  updateOutputControlHandler,
} from "./outputControlsHandlers.js";

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

const panelTarget = {
  dashboardId: z.string().min(1),
  panelId: z.string().min(1),
};

const CONTROL_TARGET_COPY =
  "`dashboardId` + `panelId` identify an OUTPUT panel (get_output_panels lists both for an " +
  "Output). The tool reads the panel's current controls from the dashboard export, changes the " +
  "list and PATCHes the whole `config.controls` back (the backend replaces it wholesale), so two " +
  "concurrent writers are last-write-wins, same as update_panel. A panel that is not on that " +
  "dashboard, or is not an output panel, is refused by the tool itself before any write (no HTTP " +
  "status; the backend would otherwise silently ignore controls on a non-output panel). An " +
  "unknown dashboard is HTTP 404 `Dashboard not found`. ";

export function registerOutputControlTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "get_output_filter_capabilities",
    {
      title: "Get an Output's filter operators and eligible control kinds",
      description:
        "Read GET /api/outputs/:id/filter-capabilities for an Output: one entry per filterable " +
        "column with `operators` (what row filters the column accepts) and `controlKinds` (which " +
        "of date-range/dropdown/numeric-range/text an output-panel control on that column may " +
        "use — the same function the backend validates control writes with). Columns appear in " +
        "the Output's schema order. NOT get_output_capabilities: that one takes a pipeline id " +
        "and returns the pipeline node's field-mapping binding menu for add_output; this one takes " +
        "an OUTPUT id and answers what filters/controls that Output supports. An unknown or " +
        "not-owned Output is HTTP 404 `Output not found`.",
      inputSchema: { outputId: z.string().min(1) },
    },
    ({ outputId }) => guarded(() => getOutputFilterCapabilitiesHandler(api, outputId)),
  );

  server.registerTool(
    "add_output_control",
    {
      title: "Add a control to an output panel",
      description:
        "Add one control (date-range/dropdown/numeric-range/text) to an output panel so a human " +
        "viewer sees it in the panel's control bar. The tool mints the control id. Omit `column` " +
        "to auto-bind the FIRST column, in the Output's schema order, whose `controlKinds` " +
        "includes `kind` (for date-range that is the first timestamp column); if none qualifies " +
        "the tool refuses without writing and lists the eligible kinds per column. A supplied " +
        "`column` is sent as-is and the backend decides. `label` defaults to the column name. " +
        CONTROL_TARGET_COPY +
        CONTROL_ERROR_COPY +
        " Returns the updated panel.",
      inputSchema: {
        ...panelTarget,
        kind: controlKindSchema,
        column: z.string().min(1).optional(),
        label: z.string().min(1).optional(),
        defaultValue: z.unknown().optional(),
      },
    },
    (input) => guarded(() => addOutputControlHandler(api, input)),
  );

  server.registerTool(
    "update_output_control",
    {
      title: "Update a control on an output panel",
      description:
        "Change an existing control's `kind`, `column`, `label` and/or `defaultValue` " +
        "(`defaultValue: null` clears it; omitted fields are unchanged). `controlId` comes from " +
        "get_workspace_context's placement `controls` or the panel's config. An unknown " +
        "`controlId` is refused by the tool with the ids that exist (no write). Changing `column` " +
        "or `kind` is re-validated by the backend; a label-only edit never is. " +
        CONTROL_TARGET_COPY +
        CONTROL_ERROR_COPY +
        " Returns the updated panel.",
      inputSchema: {
        ...panelTarget,
        controlId: z.string().min(1),
        kind: controlKindSchema.optional(),
        column: z.string().min(1).optional(),
        label: z.string().min(1).optional(),
        defaultValue: z.unknown().optional(),
      },
    },
    (input) => guarded(() => updateOutputControlHandler(api, input)),
  );

  server.registerTool(
    "remove_output_control",
    {
      title: "Remove a control from an output panel",
      description:
        "Remove one control by id from an output panel. An unknown `controlId` is refused by " +
        "the tool with the ids that exist (no write). " +
        CONTROL_TARGET_COPY +
        "Returns the updated panel.",
      inputSchema: { ...panelTarget, controlId: z.string().min(1) },
    },
    (input) => guarded(() => removeOutputControlHandler(api, input)),
  );
}
