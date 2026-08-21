import { Plus } from "lucide-react";

import { setPanelCreationModalOpen } from "../state/panelsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import type { EmptyStateCta } from "../../../shared/ui/EmptyState";

export interface CreateActionResult {
  cta: EmptyStateCta;
  error: string | null;
  isPending: boolean;
}

/** HEL-548 D4b/D5/D5a/D5b — the "Add panel" create-action seam. A pure flag
 *  flip: `PanelCreationModal` owns its own submission, so this action can
 *  neither fail nor go in flight.
 *
 *  Precondition (workspace-create-actions spec): with no dashboard selected
 *  there is nothing to add a panel to, so the descriptor is `disabled` and
 *  its `onClick` is a no-op — the same "unavailable" behavior the flag had
 *  as local `useState`, preserved across the D5a lift into Redux.
 *
 *  Reach (D4b/D5b): `PanelCreationModal` is mounted only by `PanelList`
 *  (route `/`), not at the shell — this action is usable only from there
 *  today. The flag it sets is reset on `PanelList` unmount (see that
 *  component's cleanup effect, D5a) so it cannot re-open the modal on a
 *  later, unrelated visit to `/`. */
export function useCreatePanelAction(): CreateActionResult {
  const dispatch = useAppDispatch();
  const selectedDashboardId = useAppSelector((state) => state.dashboards.selectedDashboardId);
  const disabled = selectedDashboardId === null;

  return {
    cta: {
      label: "Add panel",
      icon: <Plus />,
      disabled,
      onClick: () => {
        if (disabled) return;
        dispatch(setPanelCreationModalOpen(true));
      },
    },
    error: null,
    isPending: false,
  };
}
