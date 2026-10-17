import { httpClient } from "../../../services/httpClient";
import type { HomeSummary } from "../types/homeSummary";

/** `GET /api/home-summary` (HEL-1578): the Home page's one call, whatever the number of pipelines. `dashboardIds`
 *  (at most 20) asks for those dashboards' change times in the same response. */
export async function fetchHomeSummary(dashboardIds: readonly string[] = []): Promise<HomeSummary> {
  const response = await httpClient.get<HomeSummary>("/api/home-summary", {
    params: dashboardIds.length > 0 ? { dashboardIds: dashboardIds.join(",") } : undefined,
  });
  return response.data;
}
