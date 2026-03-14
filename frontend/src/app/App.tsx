import { DashboardList } from "../components/DashboardList";
import { PanelList } from "../components/PanelList";

export function App() {
  return (
    <main>
      <h1>Helio Dashboard</h1>
      <DashboardList />
      <PanelList />
    </main>
  );
}
