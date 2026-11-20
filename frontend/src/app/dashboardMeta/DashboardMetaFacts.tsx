import { Eye } from "lucide-react";

import { SaveStateIndicator } from "../../shared/chrome/SaveStateIndicator";
import { useNow } from "../../hooks/useNow";
import { ICON_SIZE } from "../../shared/ui/iconSize";
import { RefreshFact, refreshFactOf } from "./RefreshFact";
import type { DashboardMeta } from "../../features/panels/state/dashboardMeta";

/** Relative-time copy is re-rendered at most once a minute (design D2). */
const RELATIVE_TIME_TICK_MS = 60_000;

/** The viewer indicator's copy, shared with the phone meta line. */
export const VIEW_ONLY_TEXT = "View only";

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
  /** HEL-1782: the caller is a viewer of this dashboard; "View only" leads the facts (first, so it survives every tier). */
  viewOnly?: boolean;
  showSaveState: boolean;
  onSaveNow: () => void;
}

/** The facts group of the dashboard meta row: panel count, refresh state, sources, then the save-state
 *  indicator. States facts and carries no title (design D9). */
export function DashboardMetaFacts({
  meta,
  countOnly,
  viewOnly = false,
  showSaveState,
  onSaveNow,
}: DashboardMetaFactsProps) {
  const now = useNow(RELATIVE_TIME_TICK_MS);
  const countText = panelCountText(meta.panelCount);
  const sources = countOnly ? null : sourcesText(meta);

  const refresh = countOnly ? null : refreshFactOf(meta, now);

  const fullText = [viewOnly ? VIEW_ONLY_TEXT : null, countText, refresh?.text, sources]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <p className="dashboard-meta-row__facts" title={fullText}>
        {viewOnly && (
          <span className="dashboard-meta-row__fact dashboard-meta-row__view-only">
            <Eye size={ICON_SIZE.sm} aria-hidden="true" />
            {VIEW_ONLY_TEXT}
          </span>
        )}
        <span className="dashboard-meta-row__fact">{countText}</span>
        {refresh !== null && <RefreshFact fact={refresh} intent={meta.refreshIntent} />}
        {sources !== null && <span className="dashboard-meta-row__fact">{sources}</span>}
      </p>
      {showSaveState && <SaveStateIndicator onSaveNow={onSaveNow} />}
    </>
  );
}
