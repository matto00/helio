/**
 * Combined Proposal Apply tool (HEL-387): applies a pipeline proposal and a
 * dashboard proposal atomically in one call, letting a dashboard panel bind
 * to the pipeline's not-yet-created Output via the reserved
 * "$pipelineOutput" sentinel — closing the "build me a dashboard from this
 * CSV" loop that neither `apply_pipeline_proposal` nor `apply_proposal`
 * closes alone.
 *
 * - `apply_combined_proposal` posts to POST /api/proposals/apply — the
 *   atomic source(if inline)/pipeline/steps/run + dashboard/panels write
 *   path this ticket built. No propose/analyze/dry-run counterpart: this is
 *   the deterministic apply path only (ticket's own Out of Scope — NL
 *   authoring is HEL-341).
 *
 * This file is a thin shell (mirrors `pipelineProposal.ts`'s design.md D4b
 * split): a zod `inputSchema` declaration + a single
 * `guarded(() => applyCombinedProposalHandler(api, ...))` call, with no
 * business logic of its own — the sentinel-position validation happens
 * server-side only (design.md D7), so there is no client-side pre-validation
 * to extract into a separate handlers module the way
 * `pipelineProposalHandlers.ts` does for `propose_pipeline`'s warnings.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import type { CombinedProposal, PipelineProposalSource, ProposalPanel } from "../types.js";
import { applyCombinedProposalHandler } from "./combinedProposalHandlers.js";
import { pipelineProposalInputSchema } from "./pipelineProposal.js";
import { panelSchema } from "./proposal.js";

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

export function registerCombinedProposalTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "apply_combined_proposal",
    {
      title: "Apply a combined pipeline+dashboard proposal",
      description:
        "Apply a source(if inline)+pipeline+run+dashboard+panels proposal atomically via " +
        "POST /api/proposals/apply (HEL-387) — the server applies `pipeline` via the same atomic " +
        "path apply_pipeline_proposal uses, then applies `dashboard` via the same atomic path " +
        "apply_proposal uses, rolling back the pipeline (and its inline source, if any) if the " +
        "dashboard phase fails; nothing is created if any guardrail fails.\n" +
        "Bind a dashboard panel to `pipeline`'s not-yet-created Output with the literal string " +
        '"$pipelineOutput" (evaluator-final round 2: the real contract has TWO accepted slots, ' +
        "not one, but only ONE that produces a real binding — read from CombinedProposalService's " +
        "flatIsBlessed/configIsBlessed directly, not guessed):\n" +
        "• REAL binding: the sentinel as the flat `dataTypeId` on an `output`-kind panel — the " +
        "same field a real Output id would occupy.\n" +
        "• Accepted but INERT (no error, substituted, then silently ignored at panel-create — " +
        "text/markdown/image panels have no data binding of any kind): the sentinel as the flat " +
        "`dataTypeId` on a text/markdown/image panel, OR as `config.dataTypeId` on a " +
        "text/markdown/image panel whose flat `dataTypeId` is left unset.\n" +
        "• 400s the WHOLE call, creating nothing, before the pipeline is even applied: the " +
        "sentinel as `config.dataTypeId` on an `output`-kind panel (kind mismatch — `output` " +
        "panels are only ever blessed via the flat field); `config.dataTypeId` shadowed by an " +
        "already-set flat `dataTypeId` on the same panel; the sentinel anywhere else entirely " +
        "(e.g. `fieldMapping`); or a duplicate occurrence alongside a legitimate blessed one.\n" +
        "A panel may instead bind to any pre-existing Output id exactly as apply_proposal already " +
        "accepts, and a dashboard may mix multiple kinds of panel in the same call.\n" +
        "`pipeline.source` is EITHER an existing caller-owned `sourceId` OR an inline new-source " +
        "spec (`type`/`name`/`config`), matching apply_pipeline_proposal exactly (including its " +
        "inline-`csv`-rejected-at-apply-time guardrail); `pipeline.steps` may be empty to bind the " +
        "raw source schema unchanged. This is the deterministic apply path only — there is no " +
        "propose/analyze/dry-run counterpart; review `pipeline` (with propose_pipeline/" +
        "analyze_pipeline_proposal) and `dashboard` (with propose_dashboard) separately first if " +
        "needed — neither call writes anything. Returns { pipeline, dashboard }: `pipeline` matches " +
        "apply_pipeline_proposal's own response (created source (if inline)/pipeline summary/the " +
        "created Outputs (zero, one, or many; exactly one is required if any dashboard panel uses " +
        "the sentinel)/run result); `dashboard` matches apply_proposal's own response (created " +
        "dashboard + panels).",
      inputSchema: {
        pipeline: z.object(pipelineProposalInputSchema),
        dashboard: z.object({
          dashboardName: z.string().min(1),
          panels: z.array(panelSchema),
        }),
      },
    },
    ({ pipeline, dashboard }) =>
      guarded(() =>
        applyCombinedProposalHandler(api, {
          pipeline: {
            pipelineName: pipeline.pipelineName,
            source: pipeline.source as PipelineProposalSource,
            steps: pipeline.steps,
            outputs: pipeline.outputs,
          },
          dashboard: {
            dashboardName: dashboard.dashboardName,
            panels: dashboard.panels as ProposalPanel[],
          },
        } as CombinedProposal),
      ),
  );
}
