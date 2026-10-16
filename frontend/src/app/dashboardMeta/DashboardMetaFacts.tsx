import { SaveStateIndicator } from "../../shared/chrome/SaveStateIndicator";
import { useNow } from "../../hooks/useNow";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import type { DashboardMeta } from "../../features/panels/state/dashboardMeta";

/** Relative-time copy is re-rendered at most once a minute (design D2). */
const RELATIVE_TIME_TICK_MS = 60_000;

export function panelCountText(count: number): string {
  return count === 1 ? "1 panel" : `${count} panels`;
}

export function sourcesText(meta: Pick<DashboardMeta, "sources" | "moreSources">): string | null {
  if (meta.sources.length === 0) return null;
  const names = meta.sources.join(", ");
  const label = meta.sources.length + meta.moreSources > 1 ? "sources" : "source";
  return `${label} · ${names}${meta.moreSources > 0 ? ` +${meta.moreSources}` : ""}`;
}

interface DashboardMetaFactsProps {
  meta: DashboardMeta;
  /** Panel count only (the narrowest tier). */
  countOnly: boolean;
  showSaveState: boolean;
  onSaveNow: () => void;
}

/** The facts group of the dashboard meta row: panel count, refresh state, sources, then the save-state
 *  indicator. States facts and carries no title (design D9). */
export function DashboardMetaFacts({
  meta,
  countOnly,
  showSaveState,
  onSaveNow,
}: DashboardMetaFactsProps) {
  const now = useNow(RELATIVE_TIME_TICK_MS);
  const countText = panelCountText(meta.panelCount);
  const sources = countOnly ? null : sourcesText(meta);

  let refresh: { text: string; iso: string | null } | null = null;
  if (!countOnly && meta.refreshState === "never")
    refresh = { text: "not refreshed yet", iso: null };
  if (!countOnly && meta.refreshState === "ran" && meta.refreshedAt !== null) {
    const ago = formatRelativeTime(meta.refreshedAt, now);
    refresh = {
      text: meta.refreshIntent === "danger" ? `last run failed ${ago}` : `refreshed ${ago}`,
      iso: meta.refreshedAt,
    };
  }

  const fullText = [countText, refresh?.text, sources].filter(Boolean).join(" · ");

  return (
    <>
      <p className="dashboard-meta-row__facts" title={fullText}>
        <span className="dashboard-meta-row__fact">{countText}</span>
        {refresh !== null && (
          <span className="dashboard-meta-row__fact dashboard-meta-row__refresh">
            {meta.refreshIntent !== null && (
              <span
                className={`dashboard-meta-row__dot dashboard-meta-row__dot--${meta.refreshIntent}`}
                aria-hidden="true"
              />
            )}
            {refresh.iso !== null ? (
              <time dateTime={refresh.iso} title={new Date(refresh.iso).toLocaleString()}>
                {refresh.text}
              </time>
            ) : (
              refresh.text
            )}
          </span>
        )}
        {sources !== null && <span className="dashboard-meta-row__fact">{sources}</span>}
      </p>
      {showSaveState && <SaveStateIndicator onSaveNow={onSaveNow} />}
    </>
  );
}
