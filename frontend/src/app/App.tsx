import { useEffect } from "react";

import "./App.css";
import { DashboardList } from "../components/DashboardList";
import { PanelList } from "../components/PanelList";
import { fetchDashboards } from "../features/dashboards/dashboardsSlice";
import { fetchPanels } from "../features/panels/panelsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { useTheme } from "../theme/ThemeProvider";

export function App() {
  const dispatch = useAppDispatch();
  const { items, selectedDashboardId } = useAppSelector((state) => state.dashboards);
  const { theme, toggleTheme } = useTheme();
  const selectedDashboardName =
    items.find((dashboard) => dashboard.id === selectedDashboardId)?.name ??
    "No dashboard selected";

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
        <div className="app-header__copy">
          <span className="app-header__eyebrow">Helio Workspace</span>
          <h1>Helio Dashboard</h1>
          <p className="app-header__subtitle">
            A polished control surface for tracking the dashboards that matter most.
          </p>
        </div>
        <div className="app-header__controls">
          <div className="app-header__selection-card">
            <span className="app-header__selection-label">Active dashboard</span>
            <strong>{selectedDashboardName}</strong>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            <span className="theme-toggle__label">
              {theme === "dark" ? "Dark mode" : "Light mode"}
            </span>
            <span className="theme-toggle__value">{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
        </div>
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
