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
 *   const { triggerRef, panelRef, isOpen, panelPos, handleOpen, close } = usePortalPopover();
 *
 * Attach triggerRef to the trigger element. Call handleOpen(computePos) with
 * a function that maps the trigger's DOMRect to panel coordinates. Call close()
 * to dismiss. Both handleOpen and close are stable references (useCallback).
 *
 * A document-level keydown listener closes the panel on Escape while it is
 * open — this fires even when focus is inside a portalled panel that sits
 * outside the trigger's DOM subtree — and returns real DOM focus to the
 * trigger (a no-op if the trigger already has it, as with a virtual-focus
 * combobox; load-bearing for a menu that moved real focus into the panel).
 *
 * `panelRef` is optional: attach it to the portalled panel's root element to
 * additionally opt this popover into close-on-focus-leaving-the-popover (e.g.
 * Tab past the last item, or Shift+Tab off the trigger) — a document-level
 * `focusout` listener closes the popover once the newly-focused element is
 * outside both `triggerRef` and `panelRef`. Consumers that don't attach
 * `panelRef` keep the pre-existing behavior (no auto-close on blur) exactly
 * as before — this is opt-in per consumer, not a global default, since a
 * popover with focusable content inside its panel would otherwise close the
 * instant focus moved from the trigger into that content. See
 * `ActionsMenu.tsx` / `Select.tsx` for the wired usage (HEL a11y sweep
 * F-007 / F-048).
 */
export function usePortalPopover<T extends HTMLElement = HTMLButtonElement>() {
  const triggerRef = useRef<T>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PortalPopoverPos | null>(null);

  // Close on Escape regardless of where focus is — portalled panels are outside
  // the trigger's DOM subtree and won't bubble keyboard events through it.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Close when focus leaves the popover entirely (trigger + panel) — e.g. Tab
  // past the last focusable element inside a portalled panel. Only engages
  // once `panelRef` is actually attached to something (see doc comment above).
  useEffect(() => {
    if (!isOpen) return;
    function onFocusOut(event: FocusEvent) {
      if (!panelRef.current) return;
      const next = event.relatedTarget as Node | null;
      // `relatedTarget` is null when focus leaves the document/window
      // entirely (e.g. alt-tab) — don't fight that by closing.
      if (next === null) return;
      const withinTrigger = triggerRef.current?.contains(next) ?? false;
      const withinPanel = panelRef.current.contains(next);
      if (!withinTrigger && !withinPanel) {
        setIsOpen(false);
      }
    }
    document.addEventListener("focusout", onFocusOut);
    return () => document.removeEventListener("focusout", onFocusOut);
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

  return { triggerRef, panelRef, isOpen, panelPos, handleOpen, close };
}
