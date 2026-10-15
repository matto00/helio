import { httpClient } from "../../../services/httpClient";
import type { DashboardFolder, DashboardFolderList } from "../types/dashboardFolder";

export async function fetchDashboardFolders(): Promise<DashboardFolderList> {
  const response = await httpClient.get<DashboardFolderList>("/api/dashboard-folders");
  return response.data;
}

export async function createDashboardFolder(name: string): Promise<DashboardFolder> {
  const response = await httpClient.post<DashboardFolder>("/api/dashboard-folders", { name });
  return response.data;
}

export async function updateDashboardFolder(
  folderId: string,
  patch: { name?: string; collapsed?: boolean },
): Promise<DashboardFolder> {
  const response = await httpClient.patch<DashboardFolder>(
    `/api/dashboard-folders/${folderId}`,
    patch,
  );
  return response.data;
}

export async function deleteDashboardFolder(folderId: string): Promise<void> {
  await httpClient.delete(`/api/dashboard-folders/${folderId}`);
}

/** `folderId: null` unfiles the dashboard. */
export async function moveDashboardToFolder(
  dashboardId: string,
  folderId: string | null,
): Promise<void> {
  await httpClient.put(`/api/dashboards/${dashboardId}/folder`, { folderId });
}
