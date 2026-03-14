import type { CSSProperties } from "react";

import "./PanelList.css";
import { PanelGrid } from "./PanelGrid";
import { useAppSelector } from "../hooks/reduxHooks";
import { resolveDashboardGridBackground } from "../theme/appearance";
import { useTheme } from "../theme/ThemeProvider";

export function PanelList() {
  const { theme } = useTheme();
  const { items: dashboards, selectedDashboardId } = useAppSelector((state) => state.dashboards);
  const { items, status, error } = useAppSelector((state) => state.panels);
  const selectedDashboard =
    dashboards.find((dashboard) => dashboard.id === selectedDashboardId) ?? null;

  return (
    <section
      className="panel-list"
      aria-label="panels"
      style={
        selectedDashboard?.appearance.gridBackground &&
        selectedDashboard.appearance.gridBackground !== "transparent"
          ? ({
              "--dashboard-grid-background-override": resolveDashboardGridBackground(
                theme,
                selectedDashboard.appearance,
              ),
            } as CSSProperties)
          : undefined
      }
    >
      <header className="panel-list__header">
        <h2>Panels</h2>
        <span className="panel-list__count">
          {items.length} panel{items.length === 1 ? "" : "s"}
        </span>
      </header>
      {status === "loading" ? <p className="panel-list__state">Loading panels...</p> : null}
      {status === "failed" && error ? (
        <p className="panel-list__state panel-list__state--error">{error}</p>
      ) : null}
      {status !== "loading" && status !== "failed" && selectedDashboardId === null ? (
        <p className="panel-list__state">Select a dashboard to view panels.</p>
      ) : null}
      {status === "succeeded" && items.length === 0 ? (
        <p className="panel-list__state">No panels yet.</p>
      ) : null}
      {items.length > 0 ? <PanelGrid key={selectedDashboardId ?? "panels"} panels={items} /> : null}
    </section>
  );
}
