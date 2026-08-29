/**
 * `get_pipeline_schedule`/`set_pipeline_schedule`/`delete_pipeline_schedule`/
 * `update_dashboard`'s tool descriptions + thin handlers (HEL-863 design.md
 * D10). Extracted out of `write.ts`, zod-free — importing `write.ts` from a
 * test makes node die with a heap OOM at 4 GB (its ~33-registration,
 * ~1175-line Zod-schema surface is pathologically expensive to type-check
 * under this repo's root `tsconfig.json`/ts-jest combination, a pre-existing
 * issue documented in `write.test.ts`'s own header). `write.ts` imports the
 * descriptions and handlers below and does the actual `server.registerTool`
 * calls (Zod `inputSchema` shapes stay there — see design.md D10 for why
 * that surface is untestable by this route).
 */

import type { HelioApi } from "../helioApi.js";
import type {
  DashboardResponse,
  PipelineScheduleResponse,
  PutPipelineScheduleRequest,
} from "../types.js";

/** Build `set_pipeline_schedule`'s PUT body: `kind`/`expression`/`timezone`
 *  are always included; `enabled` is included ONLY when the caller actually
 *  supplied it (`!== undefined`) — design.md D5. The backend's
 *  `enabled: Option[Boolean]` normalises an absent value to `true`
 *  server-side, so sending an explicit `enabled: true` for an omitted
 *  argument would be equivalent today but would couple this layer to a
 *  server-side default it does not own. */
export function buildSetPipelineScheduleBody(args: {
  kind: string;
  expression: string;
  timezone: string;
  enabled?: boolean;
}): PutPipelineScheduleRequest {
  const body: PutPipelineScheduleRequest = {
    kind: args.kind,
    expression: args.expression,
    timezone: args.timezone,
  };
  if (args.enabled !== undefined) body.enabled = args.enabled;
  return body;
}

export const GET_PIPELINE_SCHEDULE_DESCRIPTION =
  "Read a pipeline's refresh schedule (GET /api/pipelines/:id/schedule). A pipeline with NO " +
  "schedule configured returns a 404 (surfaced as a tool error), NOT an empty/null result — " +
  "absence of a schedule is not the same as success with nothing to report. Returns the full " +
  'schedule record: id, pipelineId, kind ("cron"|"interval"), expression, enabled, timezone, ' +
  "nextRunAt, lastRunAt, createdAt, updatedAt.";

export const SET_PIPELINE_SCHEDULE_DESCRIPTION =
  "Create or replace a pipeline's refresh schedule (PUT /api/pipelines/:id/schedule) — this is " +
  "an UPSERT: calling it again for the same pipeline replaces the existing schedule in place and " +
  "keeps its id, it does not create a second schedule or error if one already exists. `kind` is " +
  'either "cron" or "interval". For `kind: "cron"`, `expression` is a standard 5-field cron ' +
  'string in the order `minute hour day-of-month month day-of-week` (e.g. "0 9 * * *" for daily ' +
  "at 9am), each field a `*`, a number, a `lo-hi` range, or a `base/step` (comma-separable). For " +
  '`kind: "interval"`, `expression` is `<n><unit>` where unit is one of s/m/h/d and n > 0 (e.g. ' +
  '"15m", "1d"). `timezone` is a required IANA zone id (e.g. "America/Los_Angeles", "UTC") ' +
  '— there is no default, since which zone "daily" means is a decision only the caller can make. ' +
  "`enabled` is optional and defaults to true when omitted. IMPORTANT asymmetry: changing `kind`, " +
  "`expression`, or `timezone` RESETS the schedule's next firing time; toggling `enabled` alone " +
  "PRESERVES it. This tool does not re-validate the cron/interval grammar client-side — a malformed " +
  "`expression` is rejected by the backend with a descriptive error naming the problem.";

export const DELETE_PIPELINE_SCHEDULE_DESCRIPTION =
  "Delete a pipeline's refresh schedule (DELETE /api/pipelines/:id/schedule). Deleting a schedule " +
  "that does not exist is an error (404), not a no-op success — the pipeline itself is never " +
  "deleted, only its schedule. Returns { deleted: true, pipelineId }.";

export const UPDATE_DASHBOARD_DESCRIPTION =
  "Rename an existing dashboard (PATCH /api/dashboards/:id). Name-only — this tool does not " +
  "accept `appearance` or `layout`; layout has its own dedicated tools (update_dashboard_layout, " +
  "auto_layout_dashboard). The dashboard's id is unchanged by a rename, so any saved link built " +
  "from the id keeps resolving. Returns the updated dashboard.";

export function getPipelineScheduleHandler(
  api: HelioApi,
  pipelineId: string,
): Promise<PipelineScheduleResponse> {
  return api.getPipelineSchedule(pipelineId);
}

export function setPipelineScheduleHandler(
  api: HelioApi,
  input: {
    pipelineId: string;
    kind: string;
    expression: string;
    timezone: string;
    enabled?: boolean;
  },
): Promise<PipelineScheduleResponse> {
  return api.setPipelineSchedule(
    input.pipelineId,
    buildSetPipelineScheduleBody({
      kind: input.kind,
      expression: input.expression,
      timezone: input.timezone,
      enabled: input.enabled,
    }),
  );
}

export function deletePipelineScheduleHandler(
  api: HelioApi,
  pipelineId: string,
): Promise<{ deleted: true; pipelineId: string }> {
  return api.deletePipelineSchedule(pipelineId);
}

export function updateDashboardHandler(
  api: HelioApi,
  dashboardId: string,
  name: string,
): Promise<DashboardResponse> {
  return api.updateDashboard(dashboardId, name);
}
