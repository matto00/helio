import "./ConfirmInline.css";

interface ConfirmInlineProps {
  /** Optional confirmation copy shown before the Confirm/Cancel buttons
   *  (e.g. "Delete? 3 panels will lose this binding."). Omit for a bare
   *  confirm/cancel pair with no message, matching the row-level delete
   *  affordance in `AgentMemoryList`. */
  label?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Overrides the Confirm button's accessible name (falls back to
   *  `confirmLabel`) — callers with several rows on screen at once (a list
   *  of "Confirm" buttons) need a per-row-unique name for screen readers. */
  confirmAriaLabel?: string;
  cancelAriaLabel?: string;
  className?: string;
}

/** Shared inline confirm/cancel affordance for a destructive row/list-level
 *  action (delete, clear all) — this codebase never uses `window.confirm`
 *  (see AgentMemoryList.tsx design note). Extracted from three independent,
 *  byte-identical copies in MetricListTable, AgentMemoryList's per-row
 *  delete, and AgentMemoryList's "Clear all" toolbar (HEL UI-sweep F-069). */
export function ConfirmInline({
  label,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmAriaLabel,
  cancelAriaLabel,
  className,
}: ConfirmInlineProps) {
  const classes = ["ui-confirm-inline", className ?? null].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {label !== undefined && <span className="ui-confirm-inline__label">{label}</span>}
      <button
        type="button"
        className="ui-confirm-inline__confirm-btn"
        aria-label={confirmAriaLabel}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        className="ui-confirm-inline__cancel-btn"
        aria-label={cancelAriaLabel}
        onClick={onCancel}
      >
        {cancelLabel}
      </button>
    </div>
  );
}
