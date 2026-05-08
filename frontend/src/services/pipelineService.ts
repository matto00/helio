import type {
  Pipeline,
  PipelineRunRecord,
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

export async function runPipeline(pipelineId: string): Promise<{ runId: string }> {
  const response = await httpClient.post<{ runId: string }>(`/api/pipelines/${pipelineId}/run`);
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
