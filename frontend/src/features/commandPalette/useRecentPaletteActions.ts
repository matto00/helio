import { createElement, useMemo } from "react";
import { useSyncExternalStore } from "react";
import { Database, LayoutDashboard, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useAppSelector } from "../../hooks/reduxHooks";
import { useResourceNavigator, type ResourceRef } from "../../shared/chrome/resourceNavigation";
import { RECENT_SECTION } from "./model/builtInActions";
import { recentHistoryStore, type RecentEntry } from "./model/recentHistoryStore";
import type { CommandAction } from "./model/types";

const KIND_ICON: Record<RecentEntry["kind"], LucideIcon> = {
  dashboard: LayoutDashboard,
  source: Database,
  pipeline: Workflow,
};

/**
 * Resolves a recorded entry's display title.
 *
 * skeptic-final-1.md CR1 — the PERSISTED `entry.title` (set at record time by every recording
 * site — `recentVisitsListeners.ts`, `RecentVisitsRouteObserver.tsx`) is the primary source,
 * precisely so this row renders on ANY route, including `/`, which never fetches
 * `sources`/`pipelines` at all (only `SidebarBody.tsx`'s per-section effect does — the bug this
 * fixes: a lazy-resolve-only design rendered zero source/pipeline rows on the app's own default
 * landing route). Only an entry with NO persisted title (written before this field existed, or
 * — defensively — somehow missing it) falls back to resolving from the live Redux slice, and
 * only that legacy path can return `null` (nothing rendered) when the slice hasn't loaded/
 * resolved yet. This is deliberately NOT a "does it exist" check either way: an entry for a
 * not-yet-fetched kind is neither shown-as-broken nor dropped from storage here —
 * `recentVisitsListeners.ts`'s prune listeners are the only thing that removes an entry, and
 * only once that kind's collection has actually resolved (design.md D4).
 */
function resolveTitle(
  entry: RecentEntry,
  dashboards: { id: string; name: string }[],
  sources: { id: string; name: string }[],
  pipelines: { id: string; name: string }[],
): string | null {
  if (entry.title !== undefined) return entry.title;
  const collection =
    entry.kind === "dashboard" ? dashboards : entry.kind === "source" ? sources : pipelines;
  return collection.find((item) => item.id === entry.id)?.name ?? null;
}

/**
 * design.md D5 — synthesizes the palette's "Recent" section entries. Deliberately NOT registered
 * via `useCommandActions`/the shared registry: these are not registered actions, so they cannot
 * leak into a filtered (non-empty-query) result and "typing leaves recents behind" holds by
 * construction (round-1 CR3) rather than by a `matchesQuery` flag someone must remember to omit.
 * `CommandPalette.tsx` calls this directly and prepends the result only on an empty query.
 */
export function useRecentPaletteActions(): CommandAction[] {
  const navigateToResource = useResourceNavigator();
  const entries = useSyncExternalStore(recentHistoryStore.subscribe, recentHistoryStore.getEntries);
  const dashboards = useAppSelector((state) => state.dashboards.items);
  const sources = useAppSelector((state) => state.sources.items);
  const pipelines = useAppSelector((state) => state.pipelines.items);

  return useMemo(() => {
    const actions: CommandAction[] = [];
    for (const entry of entries) {
      const title = resolveTitle(entry, dashboards, sources, pipelines);
      if (title === null) continue;
      const ref: ResourceRef = { kind: entry.kind, id: entry.id };
      actions.push({
        id: `recent.${entry.kind}.${entry.id}`,
        title,
        section: RECENT_SECTION,
        icon: createElement(KIND_ICON[entry.kind]),
        run: () => navigateToResource(ref),
      });
    }
    return actions;
  }, [entries, dashboards, sources, pipelines, navigateToResource]);
}
