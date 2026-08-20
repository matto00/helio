import { TriangleAlert } from "lucide-react";

import "./StatusMessage.css";

interface StatusMessageProps {
  status: "idle" | "loading" | "succeeded" | "failed";
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
  if (status === "loading") {
    return <p className="status-message">{message ?? "Loading..."}</p>;
  }
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
