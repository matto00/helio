import { useId } from "react";

import { formatCount } from "../format";
import type { AdminUsageTotals } from "../types/adminUsage";
import { Stat } from "./Stat";

const ACTIVE_HINT = "users with a tracked product event";

/** All-time headline numbers, shown above and independent of the selected window. An unavailable
 *  (`null`) active count renders as an em dash with "not yet available", never 0. */
export function UsageTotals({ totals }: { totals: AdminUsageTotals }) {
  const headingId = useId();
  const asOf = totals.asOf ? `, as of ${totals.asOf}` : "";
  const activeHint = (count: number | null) =>
    count === null ? "not yet available" : `${ACTIVE_HINT}${asOf}`;
  return (
    <section className="admin-usage__totals" aria-labelledby={headingId}>
      <h2 id={headingId} className="admin-usage__section-title">
        All-time totals
      </h2>
      <dl className="admin-usage__stats admin-usage__stats--totals">
        <Stat
          label="Total users"
          value={String(totals.totalUsers)}
          hint="registered, excluding the system user"
        />
        <Stat
          label="Active, last 7 days"
          value={formatCount(totals.activeLast7Days)}
          hint={activeHint(totals.activeLast7Days)}
        />
        <Stat
          label="Active, last 30 days"
          value={formatCount(totals.activeLast30Days)}
          hint={activeHint(totals.activeLast30Days)}
        />
      </dl>
    </section>
  );
}
