import type { Panel } from "../types/models";
import { httpClient } from "./httpClient";

interface PanelsResponse {
  items: Panel[];
}

export async function fetchPanels(dashboardId: string): Promise<Panel[]> {
  const response = await httpClient.get<PanelsResponse>(`/api/dashboards/${dashboardId}/panels`);
  return response.data.items;
}
