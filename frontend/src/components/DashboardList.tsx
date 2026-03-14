import { setSelectedDashboardId } from "../features/dashboards/dashboardsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";

export function DashboardList() {
  const dispatch = useAppDispatch();
  const { items, selectedDashboardId, status, error } = useAppSelector((state) => state.dashboards);

  return (
    <section aria-label="dashboards">
      <h2>Dashboards</h2>
      {status === "loading" ? <p>Loading dashboards...</p> : null}
      {status === "failed" && error ? <p>{error}</p> : null}
      <ul>
        {items.map((dashboard) => (
          <li key={dashboard.id}>
            <button
              type="button"
              aria-pressed={selectedDashboardId === dashboard.id}
              onClick={() => dispatch(setSelectedDashboardId(dashboard.id))}
            >
              {dashboard.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
