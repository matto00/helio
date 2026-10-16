import { createElement, useMemo } from "react";
import { LayoutDashboard } from "lucide-react";

import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { openTabActivate } from "../dashboards/tabs/dashboardTabsSlice";
import { useCommandQuery } from "./hooks";
import { SEARCH_SECTION } from "./model/builtInActions";
import { titleMatchRank } from "./model/ranking";
import type { CommandAction } from "./model/types";

/** HEL-1575 D11: the palette's "open in a new tab" results. Every dashboard when the query is empty (the
 *  list is already most-recently-updated first), else the title matches ranked by the existing
 *  prefix > substring > subsequence tiers. A result adds the dashboard as a new active tab after the active
 *  one (or activates it if it is already open). Dashboards only: there is no cap, because this mode is a
 *  picker, not a search over four kinds. */
export function useOpenTabActions(enabled: boolean): CommandAction[] {
  const dispatch = useAppDispatch();
  const query = useCommandQuery();
  const dashboards = useAppSelector((state) => state.dashboards.items);

  return useMemo(() => {
    if (!enabled) return [];
    const trimmed = query.trim().toLowerCase();
    const ranked = dashboards
      .map((dashboard, index) => ({
        dashboard,
        index,
        rank: trimmed === "" ? 0 : titleMatchRank(dashboard.name, trimmed),
      }))
      .filter((entry): entry is typeof entry & { rank: number } => entry.rank !== undefined)
      .sort((a, b) => a.rank - b.rank || a.index - b.index);
    return ranked.map(({ dashboard }) => ({
      id: `open-tab.${dashboard.id}`,
      title: dashboard.name,
      section: SEARCH_SECTION,
      icon: createElement(LayoutDashboard),
      matchesQuery: true,
      run: () => {
        dispatch(openTabActivate(dashboard.id));
      },
    }));
  }, [enabled, query, dashboards, dispatch]);
}
