import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
  /** Which side of the trigger the panel opens toward. Defaults to `"below"`
   *  — unchanged behavior for every pre-existing consumer (`PanelCard`,
   *  `DashboardList`, `SidebarItemList`), none of which pass this prop. Pass
   *  `"above"` for a trigger pinned near the bottom of a fixed-height
   *  container (e.g. a page footer) — opening below would render the panel
   *  past the viewport's bottom edge, since `usePortalPopover` positions via
   *  a one-shot `getBoundingClientRect()` read with no viewport-collision
   *  detection. Mirrors this same page's `.pipeline-detail-page__cancel-
   *  confirm` "dropup" idiom (PipelineDetailPage.css), the only other
   *  upward-opening popover in the codebase — see HEL-719 scope amendment,
   *  files-modified.md's Cycle 4 section for the root-cause writeup. */
  align?: "below" | "above";
}

export function ActionsMenu({ label, items, align = "below" }: ActionsMenuProps) {
  const { triggerRef, panelRef, isOpen, panelPos, handleOpen, close } =
    usePortalPopover<HTMLButtonElement>();
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const enabledIndices = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index !== -1);

  // Move real DOM focus onto the first enabled item as soon as the menu
  // opens (WAI-ARIA menu-button pattern) — previously a keyboard-only user
  // had no way to reach the menu items at all: Enter opened the menu but
  // focus stayed on the trigger (HEL a11y sweep F-007). Arrow keys below
  // handle all internal navigation via explicit .focus() calls, so items
  // intentionally stay out of the sequential Tab order (tabIndex={-1}) —
  // Tab is reserved for leaving the menu, which usePortalPopover's
  // close-on-focusout now handles.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const firstIndex = enabledIndices[0];
    if (firstIndex !== undefined) itemRefs.current[firstIndex]?.focus();
    // Only re-run when the menu opens/closes — re-focusing on every
    // `items` identity change would yank focus away from wherever arrow-key
    // navigation left it during an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function handleToggle() {
    if (isOpen) {
      close();
      return;
    }
    if (align === "above") {
      handleOpen((rect) => ({
        bottom: window.innerHeight - rect.top + 8,
        right: window.innerWidth - rect.right,
      }));
    } else {
      handleOpen((rect) => ({ top: rect.bottom + 8, right: window.innerWidth - rect.right }));
    }
  }

  function handleItemClick(item: ActionsMenuItem) {
    close();
    item.onClick();
  }

  function focusByOffset(currentIndex: number, delta: number) {
    if (enabledIndices.length === 0) return;
    const currentEnabledIdx = enabledIndices.indexOf(currentIndex);
    const nextEnabledIdx =
      currentEnabledIdx === -1
        ? 0
        : (currentEnabledIdx + delta + enabledIndices.length) % enabledIndices.length;
    itemRefs.current[enabledIndices[nextEnabledIdx]]?.focus();
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    const currentIndex = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusByOffset(currentIndex, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusByOffset(currentIndex, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = enabledIndices[0];
      if (first !== undefined) itemRefs.current[first]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      const last = enabledIndices[enabledIndices.length - 1];
      if (last !== undefined) itemRefs.current[last]?.focus();
    }
  }

  const panel =
    isOpen && panelPos
      ? createPortal(
          <>
            <button type="button" className="popover__scrim" tabIndex={-1} onClick={close} />
            <ul
              ref={(el) => {
                panelRef.current = el;
              }}
              className="popover__panel actions-menu__panel"
              role="menu"
              aria-label={label}
              onKeyDown={handleMenuKeyDown}
              style={{
                position: "fixed",
                top: panelPos.top,
                bottom: panelPos.bottom,
                right: panelPos.right,
                left: "auto",
              }}
            >
              {items.map((item, index) => (
                <li key={item.label} role="none">
                  <button
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
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
        title={label}
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
