import type { Dashboard } from "../../dashboards/types/dashboard";
import type { HomePipeline, HomeRun, HomeSummary } from "../types/homeSummary";

export const NOW = Date.parse("2026-10-13T09:12:00Z");
const HOUR = 3_600_000;

export function iso(offsetHours: number): string {
  return new Date(NOW + offsetHours * HOUR).toISOString();
}

export function run(overrides: Partial<HomeRun> & { runId: string; startedAt: string }): HomeRun {
  return {
    status: "succeeded",
    completedAt: null,
    triggerSource: "manual",
    rowCount: 3,
    errorLog: null,
    ...overrides,
  };
}

export function pipeline(
  overrides: Partial<HomePipeline> & { pipelineId: string; name: string },
): HomePipeline {
  return { runs: [], runsOmitted: 0, upcoming: [], ...overrides };
}

export function summary(overrides: Partial<HomeSummary> = {}): HomeSummary {
  return {
    serverNow: iso(0),
    windowStart: iso(-24),
    horizonEnd: iso(6),
    pipelines: [],
    pipelinesWithActivity: 0,
    attention: [],
    upNext: [],
    dashboardChanges: [],
    ...overrides,
  };
}

export function dashboard(
  id: string,
  name: string,
  lastUpdated: string,
  lg: Dashboard["layout"]["lg"] = [],
): Dashboard {
  return {
    id,
    name,
    meta: { createdAt: "2026-01-01T00:00:00Z", lastUpdated },
    appearance: { background: "transparent", gridBackground: "transparent" },
    layout: { lg, md: [], sm: [], xs: [] },
  };
}
