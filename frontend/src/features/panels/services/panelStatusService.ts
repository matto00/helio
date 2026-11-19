import { httpClient } from "../../../services/httpClient";
import type { PanelStatusSnapshot } from "../state/panelStatusStore";

/** `GET /api/dashboards/:id/panel-status` (HEL-1786): per Output panel, the bound pipeline's last run time and status, when
 *  its latest stored data was captured and whether it is data-invalid, plus the dashboard's source names. Readable by any
 *  caller with access to the dashboard (owner, editor or viewer grantee), unlike the Output and pipeline routes this stands
 *  in for. Contract: `schemas/dashboards/dashboard-panel-status-response.schema.json`. */
export async function fetchDashboardPanelStatus(dashboardId: string): Promise<PanelStatusSnapshot> {
  const response = await httpClient.get<PanelStatusSnapshot>(
    `/api/dashboards/${dashboardId}/panel-status`,
  );
  return response.data;
}
