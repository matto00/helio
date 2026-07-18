import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";

import "./MobileNavSheet.css";
import { useOverlay } from "./OverlayProvider";

export interface MobileNavSheetItem {
  id: string;
  name: string;
  isActive: boolean;
  /** Optional secondary line under the name (Type Registry "Pipeline: <name>"
   * provenance, HEL-270). Other sections leave it unset and render name-only,
   * matching the desktop sidebar's `SidebarItem.subtitle`. */
  subtitle?: string;
}

interface MobileNavSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  items: MobileNavSheetItem[];
  onSelect: (item: MobileNavSheetItem) => void;
  /** Shown instead of the list when `items` is empty — every section must be
   * a picker, never a dead end (see mobile-pwa-handoff.md §W3.3). */
  emptyMessage?: string;
}

const DRAG_DISMISS_THRESHOLD_PX = 80;

/**
 * Generic bottom-sheet picker, portalled to `document.body`. Reused for both
 * the dashboard switcher and (later) section-item navigation — one overlay
 * mechanism, not two, per `notes/mobile-pwa-handoff.md` §W3.2/§W3.3.
 *
 * Registers with `useOverlay` for single-active-overlay + Escape semantics;
 * dismisses on backdrop tap, Escape, or a downward swipe past the threshold.
 */
export function MobileNavSheet({
  open,
  onClose,
  title,
  items,
  onSelect,
  emptyMessage = "Nothing here yet.",
}: MobileNavSheetProps) {
  const overlay = useOverlay();
  const [dragY, setDragY] = useState(0);
  const draggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  // Tracks whether `overlay.isActive` has actually become true for THIS open
  // session. Needed because `overlay.open()` (called below) updates shared
  // context state asynchronously: on the very render where `open` flips
  // true, `overlay.isActive` is still stale (false) from before the call.
  // Without this guard, the "external close" effect below would misread
  // that one-render staleness as an external dismissal and call `onClose()`
  // immediately — most visible when a consumer ever mounts the sheet with
  // `open` already `true` (e.g. a controlled test, or a future caller),
  // rather than always mounting closed and flipping `open` true later.
  const wasActiveRef = useRef(false);

  useEffect(() => {
    if (open) {
      overlay.open();
    } else {
      overlay.close();
      setDragY(0);
      wasActiveRef.current = false;
    }
    // overlay.open/close are stable (useCallback), but re-running this effect
    // only on `open` changing is the intent here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (overlay.isActive) {
      wasActiveRef.current = true;
      return;
    }
    // The global Escape handler in OverlayProvider clears activeId directly;
    // when that happens while we're still "open" per our prop — and we had
    // actually become the active overlay at some point — tell the parent to
    // close so controlled state stays in sync. The `wasActiveRef` guard is
    // what prevents the stale-first-render false positive described above.
    if (open && wasActiveRef.current) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay.isActive]);

  if (!open) return null;

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    dragStartYRef.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const delta = event.clientY - dragStartYRef.current;
    setDragY(Math.max(0, delta));
  }

  function handlePointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragY > DRAG_DISMISS_THRESHOLD_PX) {
      onClose();
      return;
    }
    setDragY(0);
  }

  // Dynamic, user-driven drag position — the DESIGN.md inline-style exception
  // for gesture-following geometry.
  const panelStyle: CSSProperties | undefined =
    dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined;

  return createPortal(
    <>
      <button
        type="button"
        className="mobile-nav-sheet__backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="mobile-nav-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={panelStyle}
      >
        <div
          className="mobile-nav-sheet__drag-handle"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <span className="mobile-nav-sheet__grabber" aria-hidden="true" />
          <h2 className="mobile-nav-sheet__title">{title}</h2>
        </div>
        {items.length === 0 ? (
          <p className="mobile-nav-sheet__empty">{emptyMessage}</p>
        ) : (
          <ul className="mobile-nav-sheet__list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={
                    item.isActive
                      ? "mobile-nav-sheet__item mobile-nav-sheet__item--active"
                      : "mobile-nav-sheet__item"
                  }
                  aria-pressed={item.isActive}
                  onClick={() => {
                    onSelect(item);
                    onClose();
                  }}
                >
                  <span className="mobile-nav-sheet__item-text">
                    <span className="mobile-nav-sheet__item-name">{item.name}</span>
                    {item.subtitle !== undefined && (
                      <span className="mobile-nav-sheet__item-subtitle">{item.subtitle}</span>
                    )}
                  </span>
                  {item.isActive && (
                    <span className="mobile-nav-sheet__active-dot" aria-label="Current" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>,
    document.body,
  );
}
