import type { Dashboard, DashboardAppearance, DashboardLayout } from "../types/models";
import { httpClient } from "./httpClient";

interface DashboardsResponse {
  items: Dashboard[];
}

interface CreateDashboardRequest {
  name: string;
}

interface UpdateDashboardAppearanceRequest {
  appearance: DashboardAppearance;
}

interface UpdateDashboardLayoutRequest {
  layout: DashboardLayout;
}

export async function fetchDashboards(): Promise<Dashboard[]> {
  const response = await httpClient.get<DashboardsResponse>("/api/dashboards");
  return response.data.items;
}

export async function createDashboard(name: string): Promise<Dashboard> {
  const response = await httpClient.post<Dashboard>("/api/dashboards", {
    name,
  } satisfies CreateDashboardRequest);
  return response.data;
}

export async function renameDashboard(dashboardId: string, name: string): Promise<Dashboard> {
  const response = await httpClient.patch<Dashboard>(`/api/dashboards/${dashboardId}`, { name });
  return response.data;
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

export async function deleteDashboard(dashboardId: string): Promise<void> {
  await httpClient.delete(`/api/dashboards/${dashboardId}`);
}

export async function updateDashboardLayout(
  dashboardId: string,
  layout: DashboardLayout,
): Promise<Dashboard> {
  const response = await httpClient.patch<Dashboard>(`/api/dashboards/${dashboardId}`, {
    layout,
  } satisfies UpdateDashboardLayoutRequest);
  return response.data;
}
