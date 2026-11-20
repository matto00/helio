import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { selectCanEditDashboard } from "../../dashboards/state/dashboardAccess";
import { useShortcut } from "../../../shared/chrome/useShortcut";
import { applyLayoutRedo, applyLayoutUndo } from "../state/layoutHistoryThunks";

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
  // HEL-1782: a caller who cannot edit the dashboard (a viewer, or an editor downgraded mid-session who still has layout
  // history for it) claims neither shortcut, so the keystroke is never swallowed and no layout change is staged for a save
  // the server refuses.
  const canEdit = useAppSelector((state) => selectCanEditDashboard(state, dashboardId));
  const enabled = dashboardId !== null && canEdit;

  // HEL-1230: traversal lives in one place (`layoutHistoryThunks`); the thunk reads live state, so
  // `preventDefault` is called only when it actually applied something.
  useShortcut(
    "layout-undo",
    (event) => {
      if (dashboardId && dispatch(applyLayoutUndo(dashboardId))) event.preventDefault();
    },
    { when: enabled },
  );

  useShortcut(
    "layout-redo",
    (event) => {
      if (dashboardId && dispatch(applyLayoutRedo(dashboardId))) event.preventDefault();
    },
    { when: enabled },
  );
}
