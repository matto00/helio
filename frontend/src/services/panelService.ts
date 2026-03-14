import type { Panel, PanelAppearance } from "../types/models";
import { httpClient } from "./httpClient";

interface PanelsResponse {
  items: Panel[];
}

interface UpdatePanelAppearanceRequest {
  appearance: PanelAppearance;
}

export async function fetchPanels(dashboardId: string): Promise<Panel[]> {
  const response = await httpClient.get<PanelsResponse>(`/api/dashboards/${dashboardId}/panels`);
  return response.data.items;
}

export async function updatePanelAppearance(
  panelId: string,
  appearance: PanelAppearance,
): Promise<Panel> {
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, {
    appearance,
  } satisfies UpdatePanelAppearanceRequest);
  return response.data;
}
