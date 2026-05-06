import type {
  DividerOrientation,
  ImageFit,
  Panel,
  PanelAppearance,
  PanelType,
  TypeConfig,
  UpdatePanelsBatchRequest,
  UpdatePanelsBatchResponse,
} from "../types/models";
import { httpClient } from "./httpClient";

interface PanelsResponse {
  items: Panel[];
}

interface CreatePanelRequest {
  dashboardId: string;
  title: string;
  type?: PanelType;
  // Optional type-specific config fields forwarded to the backend on create
  metricValueLabel?: string;
  metricUnit?: string;
  imageUrl?: string;
  dividerOrientation?: string;
  appearance?: { chart?: { chartType?: string } };
}

interface UpdatePanelAppearanceRequest {
  appearance: PanelAppearance;
}

export async function fetchPanels(dashboardId: string): Promise<Panel[]> {
  const response = await httpClient.get<PanelsResponse>(`/api/dashboards/${dashboardId}/panels`);
  return response.data.items;
}

export async function createPanel(
  dashboardId: string,
  title: string,
  type?: PanelType,
  typeConfig?: TypeConfig,
): Promise<Panel> {
  const body: CreatePanelRequest = { dashboardId, title };
  if (type !== undefined) body.type = type;
  if (typeConfig) {
    switch (typeConfig.type) {
      case "metric":
        if (typeConfig.valueLabel) body.metricValueLabel = typeConfig.valueLabel;
        if (typeConfig.unit) body.metricUnit = typeConfig.unit;
        break;
      case "chart":
        if (typeConfig.chartType) body.appearance = { chart: { chartType: typeConfig.chartType } };
        break;
      case "image":
        if (typeConfig.imageUrl) body.imageUrl = typeConfig.imageUrl;
        break;
      case "divider":
        if (typeConfig.dividerOrientation) body.dividerOrientation = typeConfig.dividerOrientation;
        break;
    }
  }
  const response = await httpClient.post<Panel>("/api/panels", body);
  return response.data;
}

export async function updatePanelTitle(panelId: string, title: string): Promise<Panel> {
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { title });
  return response.data;
}

export async function deletePanel(panelId: string): Promise<void> {
  await httpClient.delete(`/api/panels/${panelId}`);
}

export async function duplicatePanel(panelId: string): Promise<Panel> {
  const response = await httpClient.post<Panel>(`/api/panels/${panelId}/duplicate`);
  return response.data;
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

export async function updatePanelsBatch(
  request: UpdatePanelsBatchRequest,
): Promise<UpdatePanelsBatchResponse> {
  const response = await httpClient.post<UpdatePanelsBatchResponse>(
    "/api/panels/updateBatch",
    request,
  );
  return response.data;
}

export async function updatePanelBinding(
  panelId: string,
  typeId: string | null,
  fieldMapping: Record<string, string> | null,
  refreshInterval: number | null,
): Promise<Panel> {
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, {
    typeId,
    fieldMapping,
    refreshInterval,
  });
  return response.data;
}

export async function updatePanelContent(panelId: string, content: string): Promise<Panel> {
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { content });
  return response.data;
}

export async function updatePanelImage(
  panelId: string,
  imageUrl: string,
  imageFit: ImageFit,
): Promise<Panel> {
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, {
    imageUrl,
    imageFit,
  });
  return response.data;
}

export async function updatePanelDivider(
  panelId: string,
  dividerOrientation: DividerOrientation,
  dividerWeight: number,
  dividerColor: string | null,
): Promise<Panel> {
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, {
    dividerOrientation,
    dividerWeight,
    dividerColor,
  });
  return response.data;
}
