/**
 * `ask_dashboard` handler (HEL-1747): a pass-through of `POST /api/dashboards/:id/ask`. The backend
 * is the sole authority on scope, tier, quota and grounding, so nothing is reshaped here.
 */

import type { HelioApi } from "../helioApi.js";
import type { AskDashboardResponse } from "../types.js";

export function askDashboardHandler(
  api: HelioApi,
  input: { dashboardId: string; question: string },
): Promise<AskDashboardResponse> {
  return api.askDashboard(input.dashboardId, input.question);
}
