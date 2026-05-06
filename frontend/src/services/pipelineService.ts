import type { Pipeline } from "../types/models";
import { httpClient } from "./httpClient";

interface PipelinesResponse {
  items: Pipeline[];
}

export async function fetchPipelines(): Promise<Pipeline[]> {
  const response = await httpClient.get<PipelinesResponse>("/api/pipelines");
  return response.data.items;
}
