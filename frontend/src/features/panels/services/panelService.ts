import type {
  ChartAggregation,
  DividerOrientation,
  ImageFit,
  MetricAggregation,
  Panel,
  PanelAppearance,
  PanelType,
  TypeConfig,
  UpdatePanelsBatchRequest,
  UpdatePanelsBatchResponse,
} from "../types/panel";
import type { PagedResult } from "../../../types/models";
import {
  buildCreatePanelBody,
  buildBindingPatch,
  buildContentPatch,
  buildDividerPatch,
  buildImagePatch,
  buildTableWidthsPatch,
  buildTextBindingPatch,
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

export async function createPanel(
  dashboardId: string,
  title: string,
  type?: PanelType,
  typeConfig?: TypeConfig,
  dataTypeId?: string,
): Promise<Panel> {
  // CS2c-3c wire shape — `{ dashboardId, title, type, config }`. When the
  // caller omits `type` we default to "metric" so the body still satisfies
  // the typed-config wire (legacy callers used to omit `type` and let the
  // backend default; the typed wire requires us to be explicit).
  const resolvedType: PanelType = type ?? "metric";
  const body = buildCreatePanelBody({
    dashboardId,
    title,
    type: resolvedType,
    typeConfig,
    dataTypeId,
  });
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

/** PATCH a binding (metric/chart/table). The backend dispatches on the
 *  stored panel's `type` and applies the typed-config patch — there is no
 *  cross-type leak because the typed-config decoders are subtype-specific. */
export async function updatePanelBinding(
  panelId: string,
  typeId: string | null,
  fieldMapping: Record<string, string> | null,
  _refreshInterval: number | null,
  aggregation?: MetricAggregation | ChartAggregation | null,
  /** HEL-243: literal label/unit override — `undefined` = leave unchanged,
   *  `null` = explicit clear, a string = set. See `buildBindingPatch`. */
  label?: string | null,
  unit?: string | null,
): Promise<Panel> {
  // refreshInterval is intentionally dropped at the network boundary — the
  // backend has no schema or column for it. The slice mirrors it into Redux
  // state as a frontend-only optimistic update so polling keeps working.
  const config = buildBindingPatch({ typeId, fieldMapping, aggregation, label, unit });
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { config });
  return response.data;
}

export async function updatePanelContent(panelId: string, content: string): Promise<Panel> {
  const config = buildContentPatch(content);
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { config });
  return response.data;
}

/** PATCH a Text panel's Content editor save (HEL-244) — see
 *  `buildTextBindingPatch` for the Source/Static patch-shape rules. */
export async function updatePanelTextBinding(
  panelId: string,
  args: {
    mode: "field" | "literal";
    typeId: string | null;
    fieldValue: string;
    literalValue: string;
  },
): Promise<Panel> {
  const config = buildTextBindingPatch(args);
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { config });
  return response.data;
}

export async function updatePanelImage(
  panelId: string,
  imageUrl: string,
  imageFit: ImageFit,
): Promise<Panel> {
  const config = buildImagePatch({ imageUrl, imageFit });
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { config });
  return response.data;
}

/** PATCH a Table panel's persisted column widths (HEL-253). Kept as its own
 *  call — separate from `updatePanelBinding` — so a debounced resize PATCH
 *  never races/clobbers an in-flight binding edit's absent-vs-null
 *  semantics; see `buildTableWidthsPatch`. */
export async function updatePanelColumnWidths(
  panelId: string,
  columnWidths: Record<string, number>,
): Promise<Panel> {
  const config = buildTableWidthsPatch(columnWidths);
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, { config });
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
