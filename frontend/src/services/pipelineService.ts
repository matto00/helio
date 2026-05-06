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
