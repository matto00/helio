import type {
  Pipeline,
  PipelineAnalyzeResponse,
  PipelineRunRecord,
  PipelineStep,
  PipelineStepConfig,
  PipelineStepKind,
  PipelineSummary,
  RunStatusResponse,
} from "../types/models";
import { httpClient } from "./httpClient";

export async function getPipelines(): Promise<PipelineSummary[]> {
  const response = await httpClient.get<PipelineSummary[]>("/api/pipelines");
  return response.data;
}

export async function fetchPipelines(): Promise<Pipeline[]> {
  const summaries = await getPipelines();
  return summaries.map((s) => ({ id: s.id, name: s.name }));
}

export interface CreatePipelinePayload {
  name: string;
  sourceDataSourceId: string;
  outputDataTypeName: string;
}

export async function createPipeline(payload: CreatePipelinePayload): Promise<PipelineSummary> {
  const response = await httpClient.post<PipelineSummary>("/api/pipelines", payload);
  return response.data;
}

export async function getPipelineById(id: string): Promise<PipelineSummary> {
  const response = await httpClient.get<PipelineSummary>(`/api/pipelines/${id}`);
  return response.data;
}

export async function getPipelineSteps(id: string): Promise<PipelineStep[]> {
  const response = await httpClient.get<PipelineStep[]>(`/api/pipelines/${id}/steps`);
  return response.data;
}

export async function updatePipeline(id: string, name: string): Promise<PipelineSummary> {
  const response = await httpClient.patch<PipelineSummary>(`/api/pipelines/${id}`, { name });
  return response.data;
}

export async function deletePipeline(id: string): Promise<void> {
  await httpClient.delete(`/api/pipelines/${id}`);
}

/** CS2c-3a — `type` discriminator + typed `config` object. The old
 *  stringified-JSON `config` path is gone; callers pass typed configs
 *  directly. */
export async function createPipelineStep(
  pipelineId: string,
  type: PipelineStepKind,
  config: PipelineStepConfig,
): Promise<PipelineStep> {
  const response = await httpClient.post<PipelineStep>(`/api/pipelines/${pipelineId}/steps`, {
    type,
    config,
  });
  return response.data;
}

export async function updatePipelineStep(
  stepId: string,
  config: PipelineStepConfig,
): Promise<PipelineStep> {
  const response = await httpClient.patch<PipelineStep>(`/api/pipeline-steps/${stepId}`, {
    config,
  });
  return response.data;
}

export interface RunResult {
  rowCount: number;
  rows: Record<string, unknown>[];
  stepRowCounts: Record<string, number>;
  sourceRowCount: number;
}

export async function runPipeline(pipelineId: string, dryRun?: boolean): Promise<RunResult> {
  const url = dryRun
    ? `/api/pipelines/${pipelineId}/run?dry=true`
    : `/api/pipelines/${pipelineId}/run`;
  const response = await httpClient.post<RunResult>(url);
  return response.data;
}

export async function fetchRunStatus(
  pipelineId: string,
  runId: string,
): Promise<RunStatusResponse> {
  const response = await httpClient.get<RunStatusResponse>(
    `/api/pipelines/${pipelineId}/runs/${runId}`,
  );
  return response.data;
}

export async function fetchRunHistory(pipelineId: string): Promise<PipelineRunRecord[]> {
  const response = await httpClient.get<PipelineRunRecord[]>(
    `/api/pipelines/${pipelineId}/run-history`,
  );
  return response.data;
}

export async function analyzePipeline(pipelineId: string): Promise<PipelineAnalyzeResponse> {
  const response = await httpClient.get<PipelineAnalyzeResponse>(
    `/api/pipelines/${pipelineId}/analyze`,
  );
  return response.data;
}

export interface StepPreviewResponse {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export async function fetchStepPreview(
  pipelineId: string,
  stepId: string,
): Promise<StepPreviewResponse> {
  const response = await httpClient.get<StepPreviewResponse>(
    `/api/pipelines/${pipelineId}/steps/${stepId}/preview`,
  );
  return response.data;
}
