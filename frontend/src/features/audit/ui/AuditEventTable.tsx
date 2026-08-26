// Read-only audit history table (HEL-488). Presentational only — no
// mutation affordance anywhere in this component (spec requirement).
// Mirrors `MetricListTable.tsx`'s raw-<table> structure/class-naming
// precedent.

import { actionLabel } from "./actionLabels";
import { actorLabel } from "./actorLabel";
import type { AuditEvent } from "../types/auditEvent";
import "./AuditEventTable.css";

interface AuditEventTableProps {
  events: AuditEvent[];
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function resourceLabel(event: AuditEvent): string {
  if (event.resourceId) return `${event.resourceType} (${event.resourceId})`;
  return event.resourceType;
}

export function AuditEventTable({ events }: AuditEventTableProps) {
  return (
    <div className="audit-event-table__scroll">
      <table className="audit-event-table">
        <thead>
          <tr>
            <th className="audit-event-table__th">Action</th>
            <th className="audit-event-table__th">Resource</th>
            <th className="audit-event-table__th">Actor</th>
            <th className="audit-event-table__th">Source</th>
            <th className="audit-event-table__th">When</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="audit-event-table__row">
              <td className="audit-event-table__td">{actionLabel(event.action)}</td>
              <td className="audit-event-table__td">{resourceLabel(event)}</td>
              <td className="audit-event-table__td">
                {actorLabel(event.source)}
                {event.actorTokenId && (
                  <span className="audit-event-table__token-id">{event.actorTokenId}</span>
                )}
              </td>
              <td className="audit-event-table__td">{event.source}</td>
              <td className="audit-event-table__td">{formatTimestamp(event.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
