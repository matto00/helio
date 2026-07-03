// Op-type dropdown menu shown by the PipelineDetailPage when the user clicks
// "+ Add step" or "+ Add transformation step". Lists every operation in
// `OP_TYPES` and reports a selection to its parent.
//
// Portalled to document.body and positioned from the trigger's bounding rect so
// it always paints above surrounding chrome and cannot be clipped by an
// ancestor's overflow/stacking context (matches the shared Popover pattern).

import { useLayoutEffect, useState, type RefObject } from "react";
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure the trigger before paint so the menu never flashes at (0,0).
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
  }, [anchorRef]);

  if (pos === null) return null;

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
        className="pipeline-detail-page__op-dropdown"
        role="menu"
        style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
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
