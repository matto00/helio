import { isValidElement, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

import "./EmptyState.css";

interface EmptyStateCta {
  label: string;
  onClick: () => void;
  /** FontAwesome icon (existing behavior) or a `ReactNode` (e.g. a
   *  `lucide-react` icon) — selected by `React.isValidElement` (HEL-539). */
  icon?: IconDefinition | ReactNode;
  /** Disables the action. The in-flight label text (e.g. "Retrying…") is
   *  supplied by the caller via `label` — `EmptyState` never generates or
   *  alters it itself, since `cta`/`secondaryCta` remain a generic
   *  primitive most (non-retry) empty states also use. */
  disabled?: boolean;
}

interface EmptyStateProps {
  /** FontAwesome icon definition, or a `ReactNode` (e.g. a `lucide-react`
   *  icon) — selected by `React.isValidElement` (HEL-539). */
  icon: IconDefinition | ReactNode;
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

function renderIcon(icon: IconDefinition | ReactNode, className: string) {
  if (isValidElement(icon)) {
    return <span className={className}>{icon}</span>;
  }
  return <FontAwesomeIcon icon={icon as IconDefinition} className={className} />;
}

function renderCtaIcon(icon: IconDefinition | ReactNode, className: string) {
  if (icon === undefined) return null;
  if (isValidElement(icon)) {
    return (
      <span className={className} aria-hidden="true">
        {icon}
      </span>
    );
  }
  return <FontAwesomeIcon icon={icon as IconDefinition} className={className} aria-hidden />;
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
