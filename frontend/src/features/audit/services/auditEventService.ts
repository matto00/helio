import type { PagedResult } from "../../../types/models";
import { httpClient } from "../../../services/httpClient";
import type { AuditEvent, AuditEventFilters } from "../types/auditEvent";

/** `GET /api/audit-events` — owner-scoped, paginated, optionally filtered
 *  (HEL-488). `filters`/`offset`/`limit` are all optional; an omitted
 *  filter imposes no additional restriction server-side. */
export async function fetchAuditEvents(
  filters: AuditEventFilters = {},
  offset?: number,
  limit?: number,
): Promise<PagedResult<AuditEvent>> {
  const params: Record<string, string | number> = { ...filters };
  if (offset !== undefined) params.offset = offset;
  if (limit !== undefined) params.limit = limit;

  const response = await httpClient.get<PagedResult<AuditEvent>>("/api/audit-events", { params });
  return response.data;
}
