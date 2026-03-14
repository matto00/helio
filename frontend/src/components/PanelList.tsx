import { useAppSelector } from "../hooks/reduxHooks";

export function PanelList() {
  const panels = useAppSelector((state) => state.panels.items);

  return (
    <section aria-label="panels">
      <h2>Panels</h2>
      {panels.length === 0 ? <p>No panels yet.</p> : null}
      <ul>
        {panels.map((panel) => (
          <li key={panel.id}>{panel.title}</li>
        ))}
      </ul>
    </section>
  );
}
