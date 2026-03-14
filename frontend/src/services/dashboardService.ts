import type { Dashboard, DashboardAppearance } from "../types/models";
import { httpClient } from "./httpClient";

interface DashboardsResponse {
  items: Dashboard[];
}

interface UpdateDashboardAppearanceRequest {
  appearance: DashboardAppearance;
}

export async function fetchDashboards(): Promise<Dashboard[]> {
  const response = await httpClient.get<DashboardsResponse>("/api/dashboards");
  return response.data.items;
}

export async function updateDashboardAppearance(
  dashboardId: string,
  appearance: DashboardAppearance,
): Promise<Dashboard> {
  const response = await httpClient.patch<Dashboard>(`/api/dashboards/${dashboardId}`, {
    appearance,
  } satisfies UpdateDashboardAppearanceRequest);
  return response.data;
}
