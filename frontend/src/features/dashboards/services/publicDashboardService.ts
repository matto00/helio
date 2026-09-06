// HEL-590 CR1 -- HTTP wrapper for the public, optional-auth `GET /api/dashboards/:id/panels`
// endpoint when read with a share-link `?token=`. Deliberately separate from
// `panelService.fetchPanels` (authenticated dashboards never carry a token) so this call site's
// single-outcome-on-failure contract (see `PublicDashboardViewerPage.tsx`) isn't accidentally
// shared with, or weakened by, the authenticated path's normal error handling.

import { httpClient } from "../../../services/httpClient";
import type { Panel } from "../../panels/types/panel";
import type { PagedResult } from "../../../types/models";

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
