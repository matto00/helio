import { useCallback, useEffect, useRef, useState } from "react";

export type PortalPopoverPos = {
  top: number;
  right?: number;
  left?: number;
  width?: number;
};

/** Encapsulates trigger ref, open/close state, and panel position calculation
 * for portal-rendered popovers. All popover components use this hook to avoid
 * duplicating the trigger-ref + getBoundingClientRect() pattern inline.
 *
 * Usage:
 *   const { triggerRef, isOpen, panelPos, handleOpen, close } = usePortalPopover();
 *
 * Attach triggerRef to the trigger element. Call handleOpen(computePos) with
 * a function that maps the trigger's DOMRect to panel coordinates. Call close()
 * to dismiss. Both handleOpen and close are stable references (useCallback).
 *
 * A document-level keydown listener closes the panel on Escape while it is
 * open — this fires even when focus is inside a portalled panel that sits
 * outside the trigger's DOM subtree.
 */
export function usePortalPopover<T extends HTMLElement = HTMLButtonElement>() {
  const triggerRef = useRef<T>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PortalPopoverPos | null>(null);

  // Close on Escape regardless of where focus is — portalled panels are outside
  // the trigger's DOM subtree and won't bubble keyboard events through it.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  /** Reads the trigger element's bounding rect, calls computePos to derive
   * panel coordinates, and transitions to the open state. */
  const handleOpen = useCallback((computePos: (rect: DOMRect) => PortalPopoverPos) => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPanelPos(computePos(rect));
    }
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return { triggerRef, isOpen, panelPos, handleOpen, close };
}
