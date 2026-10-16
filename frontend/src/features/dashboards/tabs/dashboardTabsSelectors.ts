import type { RootState } from "../../../store/store";
import { parseInstant } from "./tabTypes";

/** D7 dot rule. An INACTIVE tab is marked when the dashboard's content changed after the later of the
 *  user's last view and their own last write (`contentUpdatedAt > max(lastViewedAt, ownWriteAt)`), OR a
 *  pipeline run produced new data after the last view (`dataUpdatedAt > lastViewedAt`). Own writes never
 *  mask new data. A tab never viewed (null `lastViewedAt`) or without signals is never marked. */
export function selectTabHasChanged(state: RootState, tabId: string): boolean {
  const { tabs, activeId, changeSignals } = state.dashboardTabs;
  if (tabId === activeId) return false;
  const tab = tabs.find((t) => t.id === tabId);
  const signal = changeSignals[tabId];
  if (!tab || !signal) return false;
  const viewed = parseInstant(tab.lastViewedAt);
  if (viewed === null) return false;
  const own = parseInstant(tab.ownWriteAt);
  const content = parseInstant(signal.contentUpdatedAt);
  const data = parseInstant(signal.dataUpdatedAt);
  const contentChanged = content !== null && content > Math.max(viewed, own ?? -Infinity);
  const dataChanged = data !== null && data > viewed;
  return contentChanged || dataChanged;
}

/** The accessible-name suffix a changed tab gets (design D7). */
export const TAB_CHANGED_SUFFIX = ", changed since you last viewed";

export function tabAccessibleName(dashboardName: string, changed: boolean): string {
  return changed ? `${dashboardName}${TAB_CHANGED_SUFFIX}` : dashboardName;
}
