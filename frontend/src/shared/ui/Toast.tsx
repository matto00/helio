import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { dismissToast } from "../../features/toasts/state/toastsSlice";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import "./toast.css";

import type { Toast as ToastData } from "../../features/toasts/state/toastsSlice";
import { CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";
import { ICON_SIZE } from "./iconSize";
import { FOCUSABLE_SELECTORS } from "./Modal";
import { useTopModalDialog } from "./useTopModalDialog";
import { prefersReducedMotion } from "../../utils/prefersReducedMotion";

// HEL-535 D4 — the JS-side counterpart of toast.css's `--toast-exit-duration`
// (200ms): the delay between playing the exit animation and actually
// removing the toast from store. Documented as a matched pair rather than
// computed from one another (no runtime CSS-var read) — see toast.css.
const TOAST_EXIT_MS = 200;

const variantIcon = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
};

/** A toast's clock and entrance outlive its DOM node (HEL-1668 D2): moving the viewport into or out of a modal
 *  remounts every visible `ToastItem`, which must neither restart the auto-dismiss time nor replay the entrance.
 *  Keyed by toast id (fresh on every push, even a coalesced repeat); an entry is deleted when its toast leaves the
 *  store, so the map never outgrows the visible toasts. */
interface ToastLife {
  /** `Date.now()` at which the toast auto-dismisses; null for a sticky (`duration: 0`) toast. */
  deadline: number | null;
  entered: boolean;
  exiting: boolean;
}
const toastLife = new Map<string, ToastLife>();

/** Records a lifecycle fact for a toast (module-level, so it survives the ToastItem remount). */
function markLife(id: string, patch: Partial<Pick<ToastLife, "entered" | "exiting">>) {
  const life = toastLife.get(id);
  if (life) Object.assign(life, patch);
}

function lifeOf(toast: ToastData): ToastLife {
  let life = toastLife.get(toast.id);
  if (!life) {
    life = {
      deadline: toast.duration === 0 ? null : Date.now() + toast.duration,
      entered: false,
      exiting: false,
    };
    toastLife.set(toast.id, life);
  }
  return life;
}

interface ToastItemProps {
  toast: ToastData;
  /** The dialog the viewport is portalled into, if any: a focused toast that is removed hands focus back to it. */
  dialog: HTMLDialogElement | null;
}

function ToastItem({ toast, dialog }: ToastItemProps) {
  const dispatch = useAppDispatch();
  // Primitives read once per render: the clock and the entrance flag of THIS toast, however often it was remounted.
  const { deadline, entered, exiting: wasExiting } = lifeOf(toast);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);
  // Read once at mount: a remount of an already-entered toast must not replay the entrance.
  const [alreadyEntered] = useState(entered);

  const dismiss = useCallback(() => {
    markLife(toast.id, { exiting: true });
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
    markLife(toast.id, { entered: true });
    // A toast that was mid-exit when the viewport moved is completed rather than snapping back to full opacity.
    if (wasExiting) {
      dispatch(dismissToast(toast.id));
      return;
    }
    if (deadline === null) return;
    // The REMAINING time from the toast's own deadline, so a remount never restarts the clock.
    timerRef.current = setTimeout(dismiss, Math.max(0, deadline - Date.now()));
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [dismiss, dispatch, deadline, wasExiting, toast.id]);

  // A focused toast that disappears inside a modal hands focus to the dialog's first control, never to <body>.
  useLayoutEffect(() => {
    const element = elementRef.current;
    return () => {
      if (!dialog || !element?.contains(document.activeElement)) return;
      const first = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).find(
        (el) => el.closest(".toast-viewport") === null,
      );
      first?.focus();
    };
  }, [dialog]);

  const classes = [
    "toast",
    `toast--${toast.variant}`,
    alreadyEntered ? "toast--entered" : null,
    exiting ? "toast--exiting" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const messageId = `toast-message-${toast.id}`;

  return (
    // HEL-535 D2 — no live-region role/aria-live/aria-atomic here: this card
    // is a pure visual presentation. Announcement comes from ToastViewport's
    // always-mounted live regions below, so nothing is announced twice.
    <div ref={elementRef} className={classes}>
      <span className="toast__icon" aria-hidden="true">
        {(() => {
          const VariantIcon = variantIcon[toast.variant];
          return <VariantIcon size={ICON_SIZE.md} />;
        })()}
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
        <X aria-hidden="true" size={ICON_SIZE.sm} />
      </button>
    </div>
  );
}

/** Toasts committed within this window before the viewport moved raced the move (their message could not be announced
 *  at the old location, which a modal had made inert), so they are announced at the new one. */
const RACE_WINDOW_MS = 100;

/** The viewport's live regions at one portal target. A new target's regions are connected EMPTY; no message goes in
 *  until a full rendered frame later (`ready`), and a toast announced before the move (`skip`) is never re-inserted. */
interface LiveState {
  target: Element;
  ready: boolean;
  skip: ReadonlySet<string>;
}

/** Render this once at the top level. Portals to document.body, or into the most recently opened modal <dialog> so a
 * toast is never hidden behind (or made inert by) a modal's top layer (HEL-1668), and displays all active toasts
 * stacked in the bottom-right corner of the viewport. */
export function ToastViewport() {
  const items = useAppSelector((state) => state.toasts.items);
  const modal = useTopModalDialog();
  const dialog = modal !== null && modal.isConnected ? modal : null;
  const target: Element = dialog ?? document.body;

  const commitTimes = useRef(new Map<string, number>());
  const prevTarget = useRef<Element | null>(null);
  const [live, setLive] = useState<LiveState>(() => ({
    target: document.body,
    ready: true,
    skip: new Set(),
  }));

  // Bookkeeping for the move: when each toast was first committed, and cleanup of the per-toast clocks (a dismissed or
  // evicted toast leaves the store, so its module-level entry goes with it).
  useLayoutEffect(() => {
    const now = performance.now();
    const ids = new Set(items.map((t) => t.id));
    for (const id of ids) if (!commitTimes.current.has(id)) commitTimes.current.set(id, now);
    for (const id of Array.from(commitTimes.current.keys())) {
      if (!ids.has(id)) commitTimes.current.delete(id);
    }
    for (const id of Array.from(toastLife.keys())) if (!ids.has(id)) toastLife.delete(id);
  }, [items]);

  // The portal target changed (a modal opened or closed): the regions at the new target are being connected empty.
  // Their messages stay held for two animation frames -- a single frame runs before that frame's layout/AX update, so
  // an empty region and its message would be processed together and the message never announced.
  useLayoutEffect(() => {
    const previous = prevTarget.current;
    prevTarget.current = target;
    if (previous === null || previous === target) return;
    const cutoff = performance.now() - RACE_WINDOW_MS;
    const skip = new Set(
      Array.from(commitTimes.current.entries())
        .filter(([, committedAt]) => committedAt < cutoff)
        .map(([id]) => id),
    );
    setLive({ target, ready: false, skip });
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setLive({ target, ready: true, skip }));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [target]);

  const liveReady = live.target === target && live.ready;
  const announced = (t: ToastData) => liveReady && !live.skip.has(t.id);

  // HEL-535 D2 — routed by intent: `error` -> assertive, everything else ->
  // polite. Keyed by toast id (not message) so a coalesced repeat — same
  // variant+message, fresh id (toastsSlice D1) — mounts a genuinely new DOM
  // node in its region and is re-announced, rather than becoming a
  // text-identical no-op a screen reader has already read.
  const politeItems = items.filter((t) => t.variant !== "error" && announced(t));
  const assertiveItems = items.filter((t) => t.variant === "error" && announced(t));

  return createPortal(
    <>
      {/* F-154 — `aria-label` on a bare `<div>` (no valid role) is dropped from the accessibility
          tree entirely (axe `aria-prohibited-attr`); `role="region"` gives it one, which also makes
          it the page's landmark region for notifications. */}
      <div className="toast-viewport" role="region" aria-label="Notifications">
        {items.map((toast) => (
          <ToastItem key={toast.id} toast={toast} dialog={dialog} />
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
    target,
  );
}
