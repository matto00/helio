import { formatRelativeTime } from "../../utils/formatRelativeTime";
import type { DashboardMeta } from "../../features/panels/state/dashboardMeta";

/** The refresh fact's text and ISO time (HEL-1576), or `null` when there is nothing to say: "refreshed 9h ago",
 *  "last run failed 9h ago" or "not refreshed yet"; nothing for an unknown refresh state. The one source of this copy,
 *  shared by the desktop meta row (`DashboardMetaFacts`) and the phone refreshed line (HEL-1583 D11). */
export function refreshFactOf(
  meta: Pick<DashboardMeta, "refreshState" | "refreshedAt" | "refreshIntent">,
  now: number,
): { text: string; iso: string | null } | null {
  if (meta.refreshState === "never") return { text: "not refreshed yet", iso: null };
  if (meta.refreshState === "ran" && meta.refreshedAt !== null) {
    const ago = formatRelativeTime(meta.refreshedAt, now);
    return {
      text: meta.refreshIntent === "danger" ? `last run failed ${ago}` : `refreshed ${ago}`,
      iso: meta.refreshedAt,
    };
  }
  return null;
}

interface RefreshFactProps {
  fact: { text: string; iso: string | null };
  intent: DashboardMeta["refreshIntent"];
}

/** The refresh fact's markup: the status dot (when the last run had an outcome) and the text, as a `<time>` with a
 *  full-date title when there is a timestamp. Class names are the meta row's (`DashboardMetaRow.css`). */
export function RefreshFact({ fact, intent }: RefreshFactProps) {
  return (
    <span className="dashboard-meta-row__fact dashboard-meta-row__refresh">
      {intent !== null && (
        <span
          className={`dashboard-meta-row__dot dashboard-meta-row__dot--${intent}`}
          aria-hidden="true"
        />
      )}
      {fact.iso !== null ? (
        <time dateTime={fact.iso} title={new Date(fact.iso).toLocaleString()}>
          {fact.text}
        </time>
      ) : (
        fact.text
      )}
    </span>
  );
}
