// Op-type dropdown menu shown by the PipelineDetailPage when the user clicks
// "+ Add step" or "+ Add transformation step". Lists every operation in
// `OP_TYPES` and reports a selection to its parent.
//
// Portalled to document.body and positioned from the trigger's bounding rect so
// it always paints above surrounding chrome and cannot be clipped by an
// ancestor's overflow/stacking context (matches the shared Popover pattern).

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import "../../../shared/chrome/Popover.css";
import { OP_TYPES } from "../state/stepNarrowing";
import type { OpType } from "../types/step";

interface OpDropdownProps {
  /** The trigger button the menu anchors to, centered beneath it. */
  anchorRef: RefObject<HTMLButtonElement | null>;
  onSelect: (opType: OpType) => void;
  onClose: () => void;
}

export function OpDropdown({ anchorRef, onSelect, onClose }: OpDropdownProps) {
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  // Measure the trigger before paint so the menu never flashes at (0,0).
  // HEL sweep F-040: with 21 op types the menu can be taller than the space
  // remaining below the trigger, running off the bottom of the viewport
  // (unclickable items, overlapping the sticky footer). Clamp its max-height
  // to what's actually left below the trigger — same idea as the shared
  // Select's portal panel, which caps at a fixed 280px; this one is
  // viewport-relative since the trigger (and so the available space) moves.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const top = rect.bottom + 4;
    const maxHeight = Math.max(120, window.innerHeight - top - 16);
    setPos({ top, left: rect.left + rect.width / 2, maxHeight });
  }, [anchorRef]);

  // F-189: opening the menu left focus sitting on the trigger button — the
  // ArrowDown/ArrowUp handling below only ever fires from a keydown that
  // bubbles up through the menu, so a keyboard user who never manually
  // Tabs into the (portalled-to-body) menu can't reach it at all. Move
  // focus to the first real menuitem as soon as the menu is positioned and
  // rendered, mirroring UserMenu's popover (this package's other portalled
  // menu).
  useEffect(() => {
    if (pos !== null) {
      menuRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();
    }
  }, [pos]);

  if (pos === null) return null;

  // F-189: role="menu" had no arrow-key navigation — with 21 op types the
  // only way to move through the list was Tab, one item at a time. Moves
  // real focus among the rendered menuitem buttons, wrapping at both ends.
  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + delta + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return createPortal(
    <>
      <button
        type="button"
        className="popover__scrim"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
      />
      <ul
        ref={menuRef}
        className="pipeline-detail-page__op-dropdown"
        role="menu"
        onKeyDown={handleMenuKeyDown}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          maxHeight: pos.maxHeight,
          transform: "translateX(-50%)",
        }}
      >
        {OP_TYPES.map((op) => (
          <li key={op.id} role="none">
            <button
              type="button"
              role="menuitem"
              className="pipeline-detail-page__op-dropdown-item"
              onClick={() => {
                onSelect(op);
                onClose();
              }}
            >
              <FontAwesomeIcon icon={op.icon} aria-hidden="true" /> {op.label}
            </button>
          </li>
        ))}
      </ul>
    </>,
    document.body,
  );
}
