import { setDashboardLayoutLocally } from "../../dashboards/state/dashboardsSlice";
import {
  redoLayout,
  selectRedoLayout,
  selectUndoLayout,
  undoLayout,
} from "../state/layoutHistorySlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { useShortcut } from "../../../shared/chrome/useShortcut";

/**
 * HEL-510 — migrated onto `useShortcut` (design.md Decision 3): this hook is now a pure consumer,
 * owning no `window` listener of its own. The shared `isTypingTarget` guard (applied by
 * `useShortcut` itself, default `allowWhileTyping: false`) replaces the private
 * `isEditableFocused` this file used to carry. `layout-undo`/`layout-redo`'s Shift-exactness
 * (`shortcuts.ts` Decision 2) is what keeps these mutually exclusive; neither sets
 * `guardWhileOverlayOpen`, preserving today's behavior exactly (design.md Decision 4 table).
 */
export function useLayoutUndoRedo(dashboardId: string | null): void {
  const dispatch = useAppDispatch();

  const currentLayout = useAppSelector((state) => {
    if (!dashboardId) return undefined;
    return state.dashboards.items.find((d) => d.id === dashboardId)?.layout;
  });

  const undoTarget = useAppSelector(selectUndoLayout(dashboardId));
  const redoTarget = useAppSelector(selectRedoLayout(dashboardId));

  useShortcut(
    "layout-undo",
    (event) => {
      if (!dashboardId || !undoTarget || !currentLayout) return;
      event.preventDefault();
      dispatch(undoLayout({ dashboardId, currentLayout }));
      dispatch(setDashboardLayoutLocally({ dashboardId, layout: undoTarget }));
    },
    { when: dashboardId !== null },
  );

  useShortcut(
    "layout-redo",
    (event) => {
      if (!dashboardId || !redoTarget || !currentLayout) return;
      event.preventDefault();
      dispatch(redoLayout({ dashboardId, currentLayout }));
      dispatch(setDashboardLayoutLocally({ dashboardId, layout: redoTarget }));
    },
    { when: dashboardId !== null },
  );
}
