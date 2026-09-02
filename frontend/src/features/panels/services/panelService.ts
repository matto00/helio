import type {
  DividerOrientation,
  ImageFit,
  Panel,
  PanelAppearance,
  PanelKind,
  UpdatePanelsBatchRequest,
  UpdatePanelsBatchResponse,
} from "../types/panel";
import type { PagedResult } from "../../../types/models";
import {
  buildContentPatch,
  buildCreatePanelBody,
  buildDividerPatch,
  buildImagePatch,
} from "../state/panelPayloads";
import { httpClient } from "../../../services/httpClient";

interface UpdatePanelAppearanceRequest {
  appearance: PanelAppearance;
}

export async function fetchPanels(dashboardId: string): Promise<Panel[]> {
  const response = await httpClient.get<PagedResult<Panel>>(
    `/api/dashboards/${dashboardId}/panels`,
  );
  return response.data.items;
}

/** Create a panel. `outputId` is required for `type: "output"`; ignored
 *  otherwise. No layout is ever sent — the server owns decision-15 default
 *  placement/size. */
export async function createPanel(
  dashboardId: string,
  type: PanelKind,
  title?: string,
  outputId?: string,
): Promise<Panel> {
  const body = buildCreatePanelBody({ dashboardId, title, type, outputId });
  const response = await httpClient.post<Panel>("/api/panels", body);
  return response.data;
}

export async function updatePanelTitle(panelId: string, title: string): Promise<Panel> {
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { title });
  return response.data;
}

/** PATCH an existing panel's `outputId` in place, preserving its position/
 *  size ("Swap output" — `specs/panel-detail-modal/spec.md`). */
export async function patchPanelOutputId(panelId: string, outputId: string): Promise<Panel> {
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, {
    config: { outputId },
  });
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

/** PATCH a Text panel's literal content. */
export async function updatePanelTextContent(panelId: string, content: string): Promise<Panel> {
  const config = buildContentPatch(content);
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { config });
  return response.data;
}

/** PATCH a Markdown panel's literal content. */
export async function updatePanelMarkdownContent(panelId: string, content: string): Promise<Panel> {
  const config = buildContentPatch(content);
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { config });
  return response.data;
}

export async function updatePanelImage(
  panelId: string,
  imageUrl: string,
  imageFit: ImageFit,
  caption: string | null,
): Promise<Panel> {
  const config = buildImagePatch({ imageUrl, imageFit, caption });
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { config });
  return response.data;
}

export interface UploadPanelImageResponse {
  id: string;
  url: string;
}

/** Upload a file to the standalone panel-literal image store (HEL-246),
 *  mirroring `dataSourceService.createCsvSource`'s multipart shape. The
 *  returned `url` is a root-relative `/api/uploads/image/<id>` path — set it
 *  directly as the Image panel's `imageUrl`, exactly like a typed URL. */
export async function uploadPanelImage(file: File): Promise<UploadPanelImageResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await httpClient.post<UploadPanelImageResponse>("/api/uploads/image", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function updatePanelDivider(
  panelId: string,
  dividerOrientation: DividerOrientation,
  dividerWeight: number,
  dividerColor: string | null,
): Promise<Panel> {
  const config = buildDividerPatch({
    orientation: dividerOrientation,
    weight: dividerWeight,
    color: dividerColor,
  });
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { config });
  return response.data;
}
