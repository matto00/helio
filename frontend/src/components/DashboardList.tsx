import "./DashboardList.css";
import { setSelectedDashboardId } from "../features/dashboards/dashboardsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";

interface DashboardListProps {
  onCollapse?: () => void;
}

export function DashboardList({ onCollapse }: DashboardListProps) {
  const dispatch = useAppDispatch();
  const { items, selectedDashboardId, status, error } = useAppSelector((state) => state.dashboards);

  return (
    <section className="dashboard-list" aria-label="dashboards">
      <header className="dashboard-list__header">
        <div className="dashboard-list__header-row">
          <span className="dashboard-list__eyebrow">Navigation</span>
          {onCollapse ? (
            <button
              type="button"
              className="dashboard-list__collapse"
              aria-label="Collapse dashboard list"
              onClick={onCollapse}
            >
              <span aria-hidden="true">⟨</span>
            </button>
          ) : null}
        </div>
        <h2>Dashboards</h2>
        <p>Choose a workspace view and keep the panel content focused on the active dashboard.</p>
      </header>
      {status === "loading" ? (
        <p className="dashboard-list__status">Loading dashboards...</p>
      ) : null}
      {status === "failed" && error ? (
        <p className="dashboard-list__status dashboard-list__status--error">{error}</p>
      ) : null}
      <ul className="dashboard-list__items">
        {items.map((dashboard) => (
          <li key={dashboard.id}>
            <button
              type="button"
              className="dashboard-list__button"
              aria-label={dashboard.name}
              aria-pressed={selectedDashboardId === dashboard.id}
              onClick={() => dispatch(setSelectedDashboardId(dashboard.id))}
            >
              <span className="dashboard-list__name">{dashboard.name}</span>
              <span className="dashboard-list__meta">
                {selectedDashboardId === dashboard.id ? "Active" : "View"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
