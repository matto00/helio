import { useEffect, useRef } from "react";

import { pushDragSample, velocityOf, type DragSample } from "./dragVelocity";
import { clearSheetMotion, settleSheet } from "./sheetMotion";

/** Release past this fraction of the sheet's height requests a close. */
export const SHEET_DISMISS_DISTANCE = 0.25;
/** Release faster than this many px/ms (downward) requests a close. */
export const SHEET_DISMISS_VELOCITY = 0.5;

/** Controls that must keep their own taps and focus: a drag never starts on one. */
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [contenteditable="true"]';

/** The sheet's own drag surfaces: the Modal header (which carries the grab handle). The body is never one. */
export const SHEET_SURFACE_SELECTOR = ".ui-modal__header";

interface Drag {
  pointerId: number;
  startY: number;
  surface: HTMLElement;
  samples: DragSample[];
  dy: number;
}

interface UseSheetSwipeOptions {
  /** The sheet element (the dialog); `null` until it mounts. */
  sheet: HTMLElement | null;
  /** Called on a release past the threshold with the sheet's current offset; return `true` when the close is
   *  accepted (the caller then animates the exit), `false` to veto, which springs the sheet back. */
  onDismiss: (offsetPx: number) => boolean;
}

/** Swipe-down gesture for a bottom sheet (HEL-1582, DESIGN.md §10). Pointer events with capture on the sheet's
 *  header surface only: the body always scrolls and never moves the sheet. While dragging the sheet follows the
 *  finger with an inline `translateY` (never negative, no transition); the gesture works at every Motion level
 *  because following the finger is direct manipulation. A release past `SHEET_DISMISS_DISTANCE` of the height or
 *  `SHEET_DISMISS_VELOCITY` asks `onDismiss`; otherwise, or when it is vetoed, or on `pointercancel`, the sheet
 *  settles back and its inline transform is removed. */
export function useSheetSwipe({ sheet, onDismiss }: UseSheetSwipeOptions): void {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (sheet === null) return undefined;
    const target = sheet;
    const surfaces = Array.from(target.querySelectorAll<HTMLElement>(SHEET_SURFACE_SELECTOR));
    let drag: Drag | null = null;

    function onPointerDown(event: PointerEvent) {
      if (drag !== null || !event.isPrimary) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const eventTarget = event.target as Element | null;
      if (eventTarget?.closest(INTERACTIVE)) return;
      const surface = event.currentTarget as HTMLElement;
      drag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        surface,
        samples: [{ t: performance.now(), y: event.clientY }],
        dy: 0,
      };
      surface.setPointerCapture(event.pointerId);
      target.setAttribute("data-sheet-dragging", "");
    }

    function onPointerMove(event: PointerEvent) {
      if (drag === null || event.pointerId !== drag.pointerId) return;
      drag.dy = Math.max(0, event.clientY - drag.startY);
      pushDragSample(drag.samples, { t: performance.now(), y: event.clientY });
      if (drag.dy > 0) target.style.transform = `translateY(${drag.dy}px)`;
      else target.style.removeProperty("transform");
    }

    function end(event: PointerEvent, cancelled: boolean) {
      if (drag === null || event.pointerId !== drag.pointerId) return;
      const finished = drag;
      drag = null;
      if (finished.surface.hasPointerCapture?.(finished.pointerId)) {
        finished.surface.releasePointerCapture(finished.pointerId);
      }
      target.removeAttribute("data-sheet-dragging");
      const height = target.offsetHeight;
      const past =
        !cancelled &&
        finished.dy > 0 &&
        (finished.dy > SHEET_DISMISS_DISTANCE * height ||
          velocityOf(finished.samples) > SHEET_DISMISS_VELOCITY);
      if (past && onDismissRef.current(finished.dy)) return;
      if (finished.dy > 0) settleSheet(target, 0, true);
      else clearSheetMotion(target);
    }

    const onPointerUp = (event: PointerEvent) => end(event, false);
    const onPointerCancel = (event: PointerEvent) => end(event, true);

    for (const surface of surfaces) {
      surface.addEventListener("pointerdown", onPointerDown);
      surface.addEventListener("pointermove", onPointerMove);
      surface.addEventListener("pointerup", onPointerUp);
      surface.addEventListener("pointercancel", onPointerCancel);
    }
    return () => {
      for (const surface of surfaces) {
        surface.removeEventListener("pointerdown", onPointerDown);
        surface.removeEventListener("pointermove", onPointerMove);
        surface.removeEventListener("pointerup", onPointerUp);
        surface.removeEventListener("pointercancel", onPointerCancel);
      }
      target.removeAttribute("data-sheet-dragging");
    };
  }, [sheet]);
}
