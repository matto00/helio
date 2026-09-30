// HEL-590 CR1 -- HTTP wrapper for the public, optional-auth `GET /api/dashboards/:id/panels`
// endpoint when read with a share-link `?token=`. Deliberately separate from
// `panelService.fetchPanels` (authenticated dashboards never carry a token) so this call site's
// single-outcome-on-failure contract (see `PublicDashboardViewerPage.tsx`) isn't accidentally
// shared with, or weakened by, the authenticated path's normal error handling.

import { httpClient } from "../../../services/httpClient";
import type { Panel } from "../../panels/types/panel";
import type { PagedResult } from "../../../types/models";
import {
  isFilterActive,
  type OutputRowsFilter,
  type OutputRowsSort,
} from "../../pipelines/services/outputService";
import type {
  OutputFilterCapabilitiesResponse,
  OutputSchemaField,
  PublicOutputMeta,
} from "../../pipelines/types/output";

export async function fetchPublicDashboardPanels(
  dashboardId: string,
  token: string,
): Promise<Panel[]> {
  const response = await httpClient.get<PagedResult<Panel>>(
    `/api/dashboards/${dashboardId}/panels`,
    { params: { token } },
  );
  return response.data.items;
}

export interface PublicPanelRowsResult {
  items: Record<string, unknown>[];
  total: number;
  offset: number;
  limit: number;
}

/** HEL-1190 design.md D1/D6 — `GET /api/dashboards/:dashboardId/panels/:panelId/rows`, extended
 *  with the SAME `sort`/`filter` query-param shape the authenticated `GET /api/outputs/:id/rows`
 *  accepts (task 1.2); a `filter` naming a column outside this panel's own configured controls is
 *  rejected server-side (D5/D6), never silently narrowed here. */
export async function fetchPublicPanelRows(
  dashboardId: string,
  panelId: string,
  token: string,
  offset = 0,
  limit = 200,
  sort?: OutputRowsSort,
  filter?: OutputRowsFilter,
): Promise<PublicPanelRowsResult> {
  const params: Record<string, string | number> = { token, offset, limit };
  if (sort) params.sort = `${sort.column}:${sort.direction}`;
  if (isFilterActive(filter)) params.filter = JSON.stringify(filter);
  const response = await httpClient.get<PublicPanelRowsResult>(
    `/api/dashboards/${dashboardId}/panels/${panelId}/rows`,
    { params },
  );
  return response.data;
}

/** HEL-1190 design.md D8 — `GET /api/dashboards/:dashboardId/panels/:panelId/output-meta`.
 *  Deliberately reconstructs `PublicOutputMeta` field-by-field (never spreads the wire response)
 *  so `ownerId` is always the literal `null` this narrower type declares (design.md D9's nuance).
 *  HEL-1197: the wire response no longer carries `ownerId` at all; the reconstruction stays so a
 *  renderer prop can never receive a real owner id even if a future wire shape re-added one. */
export async function fetchPublicOutputMeta(
  dashboardId: string,
  panelId: string,
  token: string,
): Promise<PublicOutputMeta> {
  const response = await httpClient.get<{
    kind: string;
    config: Record<string, unknown>;
    schema: OutputSchemaField[];
  }>(`/api/dashboards/${dashboardId}/panels/${panelId}/output-meta`, { params: { token } });
  const { kind, config, schema } = response.data;
  return { kind, config, schema, ownerId: null };
}

/** HEL-1190 design.md D5 — the panel-scoped public equivalent of `getFilterCapabilities`, already
 *  narrowed server-side to only this panel's own configured control columns. */
export async function fetchPublicFilterCapabilities(
  dashboardId: string,
  panelId: string,
  token: string,
): Promise<OutputFilterCapabilitiesResponse> {
  const response = await httpClient.get<OutputFilterCapabilitiesResponse>(
    `/api/dashboards/${dashboardId}/panels/${panelId}/filter-capabilities`,
    { params: { token } },
  );
  return response.data;
}

/** HEL-1190 design.md D5 — the panel-scoped public equivalent of `getDistinctValues`; `column`
 *  MUST be one of this panel's own configured control columns or the server rejects it (400). */
export async function fetchPublicDistinctValues(
  dashboardId: string,
  panelId: string,
  token: string,
  column: string,
): Promise<{ column: string; values: Array<{ value: string; count: number }> }> {
  const response = await httpClient.get<{
    column: string;
    values: Array<{ value: string; count: number }>;
  }>(`/api/dashboards/${dashboardId}/panels/${panelId}/distinct-values`, {
    params: { token, column },
  });
  return response.data;
}
