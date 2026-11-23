import { useLayoutEffect, type RefObject } from "react";
import { useStore } from "react-redux";

import type { Toast as ToastData } from "../../features/toasts/state/toastsSlice";
import { FOCUSABLE_SELECTORS } from "./Modal";

/** Where focus goes when a focused toast leaves the store outside a modal (HEL-1172 D8): the element focus came from
 *  before it entered the toast viewport, else another toast's control, else the main landmark. */
function handOffFocusFromRemovedToast(
  removed: HTMLElement,
  preEntryRef: RefObject<Element | null>,
  viewport: Element | null,
) {
  // Read at removal time, deliberately: the latest recorded element, not the one from when the effect was set up.
  const preEntry = preEntryRef.current;
  if (
    preEntry instanceof HTMLElement &&
    preEntry.isConnected &&
    !removed.contains(preEntry) &&
    preEntry.closest(".toast-viewport") === null &&
    preEntry.matches(FOCUSABLE_SELECTORS)
  ) {
    preEntry.focus();
    return;
  }
  const other = Array.from(viewport?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS) ?? []).find(
    (el) => !removed.contains(el),
  );
  if (other) {
    other.focus();
    return;
  }
  // Fallback (3) exists only in the authenticated shell: `main#app-main-content` is rendered by `App`, so on a
  // shell-less route there is no landmark and focus stays where the browser leaves it.
  const main = document.getElementById("app-main-content");
  if (main) {
    if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
    main.focus();
  }
}

/** HEL-1172 D8 — a toast that leaves the store while it holds focus (outside a modal) hands focus off rather than
 *  letting it fall to <body>. Gated on the toast being gone from the store, so the remount that moving the viewport
 *  into or out of a modal causes does not pull focus. */
export function useToastFocusHandOff(
  elementRef: RefObject<HTMLElement | null>,
  toastId: string,
  dialog: HTMLDialogElement | null,
  preEntry: RefObject<Element | null>,
) {
  const store = useStore<{ toasts: { items: ToastData[] } }>();
  useLayoutEffect(() => {
    const element = elementRef.current;
    return () => {
      if (dialog || !element?.contains(document.activeElement)) return;
      if (store.getState().toasts.items.some((t) => t.id === toastId)) return;
      handOffFocusFromRemovedToast(element, preEntry, element.closest(".toast-viewport"));
    };
  }, [dialog, elementRef, preEntry, store, toastId]);
}
