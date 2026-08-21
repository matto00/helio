import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheckCircle,
  faCircleXmark,
  faExclamationTriangle,
  faInfoCircle,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import { dismissToast } from "../../features/toasts/state/toastsSlice";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import "./toast.css";

import type { Toast as ToastData } from "../../features/toasts/state/toastsSlice";

// HEL-535 D4 — the JS-side counterpart of toast.css's `--toast-exit-duration`
// (200ms): the delay between playing the exit animation and actually
// removing the toast from store. Documented as a matched pair rather than
// computed from one another (no runtime CSS-var read) — see toast.css.
const TOAST_EXIT_MS = 200;

function prefersReducedMotion(): boolean {
  // Guards `matchMedia` itself, not just `window` — jsdom (the test
  // environment) doesn't implement it at all, so an unmocked test would
  // otherwise throw rather than simply behaving as "no preference".
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const variantIcon = {
  info: faInfoCircle,
  success: faCheckCircle,
  warning: faExclamationTriangle,
  error: faCircleXmark,
};

// ── Single toast item ────────────────────────────────────────────────────────

interface ToastItemProps {
  toast: ToastData;
}

function ToastItem({ toast }: ToastItemProps) {
  const dispatch = useAppDispatch();
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    // HEL-535 D4 — under reduced motion, elide the exit delay entirely so a
    // dismissed toast doesn't sit in layout, invisible, for TOAST_EXIT_MS
    // while unpainted; otherwise play the exit animation, then remove.
    if (prefersReducedMotion()) {
      dispatch(dismissToast(toast.id));
      return;
    }
    setExiting(true);
    setTimeout(() => {
      dispatch(dismissToast(toast.id));
    }, TOAST_EXIT_MS);
  }, [dispatch, toast.id]);

  useEffect(() => {
    if (toast.duration === 0) return;
    timerRef.current = setTimeout(dismiss, toast.duration);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [dismiss, toast.duration]);

  const classes = ["toast", `toast--${toast.variant}`, exiting ? "toast--exiting" : null]
    .filter(Boolean)
    .join(" ");

  const messageId = `toast-message-${toast.id}`;

  return (
    // HEL-535 D2 — no live-region role/aria-live/aria-atomic here: this card
    // is a pure visual presentation. Announcement comes from ToastViewport's
    // always-mounted live regions below, so nothing is announced twice.
    <div className={classes}>
      <span className="toast__icon" aria-hidden="true">
        <FontAwesomeIcon icon={variantIcon[toast.variant]} />
      </span>

      <div className="toast__body">
        {/* HEL-535 D2 — hidden from assistive tech: the same text is
            announced via the matching live region in ToastViewport, so a
            screen-reader user browsing this region landmark doesn't meet it
            twice. Still referenced (via aria-describedby below) so the
            action/dismiss controls aren't orphaned from their message. */}
        <p id={messageId} className="toast__message" aria-hidden="true">
          {toast.message}
        </p>
        {toast.action !== undefined && (
          <button
            type="button"
            className="toast__action"
            aria-describedby={messageId}
            onClick={toast.action.onClick}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      <button
        type="button"
        className="toast__close"
        aria-label="Dismiss notification"
        aria-describedby={messageId}
        title="Dismiss notification"
        onClick={dismiss}
      >
        <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
      </button>
    </div>
  );
}

// ── Viewport (rendered once in App) ─────────────────────────────────────────

/** Render this once at the top level. Portals to document.body and displays
 * all active toasts stacked in the bottom-right corner of the viewport. */
export function ToastViewport() {
  const items = useAppSelector((state) => state.toasts.items);

  // HEL-535 D2 — routed by intent: `error` -> assertive, everything else ->
  // polite. Keyed by toast id (not message) so a coalesced repeat — same
  // variant+message, fresh id (toastsSlice D1) — mounts a genuinely new DOM
  // node in its region and is re-announced, rather than becoming a
  // text-identical no-op a screen reader has already read.
  const politeItems = items.filter((t) => t.variant !== "error");
  const assertiveItems = items.filter((t) => t.variant === "error");

  return createPortal(
    <>
      {/* F-154 — `aria-label` on a bare `<div>` (no valid role) is dropped from the accessibility
          tree entirely (axe `aria-prohibited-attr`); `role="region"` gives it one, which also makes
          it the page's landmark region for notifications. */}
      <div className="toast-viewport" role="region" aria-label="Notifications">
        {items.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </div>

      {/* HEL-535 D2 — always-mounted from first render, never lazily: an
          announcement can never depend on a live region created together
          with its content, which is the failure mode the previous per-node
          `role="alert"` design had. `.sr-only` is theme.css's canonical
          visually-hidden recipe (theme.css:279-287).

          `aria-atomic="false"` is EXPLICIT and LOAD-BEARING here — do not
          "tidy" it away (skeptic-final-1.md CR1). `role="status"` and
          `role="alert"` each carry an IMPLICIT `aria-atomic="true"` per the
          ARIA spec, confirmed live in Chrome's computed accessibility tree
          (`Accessibility.getFullAXTree`: `atomic: true` on both regions with
          no explicit attribute at all — cycle-1's fix, which only removed
          the explicit `aria-atomic="true"`, changed nothing observable,
          because the implicit default took over). An atomic region
          re-presents its ENTIRE content on any change, not just what
          changed — wrong here, where a region can hold up to
          MAX_VISIBLE_TOASTS children: a third stacked error would
          re-announce the first two right along with it, directly
          contradicting D2's own "nothing is announced twice" goal, and it
          would regress `main`, where each toast was its own single-message
          atomic region. The explicit `"false"` below is what actually
          restricts announcement to the newly added node — which is exactly
          what keying each child by toast id is designed to deliver. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="false">
        {politeItems.map((toast) => (
          <span key={toast.id}>{toast.message}</span>
        ))}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="false">
        {assertiveItems.map((toast) => (
          <span key={toast.id}>{toast.message}</span>
        ))}
      </div>
    </>,
    document.body,
  );
}
