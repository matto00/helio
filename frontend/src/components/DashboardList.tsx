import { useAppSelector } from "../hooks/reduxHooks";

export function DashboardList() {
  const dashboards = useAppSelector((state) => state.dashboards.items);

  return (
    <section aria-label="dashboards">
      <h2>Dashboards</h2>
      <ul>
        {dashboards.map((dashboard) => (
          <li key={dashboard.id}>{dashboard.name}</li>
        ))}
      </ul>
    </section>
  );
}
