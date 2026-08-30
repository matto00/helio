import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

import { EmptyState, type EmptyStateCta } from "./EmptyState";
import { Spinner } from "./Spinner";

import "./PageStatus.css";

interface PageStatusProps {
  status: "loading" | "failed";
  /** `"spinner"` (default) renders the accent border-`Spinner`. `"skeleton"`
   *  renders `children` instead — the caller's own shape-matched skeleton
   *  (design.md Decision 3) — since skeleton geometry is inherently
   *  route-specific. */
  variant?: "spinner" | "skeleton";
  /** `"page"` (default) renders the full page-level hero (`EmptyState` for
   *  errors, a centred `Spinner` for loading) — for a route's own top-level
   *  fetch. `"section"` renders a compact inline treatment instead — for an
   *  independently-gated sub-section of a page (e.g. `SettingsPage`'s three
   *  F-047 sections, design.md Decision 3a) where a full-page hero per
   *  section would be wildly out of scale. */
  size?: "page" | "section";
  /** `status="loading"` only, `variant="skeleton"` only: the caller's own
   *  skeleton component. */
  children?: ReactNode;
  /** `status="loading"` only, `variant="spinner"` only: the accessible label
   *  for the spinner's `role="status"` wrapper. */
  loadingLabel?: string;
  /** `status="failed"` only: the error description, passed to `EmptyState`
   *  (`size="page"`) or rendered directly (`size="section"`). */
  message?: string;
  /** `status="failed"` only, `size="page"` only: overrides the default error
   *  title. `size="section"` has no title slot — the section's own `<h2>`
   *  heading already names it. */
  title?: string;
  /** `status="failed"` only, `size="page"` only: overrides the default error
   *  icon — an already-rendered element (e.g. `<SourcesErrorIcon />` from
   *  `ERROR_KIND_ICON`), matching `EmptyState`'s own `icon` prop shape. */
  icon?: IconDefinition | ReactNode;
  /** `status="failed"` only: when given, renders a `"Retry"` cta that calls
   *  it. Omitted entirely when not given. */
  onRetry?: () => void;
  /** `status="failed"` only: true while a retry is in flight — swaps the cta
   *  label to `"Retrying…"` and disables it. Mirrors each migrated route's
   *  own pre-existing `isRetrying`/`retrying` computation (design.md Risk:
   *  retry semantics are per-route, not assumed identical). */
  retrying?: boolean;
  /** `status="failed"` only, `size="page"` only: an additional action
   *  alongside Retry (e.g. `ProposalReviewPage`/`PatchSetReviewPage`'s "Back
   *  to dashboards"), passed straight through to `EmptyState`'s own
   *  `secondaryCta`. */
  secondaryCta?: EmptyStateCta;
}

const DEFAULT_ERROR_TITLE = "Something went wrong";

/** Renders a route's top-level (or, at `size="section"`, an independently-
 *  gated sub-section's) loading or error state (DESIGN.md §7, HEL-725). The
 *  caller renders its own resolved content itself once `status` is neither
 *  `"loading"` nor `"failed"` — `PageStatus` is not rendered in that case
 *  (design.md Decision 2). */
export function PageStatus({
  status,
  variant = "spinner",
  size = "page",
  children,
  loadingLabel,
  message,
  title,
  icon,
  onRetry,
  retrying = false,
  secondaryCta,
}: PageStatusProps) {
  if (status === "loading") {
    if (variant === "skeleton") {
      // No default label here (unlike the spinner branch below): most
      // skeleton callers (Sources/Pipelines) already carry their own
      // aria-label internally (`PageContentSkeleton`), so wrapping
      // unconditionally would produce a redundant nested labelled region.
      return loadingLabel ? <div aria-label={loadingLabel}>{children}</div> : <>{children}</>;
    }
    if (size === "section") {
      // Compact inline text row — mirrors each pre-migration section's own
      // `<p aria-label="Loading X">Loading X…</p>` markup exactly (same
      // redundant aria-label/visible-text pairing the old markup already
      // had), just centralized instead of hand-rolled per section.
      return (
        <p className="ui-page-status ui-page-status--section-loading" aria-label={loadingLabel}>
          {loadingLabel ? `${loadingLabel}…` : "Loading…"}
        </p>
      );
    }
    return (
      <div
        className="ui-page-status ui-page-status--loading"
        role="status"
        aria-label={loadingLabel ?? "Loading"}
      >
        <Spinner size="xl" />
      </div>
    );
  }

  if (size === "section") {
    // Compact inline error row — mirrors each pre-migration section's own
    // `<p className="…__error" role="alert">{error}</p>`, plus an inline
    // Retry action when the caller supplies one (none of today's
    // `SettingsPage` sections do, but the option exists for future callers
    // at this size).
    return (
      <p className="ui-page-status ui-page-status--section-error" role="alert">
        {message ?? "Something went wrong."}
        {onRetry && (
          <button
            type="button"
            className="ui-page-status__section-retry"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        )}
      </p>
    );
  }

  return (
    <EmptyState
      intent="error"
      icon={icon ?? <TriangleAlert />}
      title={title ?? DEFAULT_ERROR_TITLE}
      description={message ?? "Something went wrong. Please try again."}
      cta={
        onRetry
          ? {
              label: retrying ? "Retrying…" : "Retry",
              onClick: onRetry,
              disabled: retrying,
            }
          : undefined
      }
      secondaryCta={secondaryCta}
    />
  );
}
