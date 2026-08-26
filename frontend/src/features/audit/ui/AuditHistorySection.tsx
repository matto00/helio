// Settings-page "Audit history" section (HEL-488) — read-only, no mutation
// controls anywhere. Owns its own fetch/loading/error state (F-047
// per-section-gate pattern, mirrors `MfaSecuritySection`), fetched on mount.

import { useEffect } from "react";
import { faClockRotateLeft } from "@fortawesome/free-solid-svg-icons";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { EmptyState } from "../../../shared/ui/index";
import { fetchAuditEvents } from "../state/auditEventsSlice";
import { AuditEventTable } from "./AuditEventTable";
import "./AuditHistorySection.css";

export function AuditHistorySection() {
  const dispatch = useAppDispatch();
  const { items, total, status, error } = useAppSelector((state) => state.auditEvents);

  useEffect(() => {
    void dispatch(fetchAuditEvents());
  }, [dispatch]);

  const loading = status === "idle" || status === "loading";

  if (loading) {
    return (
      <p className="audit-history-section__loading" aria-label="Loading audit history">
        Loading audit history…
      </p>
    );
  }

  if (status === "failed") {
    return (
      <p className="audit-history-section__error" role="alert">
        {error ?? "Failed to load audit history."}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        variant="main"
        icon={faClockRotateLeft}
        title="No audit events yet"
        description="Actions you and your tokens take will show up here."
      />
    );
  }

  // design.md Decision 6b: v1 shows only the first page (Page.Default),
  // with no "load more" control. Truncation is made visible (not silent)
  // via this caption whenever `total` exceeds what's actually shown.
  return (
    <div className="audit-history-section">
      {total > items.length && (
        <p className="audit-history-section__caption">
          Showing latest {items.length} of {total} events.
        </p>
      )}
      <AuditEventTable events={items} />
    </div>
  );
}
