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

  function handleItemClick(item: ActionsMenuItem) {
    close();
    item.onClick();
  }

  return (
    <div className="popover actions-menu">
      <button
        type="button"
        className="popover__trigger actions-menu__trigger"
        onClick={() => (isOpen ? close() : open())}
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
      {isOpen ? <button type="button" className="popover__scrim" onClick={close} /> : null}
      {isOpen ? (
        <ul className="popover__panel actions-menu__panel" role="menu">
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
      ) : null}
    </div>
  );
}
