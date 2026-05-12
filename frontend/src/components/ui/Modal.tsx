import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";

import "./Modal.css";

type ModalSize = "sm" | "md" | "lg";

interface ModalProps {
  /** Title shown in the modal header. */
  title: ReactNode;
  /** Optional subtitle / hint rendered below the title. */
  description?: ReactNode;
  /** Main body content. */
  children: ReactNode;
  /** Footer slot — typically action buttons. When omitted no footer is rendered. */
  footer?: ReactNode;
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

/**
 * App-wide modal primitive built on the native <dialog> element.
 *
 * Features:
 * - `showModal()` / `close()` lifecycle driven by the `open` prop
 * - ESC closes (native behaviour)
 * - Backdrop click closes
 * - Consistent header (title + FA close button), body, optional footer
 * - Sizes: sm (420px) | md (540px) | lg (720px)
 */
export function Modal({
  title,
  description,
  children,
  footer,
  open,
  onClose,
  size = "md",
  className,
  ariaLabel,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Sync open prop → native dialog open/close
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [open]);

  function handleClose() {
    dialogRef.current?.close();
    onClose();
  }

  function handleDialogClick(e: MouseEvent<HTMLDialogElement>) {
    // Only close when the click is directly on the <dialog> backdrop, not on inner content.
    if (e.target === dialogRef.current) handleClose();
  }

  const label = ariaLabel ?? (typeof title === "string" ? title : undefined);

  const dialogClass = ["ui-modal", `ui-modal--${size}`, className ?? null]
    .filter(Boolean)
    .join(" ");

  return (
    <dialog
      ref={dialogRef}
      className={dialogClass}
      aria-label={label}
      onClose={onClose}
      onClick={handleDialogClick}
    >
      <div className="ui-modal__inner">
        <header className="ui-modal__header">
          <div className="ui-modal__header-text">
            <h2 className="ui-modal__title">{title}</h2>
            {description && <p className="ui-modal__description">{description}</p>}
          </div>
          <button
            type="button"
            className="ui-modal__close"
            aria-label="Close"
            onClick={handleClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <div className="ui-modal__body">{children}</div>

        {footer && <footer className="ui-modal__footer">{footer}</footer>}
      </div>
    </dialog>
  );
}
