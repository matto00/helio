import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import "./PageHeader.css";

interface PageHeaderProps {
  /** Rendered as `<h1 className="page-title">` (Fraunces, DESIGN.md §3). */
  title: string;
  /** Rendered above the title via the shared `.eyebrow` utility. */
  eyebrow?: string;
  /** Trailing slot, e.g. buttons. */
  actions?: ReactNode;
  /** Leading back-link href, for detail routes. Ignored if `onBack` is also
   *  given — `onBack` takes precedence since it lets a caller run cleanup
   *  before navigating. */
  backTo?: string;
  onBack?: () => void;
}

/** Canonical page title/eyebrow/actions/back-link header (HEL-725). Only
 *  rendered by routes that already show a title today — see design.md
 *  Decision 4. Omitting an optional prop renders nothing for that slot
 *  rather than an empty wrapper element. */
export function PageHeader({ title, eyebrow, actions, backTo, onBack }: PageHeaderProps) {
  const showBack = onBack !== undefined || backTo !== undefined;

  return (
    <header className="page-header">
      {showBack &&
        (onBack ? (
          // `onBack` takes precedence (see the prop doc above) and never
          // navigates on its own, so it's a `<button>`, not a link — there's
          // no href for it to point at.
          <button type="button" aria-label="Back" className="page-header__back" onClick={onBack}>
            ←
          </button>
        ) : (
          // Plain `backTo`: a real SPA transition via `Link`, not a full
          // document navigation (HEL-725 CR6) — a bare `<a href>` here would
          // reload the whole app instead of routing client-side.
          <Link to={backTo ?? "#"} aria-label="Back" className="page-header__back">
            ←
          </Link>
        ))}
      <div className="page-header__titles">
        {eyebrow && <span className="eyebrow page-header__eyebrow">{eyebrow}</span>}
        <h1 className="page-title">{title}</h1>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
