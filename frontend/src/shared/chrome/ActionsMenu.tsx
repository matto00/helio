import { createPortal } from "react-dom";
import "./ActionsMenu.css";
import "./Popover.css";
import { usePortalPopover } from "../../hooks/usePortalPopover";

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
  const { triggerRef, isOpen, panelPos, handleOpen, close } = usePortalPopover<HTMLButtonElement>();

  function handleToggle() {
    if (isOpen) {
      close();
      return;
    }
    handleOpen((rect) => ({ top: rect.bottom + 8, right: window.innerWidth - rect.right }));
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
        onClick={handleToggle}
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
