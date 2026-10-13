import { useId } from "react";

import type { AdminUsageTotals } from "../types/adminUsage";
import { Stat } from "./Stat";

/** Live size of the stored-object deletion queue (HEL-1531). Separate from the all-time totals: these
 *  are a snapshot at page load, not cumulative. Counts only, never a key or row. */
export function StorageCleanup({ totals }: { totals: AdminUsageTotals }) {
  const headingId = useId();
  return (
    <section className="admin-usage__totals" aria-labelledby={headingId}>
      <h2 id={headingId} className="admin-usage__section-title">
        Storage cleanup
      </h2>
      <p className="admin-usage__muted">
        Live at page load. Stuck rows are retried 24 h after their last attempt.
      </p>
      <dl className="admin-usage__stats admin-usage__stats--pair">
        <Stat
          label="Queued deletions"
          value={String(totals.storedObjectDeletionsQueued)}
          hint="stored objects waiting to be removed"
        />
        <Stat
          label="Stuck deletions"
          value={String(totals.storedObjectDeletionsStuck)}
          hint="reached the retry limit"
        />
      </dl>
    </section>
  );
}
