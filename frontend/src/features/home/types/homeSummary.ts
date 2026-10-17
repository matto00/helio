// Wire types of `GET /api/home-summary` (HEL-1578). Contract: schemas/home/home-summary-response.schema.json.

export type HomeRunStatus = "queued" | "running" | "succeeded" | "failed";

export interface HomeRun {
  runId: string;
  status: HomeRunStatus;
  startedAt: string;
  completedAt: string | null;
  triggerSource: string;
  rowCount: number | null;
  errorLog: string | null;
}

export interface HomePipeline {
  pipelineId: string;
  name: string;
  /** Real runs started in the window, newest first. */
  runs: HomeRun[];
  runsOmitted: number;
  /** Projected fire instants before the horizon, ascending. */
  upcoming: string[];
}

export type HomeAttentionKind = "failed" | "stuck" | "missed";

export interface HomeAttentionItem {
  kind: HomeAttentionKind;
  pipelineId: string;
  pipelineName: string;
  runId: string | null;
  at: string;
  reason: string | null;
  resolvedAt: string | null;
  inFlight: boolean;
}

export interface HomeUpNextItem {
  pipelineId: string;
  pipelineName: string;
  at: string;
}

export interface HomeDashboardChange {
  dashboardId: string;
  contentUpdatedAt: string | null;
  dataUpdatedAt: string | null;
}

export interface HomeSummary {
  serverNow: string;
  windowStart: string;
  horizonEnd: string;
  pipelines: HomePipeline[];
  pipelinesWithActivity: number;
  attention: HomeAttentionItem[];
  upNext: HomeUpNextItem[];
  dashboardChanges: HomeDashboardChange[];
}
