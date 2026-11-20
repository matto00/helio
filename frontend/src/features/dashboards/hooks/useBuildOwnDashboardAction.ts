import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { selectOwnedDashboards } from "../state/dashboardAccess";
import { setSelectedDashboardId } from "../state/dashboardsSlice";

export const BUILD_OWN_DASHBOARD_LABEL = "Build your own dashboard";

export interface BuildOwnDashboardAction {
  label: string;
  /** Closes the open dashboard and lands on `/dashboards`, where the first-run drop zone takes its place. */
  run: () => void;
}

/**
 * HEL-1782 (owner ruling 2): the "Build your own dashboard" entry of the sidebar list and the phone dashboard sheet. It is
 * offered only while the user OWNS no dashboard but has at least one listed (every one shared with them); `null` otherwise,
 * so the entry disappears the moment they own one. Running it navigates to `/dashboards` and clears the selection, which the
 * tabs listener turns into a closed tab, the same path as closing one; `PanelList` then shows the drop zone.
 */
export function useBuildOwnDashboardAction(): BuildOwnDashboardAction | null {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const offered = useAppSelector(
    (state) =>
      state.dashboards.status === "succeeded" &&
      state.dashboards.items.length > 0 &&
      selectOwnedDashboards(state).length === 0,
  );
  const run = useCallback(() => {
    void navigate("/dashboards");
    dispatch(setSelectedDashboardId(null));
  }, [dispatch, navigate]);
  return offered ? { label: BUILD_OWN_DASHBOARD_LABEL, run } : null;
}
