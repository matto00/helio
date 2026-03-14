import type { Dashboard } from "../types/models";
import { httpClient } from "./httpClient";

interface DashboardsResponse {
  items: Dashboard[];
}

export async function fetchDashboards(): Promise<Dashboard[]> {
  const response = await httpClient.get<DashboardsResponse>("/api/dashboards");
  return response.data.items;
}
