import { RotateCw } from "lucide-react";

import { useDashboardMeta } from "../../features/panels/hooks/useDashboardMeta";
import { feedingOutputIds } from "../../features/panels/state/dashboardMeta";
import { panelsKnownFor } from "../../features/panels/state/panelsSettled";
import type { Panel } from "../../features/panels/types/panel";
import { usePullRefreshControl } from "../../features/panels/ui/grid/pullRefreshRegistry";
import { useAppSelector } from "../../hooks/reduxHooks";
import { useNow } from "../../hooks/useNow";
import { ICON_SIZE } from "../../shared/ui/iconSize";
import { Spinner } from "../../shared/ui/Spinner";
import { RefreshFact, refreshFactOf } from "./RefreshFact";
import "./DashboardMetaRow.css";

const NO_PANELS: Panel[] = [];
/** Relative-time copy is re-rendered at most once a minute (same cadence as the desktop meta row). */
const RELATIVE_TIME_TICK_MS = 60_000;

/** The "Refresh dashboard" button (HEL-1681): the visible single-pointer / keyboard alternative to the pull (WCAG 2.5.1).
 *  It shares the pull's registry, so it fans out the same once-per-output-bound-panel refresh, runs no pipeline and shares
 *  the busy state. Rendered only while an output-bound panel is registered. `aria-disabled`, not `disabled`, while busy so
 *  keyboard focus survives the round. Hand-rolled icon-only control under DESIGN.md §5's documented sub-24px exception:
 *  `IconButton`'s smallest size (24px) is taller than this line's fixed slot and would push the cards down (HEL-1646); it
 *  still carries both `aria-label` and `title`, and reaches the 44px floor by a hit expander (`DashboardMetaRow.css`). */
function RefreshButton() {
  const control = usePullRefreshControl();
  if (control === null || !control.available) return null;
  return (
    <button
      type="button"
      className="dashboard-refresh-line__button"
      aria-label="Refresh dashboard"
      title="Refresh dashboard"
      aria-disabled={control.busy ? "true" : undefined}
      onClick={control.refresh}
    >
      {control.busy ? <Spinner size="sm" /> : <RotateCw size={ICON_SIZE.sm} aria-hidden="true" />}
    </button>
  );
}

/** The phone "refreshed" caption (HEL-1583 D11): the first child of `.panel-list`, above the dashboard chip row. It
 *  says exactly what the desktop meta row's refresh fact says, from the same `useDashboardMeta` inputs and the same
 *  `RefreshFact` markup. Authenticated dashboard view only: the hook reads pipelines, which a public-route viewer cannot,
 *  so the public viewer never mounts this.
 *
 *  Layout stability: the facts arrive after the panels (Output and pipeline fetches), and a line appearing late would
 *  push every card down by its own height. So when the dashboard has pipeline-fed panels the slot is reserved from the
 *  first paint. Once the panels are known for the dashboard they decide (`feedingOutputIds`); before that (the skeleton,
 *  a restore, the pre-dispatch frame) the dashboard list's `hasPipelineFedPanels` decides, so the placeholders sit
 *  where the real cards will land (HEL-1646). The slot is: an empty `aria-hidden` paragraph with no
 *  placeholder text, whose fixed height (see `DashboardMetaRow.css`) equals the filled line's, so the text fills it with
 *  no shift. If the refresh state then resolves to `unknown` the EMPTY RESERVED SLOT STAYS: collapsing it would be a
 *  second 27px shift after the user has started reading, a worse outcome than a quiet gap. A dashboard with no
 *  pipeline-fed panels never has a slot. */
export function DashboardRefreshLine() {
  const selectedDashboardId = useAppSelector((state) => state.dashboards.selectedDashboardId);
  // Only panels KNOWN for the selected dashboard count (HEL-1646): `fetchPanels.pending` marks the dashboard loaded
  // while `items` is still `[]` or the previous dashboard's panels, so reading `items` then is wrong both ways.
  const panels = useAppSelector((state) =>
    panelsKnownFor(state.panels, state.dashboards.selectedDashboardId)
      ? state.panels.items
      : NO_PANELS,
  );
  const panelsKnown = useAppSelector((state) =>
    panelsKnownFor(state.panels, state.dashboards.selectedDashboardId),
  );
  const listedPipelineFed = useAppSelector(
    (state) =>
      state.dashboards.items.find((d) => d.id === state.dashboards.selectedDashboardId)
        ?.hasPipelineFedPanels === true,
  );
  const meta = useDashboardMeta(selectedDashboardId, panels);
  const now = useNow(RELATIVE_TIME_TICK_MS);
  const fact = refreshFactOf(meta, now);
  if (selectedDashboardId === null) return null;
  if (fact === null) {
    const pipelineFed = panelsKnown ? feedingOutputIds(panels).length > 0 : listedPipelineFed;
    // The empty text span is the `aria-hidden` part (not the whole line), so the button stays exposed.
    return pipelineFed ? (
      <p className="dashboard-refresh-line" data-reserved="true">
        <span className="dashboard-refresh-line__text" aria-hidden="true" />
        <RefreshButton />
      </p>
    ) : null;
  }
  return (
    <p className="dashboard-refresh-line">
      <span className="dashboard-refresh-line__text">
        <RefreshFact fact={fact} intent={meta.refreshIntent} />
      </span>
      <RefreshButton />
    </p>
  );
}
