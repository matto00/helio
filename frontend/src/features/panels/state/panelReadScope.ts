import { useMemo } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";
import type { RootState } from "../../../store/store";
import { selectDashboardAccessRole } from "../../dashboards/state/dashboardAccess";
import { fetchPublicDistinctValues } from "../../dashboards/services/publicDashboardService";
import { getDistinctValues } from "../../pipelines/services/outputService";
import type { HistorySource } from "../history/useOutputHistory";

// HEL-1780 D1 -- where ONE panel reads its data from. The decision belongs to the panel's OWN dashboard, never to
// whichever dashboard is selected: during a dashboard switch the outgoing panels are still mounted under the new
// selection, and a request made under the wrong role is a refused 404/403.
//
// `output`: the caller owns the panel's dashboard, so the Output routes (`/api/outputs/*`, `/api/pipelines/*`) are
// open to them. `panel`: every other case -- a viewer, an editor, and a dashboard the store does not hold (fail-closed) --
// reads through `/api/dashboards/:id/panels/:panelId/*`, which the dashboard grant alone admits.
export type PanelReadScope =
  | { kind: "output" }
  | { kind: "panel"; dashboardId: string; panelId: string };

const OUTPUT_SCOPE: PanelReadScope = { kind: "output" };

/** The one routing rule, shared by the hooks and by `fetchPanelPage`. Fail-closed: only a dashboard the store holds AND
 *  the caller owns is `output`; an unknown dashboard or role is `panel`. */
export function panelReadScopeFor(
  state: RootState,
  dashboardId: string,
  panelId: string,
): PanelReadScope {
  return selectDashboardAccessRole(state, dashboardId) === "owner"
    ? OUTPUT_SCOPE
    : { kind: "panel", dashboardId, panelId };
}

/** The read scope of one panel, from the panel's own `dashboardId`. */
export function usePanelReadScope(panel: { id: string; dashboardId: string }): PanelReadScope {
  const isOwner = useAppSelector(
    (state) => panelReadScopeFor(state, panel.dashboardId, panel.id).kind === "output",
  );
  const { id, dashboardId } = panel;
  return useMemo(
    () => (isOwner ? OUTPUT_SCOPE : { kind: "panel", dashboardId, panelId: id }),
    [isOwner, dashboardId, id],
  );
}

/** The per-panel history/insight source a `panel`-scope panel hands its renderers (the same shape the public viewer
 *  uses, minus the share token: the signed-in caller is admitted by their dashboard grant). `undefined` in `output` scope. */
export function useHistorySourceFor(scope: PanelReadScope): HistorySource | undefined {
  const dashboardId = scope.kind === "panel" ? scope.dashboardId : null;
  return useMemo(
    () => (dashboardId === null ? undefined : { variant: "public", dashboardId }),
    [dashboardId],
  );
}

/** A dropdown control's option source: the per-panel route (no share token) in `panel` scope, the Output route otherwise.
 *  One fork for the card, the fullscreen overlay and the detail modal. */
export function distinctValuesFetcher(
  scope: PanelReadScope,
  panelId: string,
  outputId: string | null,
): (column: string) => Promise<Array<{ value: string; count: number }>> {
  return (column) => {
    if (!outputId) return Promise.resolve([]);
    return scope.kind === "panel"
      ? fetchPublicDistinctValues(scope.dashboardId, panelId, undefined, column).then(
          (r) => r.values,
        )
      : getDistinctValues(outputId, column).then((r) => r.values);
  };
}
