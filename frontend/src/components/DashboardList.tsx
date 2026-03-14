import { useAppSelector } from "../hooks/reduxHooks";

export function DashboardList() {
  const { items, status, error } = useAppSelector((state) => state.dashboards);

  return (
    <section aria-label="dashboards">
      <h2>Dashboards</h2>
      {status === "loading" ? <p>Loading dashboards...</p> : null}
      {status === "failed" && error ? <p>{error}</p> : null}
      <ul>
        {items.map((dashboard) => (
          <li key={dashboard.id}>{dashboard.name}</li>
        ))}
      </ul>
    </section>
  );
}
