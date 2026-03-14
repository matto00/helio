import { useEffect } from "react";

import "./App.css";
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
    <main className="app-shell">
      <header className="app-header">
        <h1>Helio Dashboard</h1>
      </header>
      <div className="app-layout">
        <aside className="app-sidebar">
          <DashboardList />
        </aside>
        <section className="app-content">
          <PanelList />
        </section>
      </div>
    </main>
  );
}
