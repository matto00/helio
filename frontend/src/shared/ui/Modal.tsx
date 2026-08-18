import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";

import "./Modal.css";

type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

interface ModalProps {
  /** Title shown in the modal header. */
  title: ReactNode;
  /** Optional subtitle / hint rendered below the title. */
  description?: ReactNode;
  /** Main body content. */
  children: ReactNode;
  /** Footer slot — typically action buttons. When omitted no footer is rendered. */
  footer?: ReactNode;
  /** Header actions slot — rendered before the close button. When omitted nothing renders there. */
  headerActions?: ReactNode;
  /**
   * Optional focus key for the title `<h2>`. When provided, Modal refocuses
   * its title (and, via `aria-live`, re-announces it) every time this value
   * changes — including on initial mount, since effects run after the first
   * render too — without exposing a ref into Modal's internals. For
   * per-step wizards (e.g. `PanelCreationModal`) that need to move focus to
   * the new step's title on every step change (and again after dismissing
   * an inline confirm banner) — pass e.g. `${step}-${focusNonce}`. Omit for
   * a static title; Modal never autofocuses its title otherwise.
   */
  titleKey?: string | number;
  /** Controls whether the modal is open. */
  open: boolean;
  /** Called when the modal requests closure (ESC, backdrop click, close button). */
  onClose: () => void;
  /** Width preset. Defaults to "md". */
  size?: ModalSize;
  /** Additional class(es) placed on the <dialog> element. */
  className?: string;
  /** aria-label override. Defaults to the string value of title. */
  ariaLabel?: string;
}

// Selector for all keyboard-focusable elements inside the modal — mirrors
// the manual trap PanelCreationModal hand-rolled before it moved onto this
// shared primitive (HEL-716).
const FOCUSABLE_SELECTORS =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * App-wide modal primitive built on the native <dialog> element.
 *
 * Features:
 * - `showModal()` / `close()` lifecycle driven by the `open` prop
 * - ESC, backdrop click, and the close button all route through `onClose` as a single
 *   vetoable "close requested" signal — `Modal` never closes the native dialog itself in
 *   response to any of them; only the `open` prop (or unmounting) actually closes it
 * - Tab/Shift+Tab wrap within the dialog's focusable elements (HEL-716 — see the
 *   in-file note on the trap effect below for why this can't be left to the browser alone)
 * - Consistent header (title + FA close button), body, optional footer
 * - Sizes: sm (420px) | md (540px) | lg (720px) | xl (960px) | full (1200px)
 */
export function Modal({
  title,
  description,
  children,
  footer,
  headerActions,
  titleKey,
  open,
  onClose,
  size = "md",
  className,
  ariaLabel,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // HEL-716 — refocuses the title whenever `titleKey` changes (including on
  // initial mount, since effects always run after the first render). A
  // `key`-remount + native `autoFocus` approach was tried first but proved
  // unreliable (probe-confirmed, in an isolated repro independent of any
  // app code) whenever a *different*, currently-focused sibling element is
  // removed in the same commit — e.g. the previous wizard step's selected
  // control unmounting as the step changes. The browser's automatic
  // blur-to-`<body>` on that removal isn't ordered relative to `autoFocus`
  // within the same commit and can override it. An explicit `useEffect`
  // runs strictly after a commit's DOM mutations settle, so it always wins.
  // No-op when `titleKey` is omitted (every consumer but the wizards that
  // opt in).
  useEffect(() => {
    if (titleKey === undefined) return;
    titleRef.current?.focus();
  }, [titleKey]);

  // Sync open prop → native dialog open/close. This is the sole imperative
  // showModal()/close() call site.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [open]);

  // Intercept Escape (native `cancel` event) so it routes through onClose instead of
  // closing the dialog immediately — lets a consumer veto the close (e.g. unsaved changes).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleCancel(e: Event) {
      e.preventDefault();
      onClose();
    }
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  // HEL-716 — Tab/Shift+Tab focus trap. Native <dialog> + showModal() makes
  // everything *outside* the dialog inert (Tab can't escape to page content),
  // but it does NOT wrap focus back to the first/last element when Tab is
  // pressed past the last/first focusable element inside the dialog — Chromium
  // (confirmed on two versions) instead moves focus to <body>, breaking
  // keyboard navigation out of the modal entirely. This was previously
  // PanelCreationModal's own hand-rolled trap (deleted when it migrated onto
  // this primitive per HEL-716 tasks.md 2.2, on the mistaken assumption that
  // native containment alone was equivalent) — moved here and generalized so
  // every Modal consumer gets correct wrap-around, matching the
  // `modal-dismiss-interactions` spec's Tab/Shift+Tab scenarios.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function handleTrapKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;

      const focusable = Array.from(dialog!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    dialog.addEventListener("keydown", handleTrapKeyDown);
    return () => dialog.removeEventListener("keydown", handleTrapKeyDown);
  }, []);

  function handleDialogClick(e: MouseEvent<HTMLDialogElement>) {
    // Only close when the click is directly on the <dialog> backdrop, not on inner content.
    if (e.target === dialogRef.current) onClose();
  }

  const label = ariaLabel ?? (typeof title === "string" ? title : undefined);

  const dialogClass = ["ui-modal", `ui-modal--${size}`, className ?? null]
    .filter(Boolean)
    .join(" ");

  return (
    <dialog ref={dialogRef} className={dialogClass} aria-label={label} onClick={handleDialogClick}>
      <div className="ui-modal__inner">
        <header className="ui-modal__header">
          <div className="ui-modal__header-text">
            <h2 ref={titleRef} tabIndex={-1} aria-live="polite" className="ui-modal__title">
              {title}
            </h2>
            {description && <p className="ui-modal__description">{description}</p>}
          </div>
          {headerActions}
          <button type="button" className="ui-modal__close" aria-label="Close" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <div className="ui-modal__body">{children}</div>

        {footer && <footer className="ui-modal__footer">{footer}</footer>}
      </div>
    </dialog>
  );
}
