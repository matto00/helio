// pipelineSchedule — frontend types for the HEL-414 schedule CRUD routes
// (`GET/PUT/DELETE /api/pipelines/:id/schedule`). Mirrors
// `schemas/pipelines/pipeline-schedule.schema.json` / `schemas/pipelines/put-pipeline-schedule-request.schema.json`
// field-for-field. Kept separate from the large `types/pipelineStep.ts` — schedules are a
// distinct concern from steps (design D6).

export type ScheduleKind = "cron" | "interval";

/** Mirrors `schemas/pipelines/pipeline-schedule.schema.json` — the GET/PUT response shape.
 *  `nextRunAt`/`lastRunAt` are persisted but computed by the scheduler runtime
 *  (HEL-415), not this UI; they may be `null` until the first tick. */
export interface PipelineSchedule {
  id: string;
  pipelineId: string;
  kind: ScheduleKind;
  expression: string;
  enabled: boolean;
  timezone: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `schemas/pipelines/put-pipeline-schedule-request.schema.json` — the PUT request
 *  body. `enabled` is optional on the wire (the backend normalizes an absent
 *  value to `true`); this UI always sends it explicitly. */
export interface PutPipelineScheduleRequest {
  kind: ScheduleKind;
  expression: string;
  enabled?: boolean;
  timezone: string;
}

/** One enabled schedule in `GET /api/pipeline-schedules` (HEL-1574). Mirrors
 *  `schemas/pipelines/pipeline-schedule-list-response.schema.json`. */
export interface ScheduledPipelineItem {
  pipelineId: string;
  pipelineName: string;
  kind: ScheduleKind;
  expression: string;
  timezone: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

/** A source feeding a scheduled pipeline, with the soonest run among those pipelines. */
export interface ScheduledSourceItem {
  sourceId: string;
  sourceName: string;
  nextRunAt: string | null;
  pipelineId: string;
  pipelineName: string;
}

export interface PipelineScheduleList {
  items: ScheduledPipelineItem[];
  sources: ScheduledSourceItem[];
}
