import { useDashboardMeta } from "../../features/panels/hooks/useDashboardMeta";
import { feedingOutputIds } from "../../features/panels/state/dashboardMeta";
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
 *  `RefreshFact` markup. Authenticated dashboard view only: the hook reads pipelines, which a public-route viewer cannot,
 *  so the public viewer never mounts this.
 *
 *  Layout stability: the facts arrive after the panels (Output and pipeline fetches), and a line appearing late would
 *  push every card down by its own height. So when the dashboard has pipeline-fed panels (`feedingOutputIds`, known
 *  synchronously from the panels) the slot is reserved from the first paint: an empty `aria-hidden` paragraph with no
 *  placeholder text, whose fixed height (see `DashboardMetaRow.css`) equals the filled line's, so the text fills it with
 *  no shift. If the refresh state then resolves to `unknown` the EMPTY RESERVED SLOT STAYS: collapsing it would be a
 *  second 27px shift after the user has started reading, a worse outcome than a quiet gap. A dashboard with no
 *  pipeline-fed panels never has a slot. */
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
  if (selectedDashboardId === null) return null;
  if (fact === null) {
    return feedingOutputIds(panels).length > 0 ? (
      <p className="dashboard-refresh-line" aria-hidden="true" data-reserved="true" />
    ) : null;
  }
  return (
    <p className="dashboard-refresh-line">
      <RefreshFact fact={fact} intent={meta.refreshIntent} />
    </p>
  );
}
