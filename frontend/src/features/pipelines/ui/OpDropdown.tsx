// Op-type dropdown menu shown by the PipelineDetailPage when the user clicks
// "+ Add step" or "+ Add transformation step". Lists every operation in
// `OP_TYPES` and reports a selection to its parent.

import { useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { OP_TYPES } from "../state/stepNarrowing";
import type { OpType } from "../types/step";

interface OpDropdownProps {
  onSelect: (opType: OpType) => void;
  onClose: () => void;
}

export function OpDropdown({ onSelect, onClose }: OpDropdownProps) {
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <ul className="pipeline-detail-page__op-dropdown" ref={ref} role="menu">
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
  );
}
