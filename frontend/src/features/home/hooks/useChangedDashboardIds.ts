import { useMemo, useSyncExternalStore } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { dashboardSeenStore } from "../../commandPalette/model/dashboardSeenStore";
import { hasChangedSince } from "../../dashboards/tabs/changeRule";

/** The dashboards showing the "changed since your last visit" dot (owner ruling `data-or-edit`): HEL-1575's one pure
 *  comparison (`hasChangedSince`) over the summary's `dashboardChanges` and the per-dashboard view / own-write stamps
 *  (`helio.dashboardSeen`). Not HEL-1575's tab `lastViewedAt`, which stamps tabs that were never displayed (D5).
 *  A dashboard with no view stamp never shows a dot. */
export function useChangedDashboardIds(): ReadonlySet<string> {
  const changes = useAppSelector((state) => state.homeSummary.data?.dashboardChanges);
  const seen = useSyncExternalStore(dashboardSeenStore.subscribe, dashboardSeenStore.getAll);
  return useMemo(() => {
    const changed = new Set<string>();
    for (const change of changes ?? []) {
      const stamps = seen[change.dashboardId];
      if (stamps?.viewedAt === undefined) continue;
      if (hasChangedSince(change, stamps.viewedAt, stamps.ownWriteAt ?? null))
        changed.add(change.dashboardId);
    }
    return changed;
  }, [changes, seen]);
}
