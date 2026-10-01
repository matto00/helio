import { httpClient } from "../../../services/httpClient";
import type { AdminUsage } from "../types/adminUsage";

/** `GET /api/admin/usage?days=N` — owner-tier only (the server answers 403 to anyone else; this
 *  client never decides access). */
export async function fetchAdminUsage(days: number): Promise<AdminUsage> {
  const response = await httpClient.get<AdminUsage>("/api/admin/usage", { params: { days } });
  return response.data;
}
