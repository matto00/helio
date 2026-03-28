import { useEffect } from "react";

import { setDashboardLayoutLocally } from "../features/dashboards/dashboardsSlice";
import {
  redoLayout,
  selectRedoLayout,
  selectUndoLayout,
  undoLayout,
} from "../features/layout/layoutHistorySlice";
import { useAppDispatch, useAppSelector } from "./reduxHooks";

function isEditableFocused(): boolean {
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useLayoutUndoRedo(dashboardId: string | null): void {
  const dispatch = useAppDispatch();

  const currentLayout = useAppSelector((state) => {
    if (!dashboardId) return undefined;
    return state.dashboards.items.find((d) => d.id === dashboardId)?.layout;
  });

  const undoTarget = useAppSelector(selectUndoLayout(dashboardId));
  const redoTarget = useAppSelector(selectRedoLayout(dashboardId));

  useEffect(() => {
    if (!dashboardId) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (!dashboardId) return;
      if (isEditableFocused()) return;

      const isUndo = (event.metaKey || event.ctrlKey) && event.key === "z" && !event.shiftKey;
      const isRedo = (event.metaKey || event.ctrlKey) && event.key === "z" && event.shiftKey;

      if (isUndo && undoTarget && currentLayout) {
        event.preventDefault();
        dispatch(undoLayout({ dashboardId, currentLayout }));
        dispatch(setDashboardLayoutLocally({ dashboardId, layout: undoTarget }));
      } else if (isRedo && redoTarget && currentLayout) {
        event.preventDefault();
        dispatch(redoLayout({ dashboardId, currentLayout }));
        dispatch(setDashboardLayoutLocally({ dashboardId, layout: redoTarget }));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dashboardId, dispatch, currentLayout, undoTarget, redoTarget]);
}
