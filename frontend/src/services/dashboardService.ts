import type {
  Dashboard,
  DashboardAppearance,
  DashboardLayout,
  DashboardSnapshot,
  DuplicateDashboardResponse,
} from "../types/models";
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
  const response = await httpClient.patch<Dashboard>(`/api/dashboards/${dashboardId}/update`, {
    fields: ["layout"],
    dashboard: { layout },
  });
  return response.data;
}

export async function duplicateDashboard(dashboardId: string): Promise<DuplicateDashboardResponse> {
  const response = await httpClient.post<DuplicateDashboardResponse>(
    `/api/dashboards/${dashboardId}/duplicate`,
  );
  return response.data;
}

export async function exportDashboard(dashboardId: string, dashboardName: string): Promise<void> {
  const response = await httpClient.get<DashboardSnapshot>(`/api/dashboards/${dashboardId}/export`);
  const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${dashboardName}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importDashboard(
  snapshot: DashboardSnapshot,
): Promise<DuplicateDashboardResponse> {
  const response = await httpClient.post<DuplicateDashboardResponse>(
    `/api/dashboards/import`,
    snapshot,
  );
  return response.data;
}
