import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { isOverlayOpen, isTypingTarget } from "../../../shared/chrome/shortcuts";
import { selectIsEditingLayout, setEditingLayoutDashboardId } from "../state/layoutHistorySlice";

/** Something that is itself dismissed by Escape and must get the key first: an open menu or popover
 *  (its trigger reports `aria-expanded="true"` and carries `aria-haspopup` or sits in a `.popover`, as the appearance editor does), an open menu/dialog surface, or a native modal. */
function dismissibleSurfaceOpen(): boolean {
  return (
    isOverlayOpen() ||
    document.querySelector(
      '[aria-haspopup][aria-expanded="true"], .popover [aria-expanded="true"], [role="menu"], [role="dialog"]',
    ) !== null
  );
}

/** A grid drag or resize is mid-gesture (React Grid Layout marks the moving item). */
function gestureInProgress(): boolean {
  return document.querySelector(".react-draggable-dragging, .resizing") !== null;
}

/**
 * HEL-1576 design D4: Escape leaves layout edit mode for `dashboardId`. Ignored when focus is in an
 * editable element, when a dialog, popover or menu is open (that surface takes the key), during a drag
 * or resize, and when an inner handler already handled the event (`defaultPrevented`). Leaving edit mode
 * writes nothing: staged changes keep using the normal auto-save, Save now and unmount flush.
 *
 * Not a global shortcut declaration: it only means something while the mode is on, and it is a
 * dismissal of a mode, like the dismissal of the popovers it yields to.
 */
export function useLayoutEditEscape(dashboardId: string | null): void {
  const dispatch = useAppDispatch();
  const isEditing = useAppSelector(selectIsEditingLayout(dashboardId));

  useEffect(() => {
    if (!isEditing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;
      if (dismissibleSurfaceOpen() || gestureInProgress()) return;
      dispatch(setEditingLayoutDashboardId(null));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isEditing, dispatch]);
}
