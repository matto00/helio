import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

import "./EmptyState.css";

interface EmptyStateCta {
  label: string;
  onClick: () => void;
  icon?: IconDefinition;
}

interface EmptyStateProps {
  /** FontAwesome icon definition to display as the large hero icon. */
  icon: IconDefinition;
  title: string;
  description: string;
  /** Optional call-to-action button. */
  cta?: EmptyStateCta;
  /**
   * "sidebar" renders a compact form (small icon, tighter spacing) for use
   * inside a narrow sidebar list. "main" (default) renders a full centred
   * hero for main content areas.
   */
  variant?: "sidebar" | "main";
}

/** Reusable empty-state slot used across sidebar lists and main content areas.
 * Keeps the accent-tinted icon glow, border, and type scale consistent with
 * the rest of the ui/ primitive layer. */
export function EmptyState({ icon, title, description, cta, variant = "main" }: EmptyStateProps) {
  const rootClass = ["ui-empty-state", `ui-empty-state--${variant}`].join(" ");

  return (
    <div className={rootClass} aria-label={title}>
      <div className="ui-empty-state__icon-wrap" aria-hidden="true">
        <FontAwesomeIcon icon={icon} className="ui-empty-state__icon" />
      </div>
      <p className="ui-empty-state__title">{title}</p>
      <p className="ui-empty-state__description">{description}</p>
      {cta !== undefined ? (
        <button type="button" className="ui-empty-state__cta" onClick={cta.onClick}>
          {cta.icon !== undefined ? (
            <FontAwesomeIcon icon={cta.icon} className="ui-empty-state__cta-icon" aria-hidden />
          ) : null}
          {cta.label}
        </button>
      ) : null}
    </div>
  );
}
