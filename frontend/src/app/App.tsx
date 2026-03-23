import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";

import "./App.css";
import { DashboardAppearanceEditor } from "../components/DashboardAppearanceEditor";
import { DashboardList } from "../components/DashboardList";
import { PanelList } from "../components/PanelList";
import { SourcesPage } from "../components/SourcesPage";
import { fetchDashboards } from "../features/dashboards/dashboardsSlice";
import { fetchPanels } from "../features/panels/panelsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { resolveDashboardBackground } from "../theme/appearance";
import { useTheme } from "../theme/ThemeProvider";

export function App() {
  const dispatch = useAppDispatch();
  const { items, selectedDashboardId } = useAppSelector((state) => state.dashboards);
  const { theme, toggleTheme } = useTheme();
  const [isDashboardListCollapsed, setIsDashboardListCollapsed] = useState(false);
  const location = useLocation();
  const onDashboardView = location.pathname === "/";
  const selectedDashboard = items.find((dashboard) => dashboard.id === selectedDashboardId) ?? null;
  const selectedDashboardName = selectedDashboard?.name ?? "No dashboard selected";

  useEffect(() => {
    void dispatch(fetchDashboards());
  }, [dispatch]);

  useEffect(() => {
    if (selectedDashboardId === null) {
      return;
    }

    void dispatch(fetchPanels(selectedDashboardId));
  }, [dispatch, selectedDashboardId]);

  const shellStyle =
    onDashboardView &&
    selectedDashboard !== null &&
    selectedDashboard.appearance.background !== "transparent"
      ? ({
          "--dashboard-background-override": resolveDashboardBackground(
            theme,
            selectedDashboard.appearance,
          ),
        } as CSSProperties)
      : undefined;

  return (
    <main className="app-shell" style={shellStyle}>
      <header className="app-header">
        <div className="app-header__copy">
          <span className="app-header__eyebrow">Helio Workspace</span>
          <h1>Helio Dashboard</h1>
          <p className="app-header__subtitle">
            A polished control surface for tracking the dashboards that matter most.
          </p>
        </div>
        <div className="app-header__controls">
          {onDashboardView && (
            <div className="app-header__selection-card">
              <span className="app-header__selection-label">Active dashboard</span>
              <strong>{selectedDashboardName}</strong>
            </div>
          )}
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
          {onDashboardView && <DashboardAppearanceEditor dashboard={selectedDashboard} />}
        </div>
      </header>
      <div
        className={
          isDashboardListCollapsed ? "app-layout app-layout--sidebar-collapsed" : "app-layout"
        }
      >
        {isDashboardListCollapsed ? (
          <button
            type="button"
            className="app-layout__sidebar-toggle"
            aria-label="Expand dashboard list"
            onClick={() => setIsDashboardListCollapsed(false)}
          >
            <span aria-hidden="true">⟩</span>
          </button>
        ) : (
          <aside className="app-sidebar">
            <nav className="app-sidebar__nav" aria-label="Main navigation">
              <NavLink to="/" end className="app-sidebar__nav-link">
                Dashboards
              </NavLink>
              <NavLink to="/sources" className="app-sidebar__nav-link">
                Data Sources
              </NavLink>
            </nav>
            <DashboardList onCollapse={() => setIsDashboardListCollapsed(true)} />
          </aside>
        )}
        <section className="app-content">
          <Routes>
            <Route path="/" element={<PanelList />} />
            <Route path="/sources" element={<SourcesPage />} />
          </Routes>
        </section>
      </div>
    </main>
  );
}
