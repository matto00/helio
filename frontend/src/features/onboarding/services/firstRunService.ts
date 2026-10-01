import { httpClient } from "../../../services/httpClient";

export interface FirstRunBuildResult {
  dashboardId: string;
  dashboardName: string;
  panelCount: number;
  pipelineId: string;
  pipelineName: string;
  sourceId: string;
  sourceName: string;
}

/** Builds, runs and lays out a dashboard from an existing CSV source by rule. No model call, for
 *  every tier — the server route is deliberately not tier-gated. */
export async function buildFirstRunDashboard(sourceId: string): Promise<FirstRunBuildResult> {
  const response = await httpClient.post<FirstRunBuildResult>("/api/first-run/dashboard", {
    sourceId,
  });
  return response.data;
}

/** Instantiates a persona sample-data template for the caller: server-side it creates their own
 *  sample CSV source, runs the pipeline and lays out the dashboard through the same apply path as
 *  [`buildFirstRunDashboard`]. No model call, every tier. */
export async function buildTemplateDashboard(template: string): Promise<FirstRunBuildResult> {
  const response = await httpClient.post<FirstRunBuildResult>("/api/first-run/template", {
    template,
  });
  return response.data;
}
