import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { deriveDashboardMetaFromStatus, type DashboardMeta } from "../state/dashboardMeta";
import {
  getPanelStatusSnapshot,
  subscribePanelDataAdvance,
  subscribePanelStatus,
  type PanelStatusItem,
} from "../state/panelStatusStore";
import type { Panel } from "../types/panel";

const NO_UNSUBSCRIBE = () => undefined;

/** The dashboard's panel-status snapshot (HEL-1786), `null` before the first read lands or with no dashboard id. Subscribes
 *  the caller to the shared poller for as long as it is mounted; a `null` id subscribes to nothing and makes no request. */
function usePanelStatusSnapshot(dashboardId: string | null) {
  const subscribe = useCallback(
    (notify: () => void) =>
      dashboardId === null ? NO_UNSUBSCRIBE : subscribePanelStatus(dashboardId, notify),
    [dashboardId],
  );
  const getSnapshot = useCallback(
    () => (dashboardId === null ? null : getPanelStatusSnapshot(dashboardId)),
    [dashboardId],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** The meta row's facts for a dashboard the caller does not own, from the panel-status route (never an Output or pipeline
 *  route). Pass `null` for an owned dashboard: nothing is requested. */
export function useSharedDashboardMeta(
  dashboardId: string | null,
  panels: readonly Panel[],
): DashboardMeta {
  const status = usePanelStatusSnapshot(dashboardId);
  return useMemo(() => deriveDashboardMetaFromStatus(panels, status), [panels, status]);
}

/** One panel's status item, or `undefined` before the first read, for an unresolved panel, or with a `null` dashboard id. */
export function usePanelStatus(
  dashboardId: string | null,
  panelId: string,
): PanelStatusItem | undefined {
  const status = usePanelStatusSnapshot(dashboardId);
  return useMemo(() => status?.items.find((i) => i.panelId === panelId), [status, panelId]);
}

/** Calls `refresh` whenever the panel's stored data advances on the panel-status route (the run-finish refresh of a
 *  dashboard grantee, who cannot subscribe to the pipeline's run events). A `null` dashboard id is a no-op. */
export function usePanelStatusRefresh(
  dashboardId: string | null,
  panelId: string,
  refresh: () => void,
): void {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (dashboardId === null) return undefined;
    return subscribePanelDataAdvance(dashboardId, panelId, () => refreshRef.current());
  }, [dashboardId, panelId]);
}
