import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./ActionsMenu.css";
import "./Popover.css";
import { useOverlay } from "./OverlayProvider";

export interface ActionsMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface ActionsMenuProps {
  label: string;
  items: ActionsMenuItem[];
}

export function ActionsMenu({ label, items }: ActionsMenuProps) {
  const { isActive: isOpen, open, close } = useOverlay();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);

  function handleOpen() {
    if (isOpen) {
      close();
      return;
    }
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    open();
  }

  function handleItemClick(item: ActionsMenuItem) {
    close();
    item.onClick();
  }

  const panel =
    isOpen && panelPos
      ? createPortal(
          <>
            <button type="button" className="popover__scrim" onClick={close} />
            <ul
              className="popover__panel actions-menu__panel"
              role="menu"
              style={{ position: "fixed", top: panelPos.top, right: panelPos.right, left: "auto" }}
            >
              {items.map((item) => (
                <li key={item.label} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className={`actions-menu__item${item.danger ? " actions-menu__item--danger" : ""}`}
                    disabled={item.disabled}
                    onClick={() => handleItemClick(item)}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </>,
          document.body,
        )
      : null;

  return (
    <div className="popover actions-menu">
      <button
        ref={triggerRef}
        type="button"
        className="popover__trigger actions-menu__trigger"
        onClick={handleOpen}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
      >
        <span className="actions-menu__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      {panel}
    </div>
  );
}
