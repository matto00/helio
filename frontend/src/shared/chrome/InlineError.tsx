import { RotateCw, SearchX, ShieldOff, TriangleAlert, type LucideIcon } from "lucide-react";

import "./InlineError.css";
import { IconButton } from "../ui/IconButton";

/** Classification of the error being shown (HEL-539 design.md D2). Only
 *  `"error"` is retryable — a `"forbidden"`/`"not-found"` state is
 *  structurally denied a Retry action, regardless of whether `onRetry` is
 *  passed, so a permission-denied/not-found surface can never retry-spam. */
export type InlineErrorKind = "error" | "forbidden" | "not-found";

/** Shared kind → icon mapping, also reused by the full-surface
 *  `EmptyState intent="error"` views (design.md's "one canonical,
 *  visibly-consistent error pattern") so a permission-denied/not-found
 *  failure reads the same regardless of which primitive renders it. */
export const ERROR_KIND_ICON: Record<InlineErrorKind, LucideIcon> = {
  error: TriangleAlert,
  forbidden: ShieldOff,
  "not-found": SearchX,
};

interface InlineErrorProps {
  error: string | null | undefined;
  /** "banner" renders a boxed, higher-emphasis treatment (tinted background +
   *  padding + `role="alert"`) for a standalone error surface, e.g. a failed
   *  preview fetch. Defaults to "text" — the bare inline treatment used
   *  inside forms, unchanged from every existing call site (HEL UI-sweep
   *  F-051 promoted this from two independent hand-rolled boxed-error
   *  treatments; the bare "text" default intentionally keeps its existing,
   *  widely-reused markup untouched to avoid touching the ~30 other call
   *  sites' behavior). */
  variant?: "text" | "banner";
  /** banner-only. Selects the paired icon and whether a Retry action can
   *  ever render. Default "error". */
  kind?: InlineErrorKind;
  /** banner-only. Invoked by the Retry action. Only rendered when
   *  `kind === "error"` — suppressed for "forbidden"/"not-found" regardless
   *  of whether this is passed. */
  onRetry?: () => void;
  /** banner-only. True while a retry triggered by `onRetry` is in flight —
   *  the component (not the caller) disables the action and swaps its own
   *  visible label (or `aria-label`/`title` for `retryVariant="icon-only"`)
   *  to an in-flight state, since retry is this prop's entire purpose. */
  retrying?: boolean;
  /** banner-only, default true. `false` omits `role="alert"` on this
   *  element, for a parent surface that already owns an enclosing
   *  `role="alert"` region (e.g. `PanelContent.tsx`'s wrapper) — avoids two
   *  nested, independently announced alert regions. */
  announced?: boolean;
  /** banner-only, default "button". "icon-only" renders the shared
   *  `IconButton` instead of a labeled button, for a surface too small for
   *  one (e.g. a grid panel card). */
  retryVariant?: "button" | "icon-only";
}

export function InlineError({
  error,
  variant = "text",
  kind = "error",
  onRetry,
  retrying = false,
  announced = true,
  retryVariant = "button",
}: InlineErrorProps) {
  if (!error) return null;

  if (variant === "banner") {
    const Icon = ERROR_KIND_ICON[kind];
    const showRetry = kind === "error" && onRetry !== undefined;

    return (
      <div className="inline-error inline-error--banner" role={announced ? "alert" : undefined}>
        <Icon aria-hidden="true" className="inline-error__icon" />
        <span className="inline-error__message">{error}</span>
        {showRetry ? (
          retryVariant === "icon-only" ? (
            <IconButton
              icon={<RotateCw aria-hidden="true" className="inline-error__retry-icon" />}
              variant="secondary"
              size="xs"
              aria-label={retrying ? "Retrying…" : "Retry"}
              disabled={retrying}
              onClick={() => onRetry?.()}
            />
          ) : (
            <button
              type="button"
              className="inline-error__retry"
              onClick={() => onRetry?.()}
              disabled={retrying}
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )
        ) : null}
      </div>
    );
  }
  return <p className="inline-error">{error}</p>;
}
