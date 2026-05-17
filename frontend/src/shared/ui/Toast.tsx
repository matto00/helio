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

const DEFAULT_DURATION = 4000;

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
    // Play exit animation, then remove from store.
    setExiting(true);
    setTimeout(() => {
      dispatch(dismissToast(toast.id));
    }, 200);
  }, [dispatch, toast.id]);

  const duration = toast.duration ?? DEFAULT_DURATION;

  useEffect(() => {
    if (duration === 0) return;
    timerRef.current = setTimeout(dismiss, duration);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [dismiss, duration]);

  const classes = ["toast", `toast--${toast.variant}`, exiting ? "toast--exiting" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="alert" aria-live="assertive" aria-atomic="true">
      <span className="toast__icon" aria-hidden="true">
        <FontAwesomeIcon icon={variantIcon[toast.variant]} />
      </span>

      <div className="toast__body">
        <p className="toast__message">{toast.message}</p>
        {toast.action !== undefined && (
          <button type="button" className="toast__action" onClick={toast.action.onClick}>
            {toast.action.label}
          </button>
        )}
      </div>

      <button
        type="button"
        className="toast__close"
        aria-label="Dismiss notification"
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

  return createPortal(
    <div className="toast-viewport" aria-label="Notifications">
      {items.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body,
  );
}
