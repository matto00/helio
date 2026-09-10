import type { ReactNode } from "react";

import "./EmptyState.css";

// HEL-548 D5 — exported so feature hooks (useCreateDashboardAction et al.,
// the workspace-create-actions seam) can annotate their return shape against
// it directly. Purely additive: the primitive's own rendering/props are
// otherwise untouched.
export interface EmptyStateCta {
  label: string;
  onClick: () => void;
  /** A rendered icon element (e.g. a `lucide-react` icon) — HEL-443 narrowed
   *  this from the legacy `IconDefinition | ReactNode` union to `ReactNode`
   *  only once every producer moved to lucide. */
  icon?: ReactNode;
  /** Disables the action. The in-flight label text (e.g. "Retrying…") is
   *  supplied by the caller via `label` — `EmptyState` never generates or
   *  alters it itself, since `cta`/`secondaryCta` remain a generic
   *  primitive most (non-retry) empty states also use. */
  disabled?: boolean;
}

interface EmptyStateProps {
  /** A rendered icon element (e.g. a `lucide-react` icon). */
  icon: ReactNode;
  title: string;
  description: string;
  /** Optional call-to-action button, rendered with the Primary recipe. */
  cta?: EmptyStateCta;
  /** Optional secondary action alongside `cta`, rendered with the Secondary
   *  recipe (HEL-539) — e.g. `ProposalReviewPage`'s "Back to dashboards"
   *  alongside a Retry `cta`. */
  secondaryCta?: EmptyStateCta;
  /**
   * "sidebar" renders a compact form (small icon, tighter spacing) for use
   * inside a narrow sidebar list. "main" (default) renders a full centred
   * hero for main content areas.
   */
  variant?: "sidebar" | "main";
  /** "error" (HEL-539): error-tinted icon-wrap/glyph, `role="alert"`, no
   *  `aria-label` (the live region's own content already announces the
   *  title). Default "neutral" — pre-existing, unchanged behavior. */
  intent?: "neutral" | "error";
}

function renderIcon(icon: ReactNode, className: string) {
  return <span className={className}>{icon}</span>;
}

function renderCtaIcon(icon: ReactNode, className: string) {
  if (icon === undefined) return null;
  return (
    <span className={className} aria-hidden="true">
      {icon}
    </span>
  );
}

/** Reusable empty-state slot used across sidebar lists and main content areas.
 * Keeps the accent-tinted icon glow, border, and type scale consistent with
 * the rest of the ui/ primitive layer. Also doubles as the full-surface
 * error-state treatment via `intent="error"` (HEL-539). */
export function EmptyState({
  icon,
  title,
  description,
  cta,
  secondaryCta,
  variant = "main",
  intent = "neutral",
}: EmptyStateProps) {
  const rootClass = [
    "ui-empty-state",
    `ui-empty-state--${variant}`,
    intent === "error" ? "ui-empty-state--error" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClass}
      role={intent === "error" ? "alert" : undefined}
      aria-label={intent === "error" ? undefined : title}
    >
      <div className="ui-empty-state__icon-wrap" aria-hidden="true">
        {renderIcon(icon, "ui-empty-state__icon")}
      </div>
      <p className="ui-empty-state__title">{title}</p>
      <p className="ui-empty-state__description">{description}</p>
      {cta !== undefined || secondaryCta !== undefined ? (
        <div className="ui-empty-state__actions">
          {cta !== undefined ? (
            <button
              type="button"
              className="ui-empty-state__cta"
              onClick={cta.onClick}
              disabled={cta.disabled}
            >
              {renderCtaIcon(cta.icon, "ui-empty-state__cta-icon")}
              {cta.label}
            </button>
          ) : null}
          {secondaryCta !== undefined ? (
            <button
              type="button"
              className="ui-empty-state__secondary-cta"
              onClick={secondaryCta.onClick}
              disabled={secondaryCta.disabled}
            >
              {renderCtaIcon(secondaryCta.icon, "ui-empty-state__cta-icon")}
              {secondaryCta.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
