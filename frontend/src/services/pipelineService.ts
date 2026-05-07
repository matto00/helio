import type { Pipeline, PipelineSummary } from "../types/models";
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
