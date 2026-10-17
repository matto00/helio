import { useDashboardMeta } from "../../features/panels/hooks/useDashboardMeta";
import type { Panel } from "../../features/panels/types/panel";
import { useAppSelector } from "../../hooks/reduxHooks";
import { useNow } from "../../hooks/useNow";
import { RefreshFact, refreshFactOf } from "./RefreshFact";
import "./DashboardMetaRow.css";

const NO_PANELS: Panel[] = [];
/** Relative-time copy is re-rendered at most once a minute (same cadence as the desktop meta row). */
const RELATIVE_TIME_TICK_MS = 60_000;

/** The phone "refreshed" caption (HEL-1583 D11): the first child of `.panel-list`, above the dashboard chip row. It
 *  says exactly what the desktop meta row's refresh fact says, from the same `useDashboardMeta` inputs and the same
 *  `RefreshFact` markup, and renders nothing for an unknown refresh state. Authenticated dashboard view only: the hook
 *  reads pipelines, which a public-route viewer cannot, so the public viewer never mounts this. */
export function DashboardRefreshLine() {
  const selectedDashboardId = useAppSelector((state) => state.dashboards.selectedDashboardId);
  const panels = useAppSelector((state) =>
    state.panels.loadedDashboardId === state.dashboards.selectedDashboardId &&
    state.dashboards.selectedDashboardId !== null
      ? state.panels.items
      : NO_PANELS,
  );
  const meta = useDashboardMeta(selectedDashboardId, panels);
  const now = useNow(RELATIVE_TIME_TICK_MS);
  const fact = refreshFactOf(meta, now);
  if (selectedDashboardId === null || fact === null) return null;
  return (
    <p className="dashboard-refresh-line">
      <RefreshFact fact={fact} intent={meta.refreshIntent} />
    </p>
  );
}
