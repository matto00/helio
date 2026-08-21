import { TriangleAlert } from "lucide-react";

import "./StatusMessage.css";

interface StatusMessageProps {
  // HEL-528 design.md D5 — "loading" removed: every consumer now renders a
  // shape-matched skeleton for its initial-load state instead (DESIGN.md §7
  // — a bare one-line text block is no longer an acceptable loading
  // treatment for a data-backed list). A call site that still passes
  // `status="loading"` now fails to compile rather than silently rendering
  // nothing (this component returns `null` for any status but `"failed"`).
  status: "idle" | "succeeded" | "failed";
  message?: string;
  /** Invoked by the Retry action, rendered only when `status === "failed"`
   *  (HEL-539 design.md D2/D4). */
  onRetry?: () => void;
  /** True while a retry triggered by `onRetry` is in flight — the component
   *  disables the action and swaps its own visible label to "Retrying…",
   *  mirroring `InlineError`'s identical content recipe. */
  retrying?: boolean;
}

export function StatusMessage({ status, message, onRetry, retrying = false }: StatusMessageProps) {
  if (status === "failed") {
    return (
      <div className="status-message status-message--error" role="alert">
        <TriangleAlert aria-hidden="true" className="status-message__icon" />
        <span className="status-message__text">{message}</span>
        {onRetry !== undefined ? (
          <button
            type="button"
            className="status-message__retry"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        ) : null}
      </div>
    );
  }
  return null;
}
