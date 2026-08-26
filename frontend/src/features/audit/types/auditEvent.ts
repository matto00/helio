// Audit event domain types — mirrors the backend `AuditEventResponse` wire
// shape (`AuditEventProtocol.scala`, HEL-488).

/** Mirrors backend `AuditSource` (`domain/model/model.scala`). `mcp` is a
 *  legal wire value the DB CHECK constraint allows but is never actually
 *  produced today (no reliable signal distinguishes an MCP call from a
 *  plain PAT call) — design.md Decision 6/6a. The UI never infers "MCP"
 *  from a `pat` row. */
export type AuditSource = "ui" | "pat" | "mcp" | "system";

/** Mirrors `AuditEventResponse` (`AuditEventProtocol.scala`). */
export interface AuditEvent {
  id: string;
  actorUserId: string | null;
  actorTokenId: string | null;
  source: AuditSource;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: unknown;
  createdAt: string;
}

/** Optional query filters for `GET /api/audit-events`, mirroring
 *  `AuditEventFilters` (`AuditEventRepository.scala`). All fields optional
 *  and ANDed together server-side; there is deliberately no `actorUserId`
 *  filter — visibility is always scoped to the caller. */
export interface AuditEventFilters {
  resourceType?: string;
  resourceId?: string;
  action?: string;
  source?: AuditSource;
  from?: string;
  to?: string;
}
