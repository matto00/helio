import { useEffect } from "react";

import { dashboardPipelineFedObserved } from "../../dashboards/state/dashboardsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { feedingOutputIds } from "../state/dashboardMeta";
import { panelsKnownFor } from "../state/panelsSettled";

/** Keeps the selected dashboard's `hasPipelineFedPanels` (HEL-1646) in step with its panels, so the phone skeleton's
 *  reserved refreshed-line slot is right the next time that dashboard loads. An effect over the known panel set covers
 *  every path that sets panels (`fetchPanels`, the HEL-1575 warm restore, duplicate, import) plus in-session create and
 *  delete. It writes only when the panels are KNOWN for the selected dashboard (`panelsKnownFor`), so a loading,
 *  restoring or pre-dispatch frame can never record `false` for a dashboard whose panels are not yet known. */
export function usePipelineFedFlagSync(): void {
  const dispatch = useAppDispatch();
  const selectedDashboardId = useAppSelector((state) => state.dashboards.selectedDashboardId);
  const listed = useAppSelector((state) =>
    state.dashboards.items.find((d) => d.id === state.dashboards.selectedDashboardId),
  );
  const isListed = listed !== undefined;
  const stored = listed?.hasPipelineFedPanels;
  const panels = useAppSelector((state) => state.panels);
  const known = panelsKnownFor(panels, selectedDashboardId);
  const observed = known ? feedingOutputIds(panels.items).length > 0 : null;

  useEffect(() => {
    // A dashboard absent from the list (the public route) has no item to record on.
    if (selectedDashboardId === null || !isListed || observed === null || observed === stored)
      return;
    dispatch(dashboardPipelineFedObserved({ dashboardId: selectedDashboardId, value: observed }));
  }, [dispatch, selectedDashboardId, isListed, observed, stored]);
}
