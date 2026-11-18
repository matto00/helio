import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { VIEWPORT_MARGIN } from "../shared/ui/panelFit";

export type PortalPopoverPos = {
  /** Distance from the viewport top. Mutually exclusive with `bottom` in
   *  practice (a consumer's `computePos` sets one or the other depending on
   *  which side of the trigger it opens toward) — both optional so a
   *  `bottom`-anchored ("opens upward") panel can omit `top` entirely rather
   *  than pass a value that would be ignored. See `ActionsMenu`'s `align`
   *  prop for the consumer-facing choice (HEL-719 scope amendment). */
  top?: number;
  /** Distance from the viewport bottom — for a panel anchored above its
   *  trigger instead of below it. */
  bottom?: number;
  right?: number;
  left?: number;
  width?: number;
  /** Caps the panel's height to the room on the side it opens toward (HEL-1582). */
  maxHeight?: number;
};

/** An opt-in placement function (HEL-1668): called once the panel is mounted and its real size is measurable, and again on
 *  window resize, with the mounted panel and the trigger's current rect. */
export type PortalPopoverPlace = (panel: HTMLElement, triggerRect: DOMRect) => PortalPopoverPos;

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
 * F-007 / F-048). When that focus-out starts INSIDE the panel and was caused by a
 * keyboard Tab / Shift+Tab, real focus also returns to the trigger (HEL-1759);
 * a pointer move, or focus leaving from the trigger itself, only closes.
 */
export function usePortalPopover<T extends HTMLElement = HTMLButtonElement>(options?: {
  /** Opts into measured placement: the panel renders `visibility: hidden` (`placed` false) until the first placement,
   *  so there is no flash. Consumers that do not pass it keep the `computePos` path untouched. */
  place?: PortalPopoverPlace;
}) {
  const place = options?.place;
  const placeRef = useRef(place);
  const opted = options?.place !== undefined;
  const [placedState, setPlaced] = useState(false);
  const triggerRef = useRef<T>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PortalPopoverPos | null>(null);
  /** True from a Tab keydown until the focus move it causes (cleared by any other key, a pointerdown, each focusout and on
   *  close), so only a keyboard Tab out of the panel returns focus to the trigger (HEL-1759). */
  const tabbingRef = useRef(false);
  /** Guards the viewport clamp below against re-measuring its own output. */
  const hasClampedRef = useRef(false);

  // Close on Escape regardless of where focus is — portalled panels are outside
  // the trigger's DOM subtree and won't bubble keyboard events through it.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Escape closes this popover only: preventDefault suppresses an enclosing modal <dialog>'s native `cancel`
        // (HEL-1668). Deliberately not stopPropagation, which would also hide Escape from window-level handlers.
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Track a keyboard Tab (HEL-1759). Capture phase, so a descendant or ancestor that stops propagation cannot hide it.
  useEffect(() => {
    if (!isOpen) return;
    let expire: ReturnType<typeof setTimeout> | undefined;
    function onKeyDown(event: KeyboardEvent) {
      clearTimeout(expire);
      tabbingRef.current = event.key === "Tab";
      // Tab's focus move is the keydown's default action, which runs in the same task as the dispatch, before any timer;
      // so a flag still set after one timer tick belongs to a Tab that moved no focus (cancelled, or at the document end).
      // (A microtask would be too early: it runs between the listeners and that default action.)
      if (tabbingRef.current) expire = setTimeout(() => (tabbingRef.current = false), 0);
    }
    function onPointerDown() {
      tabbingRef.current = false;
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      clearTimeout(expire);
      tabbingRef.current = false;
    };
  }, [isOpen]);

  // Close when focus leaves the popover entirely (trigger + panel) — e.g. Tab
  // past the last focusable element inside a portalled panel. Only engages
  // once `panelRef` is actually attached to something (see doc comment above).
  useEffect(() => {
    if (!isOpen) return;
    function onFocusOut(event: FocusEvent) {
      const viaTab = tabbingRef.current;
      tabbingRef.current = false;
      if (!panelRef.current) return;
      const next = event.relatedTarget as Node | null;
      // `relatedTarget` is null when focus leaves the document/window
      // entirely (e.g. alt-tab) — don't fight that by closing.
      if (next === null) return;
      const withinTrigger = triggerRef.current?.contains(next) ?? false;
      const withinPanel = panelRef.current.contains(next);
      if (!withinTrigger && !withinPanel) {
        setIsOpen(false);
        // A Tab / Shift+Tab out of the panel returns focus to the trigger, the user's last known place, instead of
        // leaving it on whatever the portalled panel's DOM neighbour is (HEL-1759). Not for focus leaving the trigger
        // itself (a virtual-focus combobox) or a pointer move.
        if (viaTab && panelRef.current.contains(event.target as Node)) {
          // Deferred a microtask: the browser (and jsdom) is mid focus move inside `focusout`, and a synchronous focus()
          // there is not guaranteed to outlast the move it interrupts.
          queueMicrotask(() => triggerRef.current?.focus());
        }
      }
    }
    document.addEventListener("focusout", onFocusOut);
    return () => document.removeEventListener("focusout", onFocusOut);
  }, [isOpen]);

  // Keep the panel inside the viewport horizontally.
  //
  // `computePos` runs against the TRIGGER's rect before the panel exists, so
  // it cannot know how wide the panel will be. Every consumer that anchors to
  // the trigger's right edge (`right: window.innerWidth - rect.right`) is
  // therefore fine for a trigger near the right of the screen and broken for
  // one near the left: the panel grows leftward from the anchor and its left
  // edge goes negative, clipping the content off-screen with no scroll and no
  // visible affordance. Seen on PipelineDetailPage's footer menu at phone
  // width, where the trigger sits ~130px from the left and the panel is
  // `min-width: 140px`.
  //
  // Measuring after mount is what makes this fixable at all — the panel's
  // width is only knowable once it is laid out. `useLayoutEffect` so the
  // correction lands in the same paint as the open, with no visible jump.
  //
  // Only ever runs for consumers that attach `panelRef`, and only nudges
  // along the axis the panel is actually anchored on, so a `left`-positioned
  // panel is left alone. The `>= 1` threshold makes the already-fitting case
  // (the overwhelmingly common one) a no-op.
  useLayoutEffect(() => {
    if (!isOpen) {
      hasClampedRef.current = false;
      return;
    }
    // At most one correction per open. The effect depends on `panelPos`, which
    // it also writes — without this it would re-measure its own output and,
    // anywhere `getBoundingClientRect()` reports a stale or synthetic value,
    // recurse forever.
    if (hasClampedRef.current) return;
    if (panelPos === null) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (panelPos.right === undefined) return;

    const rect = panel.getBoundingClientRect();
    // A zero-width rect means the panel has no layout to correct against —
    // a non-rendering environment (jsdom reports 0 for every rect) or a panel
    // measured before layout. Clamping on those numbers would move a
    // correctly-placed panel based on nothing.
    if (rect.width === 0) return;

    hasClampedRef.current = true;

    const overflowLeft = VIEWPORT_MARGIN - rect.left;
    if (overflowLeft < 1) return;

    // Shrinking `right` slides the panel rightward, back into view. Clamped at
    // 0 so a panel wider than the viewport pins to the right edge rather than
    // overshooting off the other side.
    setPanelPos((current) =>
      current === null || current.right === undefined
        ? current
        : { ...current, right: Math.max(0, current.right - overflowLeft) },
    );
  }, [isOpen, panelPos]);

  // The latest `place`, read by the placement effect below (declared first so it is current when that runs).
  useLayoutEffect(() => {
    placeRef.current = place;
  }, [place]);

  /** Re-runs the opted-in `place` against the current panel and trigger (HEL-1756): the resize listener below calls it,
   *  and a consumer whose content grows after it opened calls it to re-fit. A no-op when not open, not opted in, or
   *  the panel is not mounted. Stable, so it is safe in an effect's dependencies. */
  const reposition = useCallback(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    const placeNow = placeRef.current;
    if (!panel || !trigger || !placeNow) return;
    setPanelPos(placeNow(panel, trigger.getBoundingClientRect()));
    setPlaced(true);
  }, []);

  // Opt-in measured placement: once the panel is mounted (and on resize) hand its real size to `place`.
  useLayoutEffect(() => {
    if (!isOpen || !opted) return;
    reposition();
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      // Closing (or unmounting) un-places the panel, so the next open is hidden again until it is measured.
      setPlaced(false);
    };
  }, [isOpen, opted, reposition]);

  /** Reads the trigger element's bounding rect, calls computePos to derive
   * panel coordinates, and transitions to the open state. */
  const handleOpen = useCallback((computePos?: (rect: DOMRect) => PortalPopoverPos) => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // A consumer that opted into `place` may omit `computePos`: placement fills in the position after mount.
      setPanelPos(computePos ? computePos(rect) : {});
    }
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    triggerRef,
    panelRef,
    isOpen,
    panelPos,
    /** False until an opted-in `place` has run (always true without `place`). */
    placed: opted ? placedState && isOpen : true,
    handleOpen,
    close,
    reposition,
  };
}
