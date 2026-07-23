// pipelineSchedule — frontend types for the HEL-414 schedule CRUD routes
// (`GET/PUT/DELETE /api/pipelines/:id/schedule`). Mirrors
// `schemas/pipeline-schedule.schema.json` / `schemas/put-pipeline-schedule-request.schema.json`
// field-for-field. Kept separate from the large `types/pipelineStep.ts` — schedules are a
// distinct concern from steps (design D6).

export type ScheduleKind = "cron" | "interval";

/** Mirrors `schemas/pipeline-schedule.schema.json` — the GET/PUT response shape.
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

/** Mirrors `schemas/put-pipeline-schedule-request.schema.json` — the PUT request
 *  body. `enabled` is optional on the wire (the backend normalizes an absent
 *  value to `true`); this UI always sends it explicitly. */
export interface PutPipelineScheduleRequest {
  kind: ScheduleKind;
  expression: string;
  enabled?: boolean;
  timezone: string;
}
