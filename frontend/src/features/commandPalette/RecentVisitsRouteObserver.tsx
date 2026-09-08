import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { useAppSelector } from "../../hooks/reduxHooks";
import { recentHistoryStore } from "./model/recentHistoryStore";

const SOURCE_DETAIL_PATH = /^\/sources\/([^/]+)$/;
const PIPELINE_DETAIL_PATH = /^\/pipelines\/([^/]+)$/;

/**
 * HEL-519 design.md D2 — sources'/pipelines' half of the "two mechanisms, three kinds, no
 * unifying seam" decision (owner ruling). Dashboards are recorded by a Redux
 * `startAppListening` entry (`recentVisitsListeners.ts`) observing a STATE transition, because
 * the dashboard route (`/`) carries no id. Sources and pipelines DO carry their id in the URL,
 * so the natural, arrival-based observation point for them is the route itself, not Redux state
 * — one route-watching effect matching both detail routes.
 *
 * Deliberately NOT unified with the dashboards mechanism above: an abstraction covering two of
 * the three kinds would be indistinguishable, from the outside, from one covering all three. Two
 * small, separately-auditable mechanisms are the design's explicit choice, not an oversight.
 *
 * Mounted once in `AppShell` (like `GlobalCommandShortcuts`), unconditionally — it observes the
 * route on every navigation, not just ones that pass through the palette or a picker, so a
 * pasted URL, a bookmark, or browser back/forward all record exactly like a click would (task
 * 3.4: the palette's own navigation needs no separate recording call because it also arrives at
 * one of these two routes).
 *
 * skeptic-final-1.md CR1 — persists the resolved title (`recentHistoryStore.ts`'s `RecentEntry`)
 * whenever it's already available in Redux, so the palette can render this row on ANY route
 * (including `/`, which never fetches `sources`/`pipelines` — only `SidebarBody.tsx`'s
 * per-section effect does) without depending on that fetch. On a resource's FIRST-EVER visit the
 * title may not have loaded into `sources.items`/`pipelines.items` YET at the moment this effect
 * first fires (the detail page's own fetch is still in flight) — this effect re-runs as those
 * lists change, so it re-records with the now-resolved title the moment it becomes available,
 * self-healing within the same visit rather than only on the next one.
 */
export function RecentVisitsRouteObserver() {
  const location = useLocation();
  const sources = useAppSelector((state) => state.sources.items);
  const pipelines = useAppSelector((state) => state.pipelines.items);

  useEffect(() => {
    const sourceMatch = SOURCE_DETAIL_PATH.exec(location.pathname);
    if (sourceMatch) {
      const id = sourceMatch[1];
      const title = sources.find((source) => source.id === id)?.name;
      recentHistoryStore.recordVisit("source", id, title);
      return;
    }
    const pipelineMatch = PIPELINE_DETAIL_PATH.exec(location.pathname);
    if (pipelineMatch) {
      const id = pipelineMatch[1];
      const title = pipelines.find((pipeline) => pipeline.id === id)?.name;
      recentHistoryStore.recordVisit("pipeline", id, title);
    }
  }, [location.pathname, sources, pipelines]);

  return null;
}
