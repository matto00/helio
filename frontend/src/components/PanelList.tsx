import { useAppSelector } from "../hooks/reduxHooks";

export function PanelList() {
  const selectedDashboardId = useAppSelector((state) => state.dashboards.selectedDashboardId);
  const { items, status, error } = useAppSelector((state) => state.panels);

  return (
    <section aria-label="panels">
      <h2>Panels</h2>
      {status === "loading" ? <p>Loading panels...</p> : null}
      {status === "failed" && error ? <p>{error}</p> : null}
      {status !== "loading" && status !== "failed" && selectedDashboardId === null ? (
        <p>Select a dashboard to view panels.</p>
      ) : null}
      {status === "succeeded" && items.length === 0 ? <p>No panels yet.</p> : null}
      <ul>
        {items.map((panel) => (
          <li key={panel.id}>{panel.title}</li>
        ))}
      </ul>
    </section>
  );
}
