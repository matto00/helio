import "./PanelList.css";
import { PanelGrid } from "./PanelGrid";
import { useAppSelector } from "../hooks/reduxHooks";

export function PanelList() {
  const selectedDashboardId = useAppSelector((state) => state.dashboards.selectedDashboardId);
  const { items, status, error } = useAppSelector((state) => state.panels);

  return (
    <section className="panel-list" aria-label="panels">
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
