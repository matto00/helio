import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import "./ActionsMenu.css";
import "./Popover.css";
import { usePortalPopover, type PortalPopoverPos } from "../../hooks/usePortalPopover";
import { fitPanelVertically, VIEWPORT_MARGIN } from "../ui/panelFit";

/** Gap between the trigger and the panel (the viewport margin is the shared `VIEWPORT_MARGIN`). */
const TRIGGER_GAP = 8;

/** Where the mounted `panel` sits against `trigger` so every item is reachable (HEL-1750): vertically via the shared
 *  fit (a `top` anchor below the trigger, a `bottom` anchor above it, the height capped to the room so the rest scrolls
 *  inside the menu), horizontally aligned to the trigger's right edge but never closer than 8px to the left edge. With
 *  no layout (jsdom) the panel keeps the requested side, uncapped. */
function placeActionsMenu(
  prefer: "below" | "above",
  panel: HTMLElement,
  trigger: DOMRect,
): PortalPopoverPos {
  const chrome = panel.offsetHeight - panel.clientHeight;
  const natural = panel.scrollHeight === 0 ? 0 : panel.scrollHeight + chrome;
  const fit = fitPanelVertically(trigger, natural, window.innerHeight, {
    gap: TRIGGER_GAP,
    prefer,
  });
  let right = window.innerWidth - trigger.right;
  const width = panel.getBoundingClientRect().width;
  if (width > 0) right = Math.max(0, Math.min(right, window.innerWidth - width - VIEWPORT_MARGIN));
  const maxHeight = Number.isFinite(fit.maxHeight) ? fit.maxHeight : undefined;
  return fit.side === "above"
    ? { bottom: fit.bottom, right, maxHeight }
    : { top: fit.top, right, maxHeight };
}

export interface ActionsMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Accessible name when it must differ from the visible `label` (e.g. a short visible "Move up"
   *  whose accessible name names the thing it moves). Absent: the visible label is the name. */
  ariaLabel?: string;
  /** Why the item is unavailable: the item's title, which is also its accessible description. */
  reason?: string;
}

interface ActionsMenuProps {
  label: string;
  items: ActionsMenuItem[];
  /** The side of the trigger the panel opens toward when it fits there. Defaults to `"below"`. The menu measures
   *  itself once mounted and fits the viewport (HEL-1750): it flips to the other side when that side has more room, and
   *  caps its height to the room (scrolling inside itself) when neither side holds it, so this is a preference, never
   *  a guarantee. Pass `"above"` for a trigger pinned near the bottom of a fixed-height container (HEL-719). */
  align?: "below" | "above";
}

export function ActionsMenu({ label, items, align = "below" }: ActionsMenuProps) {
  const place = useCallback(
    (panel: HTMLElement, trigger: DOMRect) => placeActionsMenu(align, panel, trigger),
    [align],
  );
  const { triggerRef, panelRef, isOpen, placed, panelPos, handleOpen, close } =
    usePortalPopover<HTMLButtonElement>({ place });
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Inside an open <dialog> (e.g. a bottom sheet) the panel portals into that dialog, or it would render behind the
  // modal's top layer (HEL-1582); `Select` does the same. Elsewhere it is the body, as before.
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  const enabledIndices = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index !== -1);

  // Move real DOM focus onto the first enabled item as soon as the menu
  // is placed (a `visibility: hidden` panel cannot take focus, HEL-1750) (WAI-ARIA menu-button pattern) — previously a keyboard-only user
  // had no way to reach the menu items at all: Enter opened the menu but
  // focus stayed on the trigger (HEL a11y sweep F-007). Arrow keys below
  // handle all internal navigation via explicit .focus() calls, so items
  // intentionally stay out of the sequential Tab order (tabIndex={-1}) —
  // Tab is reserved for leaving the menu, which usePortalPopover's
  // close-on-focusout now handles.
  useLayoutEffect(() => {
    if (!isOpen || !placed) return;
    const firstIndex = enabledIndices[0];
    if (firstIndex !== undefined) itemRefs.current[firstIndex]?.focus();
    // Only re-run when the menu is placed/closed — re-focusing on every
    // `items` identity change would yank focus away from wherever arrow-key
    // navigation left it during an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, placed]);

  function handleToggle() {
    if (isOpen) {
      close();
      return;
    }
    setPortalTarget(triggerRef.current?.closest("dialog[open]") ?? document.body);
    handleOpen();
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
                maxHeight: panelPos.maxHeight,
                visibility: placed ? undefined : "hidden",
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
                    aria-label={item.ariaLabel}
                    tabIndex={-1}
                    className={`actions-menu__item${item.danger ? " actions-menu__item--danger" : ""}`}
                    disabled={item.disabled}
                    title={item.reason}
                    onClick={() => handleItemClick(item)}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </>,
          portalTarget ?? document.body,
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
