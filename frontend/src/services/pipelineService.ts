import type { PipelineSummary } from "../types/models";
import { httpClient } from "./httpClient";

export async function getPipelines(): Promise<PipelineSummary[]> {
  const response = await httpClient.get<PipelineSummary[]>("/api/pipelines");
  return response.data;
}
