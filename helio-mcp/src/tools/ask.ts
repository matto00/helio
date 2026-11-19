/**
 * `ask_dashboard` (HEL-1747): ask a dashboard a grounded question. A thin shell (zod input plus a
 * `guarded` one-liner); the logic lives in `askHandlers.ts`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import { askDashboardHandler } from "./askHandlers.js";

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

export function registerAskTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "ask_dashboard",
    {
      title: "Ask a dashboard a question",
      description:
        "Ask a question of a dashboard (POST /api/dashboards/:id/ask, body `{question}`) and get " +
        "`{answer, citations, citedOutputs, pin}` unchanged. The SERVER model (there is no model " +
        "argument) answers from the dashboard's own Outputs only, through a read-only tool loop that " +
        "re-checks scope on every call. Every number and date in the answer is cited (`[cN]` markers " +
        "matching `citations[].id`); nothing is persisted. `question` is 1..2000 characters. `pin` is " +
        "null unless an owner or editor of the one cited pipeline asked; a non-null `pin.request` is a " +
        "body you may pass to add_output on `pin.pipelineId` (`add_output({pipelineId: pin.pipelineId, " +
        "...pin.request})`) to keep the question as an `insight` Output with `refresh: manual`; " +
        "creating it does not render, so call refresh_insight next. Errors: 422 `ASK_UNGROUNDED` " +
        "(the answer failed grounding after one retry) and 422 `ASK_ANSWER_TRUNCATED` (the model hit " +
        "its output cap), 403 `TIER_FORBIDDEN` (free tier), 429 `CHAT_LIMIT_REACHED` (beta daily " +
        "cap; a plain 429 with Retry-After is the rate limiter), 503 when the server has no model " +
        "key, 404 when the caller cannot ask that dashboard (only its owner or a grantee can; a " +
        "public or shared link never admits).",
      inputSchema: {
        dashboardId: z.string().min(1),
        question: z.string().min(1).max(2000),
      },
    },
    ({ dashboardId, question }) =>
      guarded(() => askDashboardHandler(api, { dashboardId, question })),
  );
}
