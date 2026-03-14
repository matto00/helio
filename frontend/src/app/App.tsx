import { useEffect } from "react";

import { DashboardList } from "../components/DashboardList";
import { PanelList } from "../components/PanelList";
import { fetchDashboards } from "../features/dashboards/dashboardsSlice";
import { fetchPanels } from "../features/panels/panelsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";

export function App() {
  const dispatch = useAppDispatch();
  const selectedDashboardId = useAppSelector((state) => state.dashboards.selectedDashboardId);

  useEffect(() => {
    void dispatch(fetchDashboards());
  }, [dispatch]);

  useEffect(() => {
    if (selectedDashboardId === null) {
      return;
    }

    void dispatch(fetchPanels(selectedDashboardId));
  }, [dispatch, selectedDashboardId]);

  return (
    <main>
      <h1>Helio Dashboard</h1>
      <DashboardList />
      <PanelList />
    </main>
  );
}
