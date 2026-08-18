import { forwardRef, type AriaAttributes, type MouseEvent, type ReactNode } from "react";

import "./IconButton.css";

type IconButtonVariant = "ghost" | "secondary" | "danger";
type IconButtonSize = "xs" | "sm" | "md";

interface IconButtonProps {
  /** The icon glyph (e.g. a `FontAwesomeIcon`). Rendered `aria-hidden` —
   *  `aria-label` below is the button's only accessible name. */
  icon: ReactNode;
  /**
   * Required, non-optional accessible name (HEL-718) — omitting it is a
   * TypeScript compile error, not a runtime gap. Also the default `title`
   * (visible tooltip) unless `title` is passed explicitly.
   */
  "aria-label": string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Visible native tooltip. Defaults to `aria-label`; pass an explicit,
   *  shorter/different string to diverge (e.g. a keyboard-shortcut hint). */
  title?: string;
  /** Ghost (borderless, default) | secondary (hairline border) | danger
   *  (error-tinted hover) — DESIGN.md §5's existing button recipes applied
   *  to icon-only sizing. */
  variant?: IconButtonVariant;
  /** xs (24px, dense rows) | sm (`--control-sm`, default) | md (`--control-md`). */
  size?: IconButtonSize;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit" | "reset";
  /** Passthrough for icon-only popover/menu triggers (e.g.
   *  `DashboardAppearanceEditor`'s "Customize dashboard appearance" button) —
   *  not needed for a plain action button. */
  "aria-expanded"?: boolean;
  "aria-haspopup"?: AriaAttributes["aria-haspopup"];
}

/**
 * Shared icon-only button primitive (HEL-718 design.md). Formalizes the
 * ghost/secondary/danger icon-button recipe that had independently converged
 * three times — `.cmd-btn.cmd-btn--icon` (`app/App.css`), `.ui-modal__close`
 * (`shared/ui/Modal.css`), and `.preferences-editor__icon-btn`
 * (`features/settings/ui/PreferencesEditor.css`) — into one component, with
 * `aria-label` required at the prop-type level so a missing accessible name
 * is a compile error rather than a runtime accessibility gap. `title`
 * defaults to `aria-label` so every instance gets a visible tooltip for
 * free; pass a distinct `title` when the two should diverge (e.g. a
 * keyboard-shortcut hint alongside a longer task-focused `aria-label`).
 *
 * Forwards `ref` to the underlying `<button>` — `usePortalPopover`-driven
 * triggers (e.g. `DashboardAppearanceEditor`) attach their `triggerRef`
 * directly to it for `getBoundingClientRect()` positioning.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    "aria-label": ariaLabel,
    onClick,
    title,
    variant = "ghost",
    size = "sm",
    disabled = false,
    className,
    type = "button",
    "aria-expanded": ariaExpanded,
    "aria-haspopup": ariaHaspopup,
  },
  ref,
) {
  const classes = [
    "ui-icon-btn",
    `ui-icon-btn--${variant}`,
    `ui-icon-btn--${size}`,
    className ?? null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      title={title ?? ariaLabel}
    >
      <span aria-hidden="true" className="ui-icon-btn__icon">
        {icon}
      </span>
    </button>
  );
});
