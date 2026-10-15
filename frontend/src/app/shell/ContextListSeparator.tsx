import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import {
  CONTEXT_LIST_KEY_STEP,
  CONTEXT_LIST_KEY_STEP_LARGE,
  CONTEXT_LIST_MAX_WIDTH,
  CONTEXT_LIST_MIN_WIDTH,
  clampContextListWidth,
} from "./contextListLayout";
import type { ContextListLayout } from "./useContextListLayout";

interface ContextListSeparatorProps {
  layout: ContextListLayout;
  /** Accessible name, section-named, e.g. "Resize dashboard list". */
  label: string;
  /** Id of the list element this separator resizes. */
  controlsId: string;
}

/** The context list's resize handle: a WAI-ARIA window splitter (DESIGN.md §9). Arrow Left/Right step 16px (Shift
 *  64px), Home/End jump to the clamps, Enter or a double-click collapses. A pointer drag paints the width as a CSS
 *  variable while moving and commits once on release, so a drag is one preference write, never one per frame. The
 *  hit area is wider than the 1px hairline it draws. */
export function ContextListSeparator({ layout, label, controlsId }: ContextListSeparatorProps) {
  const element = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  function paint(width: number) {
    element.current?.setAttribute("aria-valuenow", String(width));
    layout.previewWidth(width);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? CONTEXT_LIST_KEY_STEP_LARGE : CONTEXT_LIST_KEY_STEP;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = layout.width - step;
    else if (event.key === "ArrowRight") next = layout.width + step;
    else if (event.key === "Home") next = CONTEXT_LIST_MIN_WIDTH;
    else if (event.key === "End") next = CONTEXT_LIST_MAX_WIDTH;
    else if (event.key === "Enter") {
      event.preventDefault();
      layout.toggleCollapsed();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    layout.nudgeWidth(clampContextListWidth(next));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    drag.current = { startX: event.clientX, startWidth: layout.width, width: layout.width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.dataset.dragging = "true";
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current === null) return;
    current.width = clampContextListWidth(current.startWidth + event.clientX - current.startX);
    paint(current.width);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const current = drag.current;
    if (current === null) return;
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (commit && current.width !== current.startWidth) layout.commitWidth(current.width);
    else layout.previewWidth(current.startWidth);
  }

  return (
    <div
      ref={element}
      className="context-list__separator"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controlsId}
      aria-valuenow={layout.width}
      aria-valuemin={CONTEXT_LIST_MIN_WIDTH}
      aria-valuemax={CONTEXT_LIST_MAX_WIDTH}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
      onDoubleClick={layout.toggleCollapsed}
    />
  );
}
