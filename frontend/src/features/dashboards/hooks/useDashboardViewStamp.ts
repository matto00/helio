import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { dashboardSeenStore } from "../../commandPalette/model/dashboardSeenStore";
import { serverNowMs } from "../tabs/serverClock";

/**
 * HEL-1578 design D5 — stamps `viewedAt` (server time) for the dashboard the dashboard view actually DISPLAYS, and
 * for no other: not a dashboard that is merely selected, auto-selected at boot, or restored as a tab.
 *
 * - On `/dashboards/:id` the displayed dashboard is the selected one once the selection has matched the route id
 *   (`DashboardRoute`'s effect runs after this component's first render). From then on it is the SELECTED id, so
 *   a sidebar or palette switch while the URL still names X stamps Z, not X (skeptic r5, C5).
 * - On `/dashboards` it is the selected id once that dashboard's panels have rendered (loaded for that id).
 *
 * The stamp is written when the displayed id appears, again when it changes (for the one being left) and on
 * unmount and `pagehide`, so time spent viewing is what the "changed since your last visit" dot compares against.
 */
export function useDashboardViewStamp(): void {
  const { id: routeId } = useParams();
  const selectedId = useAppSelector((state) => state.dashboards.selectedDashboardId);
  const dashboardIds = useAppSelector((state) => state.dashboards.items);
  const panelsLoadedFor = useAppSelector((state) => state.panels.loadedDashboardId);
  const panelsStatus = useAppSelector((state) => state.panels.status);

  // Latched once the selection has matched the route id; a different route id starts unmatched again. Derived
  // state set during render (React's documented pattern), not in an effect, so the first matching render counts.
  const [matchedRouteId, setMatchedRouteId] = useState<string | null>(null);
  if (routeId !== undefined && selectedId === routeId && matchedRouteId !== routeId) {
    setMatchedRouteId(routeId);
  }
  const matched = routeId !== undefined && (matchedRouteId === routeId || selectedId === routeId);

  const exists =
    selectedId !== null && dashboardIds.some((dashboard) => dashboard.id === selectedId);
  let displayedId: string | null = null;
  if (routeId !== undefined) {
    if (matched && exists) displayedId = selectedId;
  } else if (exists && panelsLoadedFor === selectedId && panelsStatus === "succeeded") {
    displayedId = selectedId;
  }

  useEffect(() => {
    if (displayedId === null) return;
    const stamp = () => dashboardSeenStore.recordViewed(displayedId, serverNowMs());
    stamp();
    window.addEventListener("pagehide", stamp);
    return () => {
      window.removeEventListener("pagehide", stamp);
      stamp();
    };
  }, [displayedId]);
}
