// Checkbox-list-in-a-popover multi-select for a metric's allowed dimensions
// (design.md D3/Risk): a plain, portal-rendered checkbox list rather than a
// novel interaction — matches `Select`'s trigger + portal pattern
// (`usePortalPopover`) so the visual language stays consistent. Metric-
// editor-local; not promoted to `shared/ui` (no second consumer yet, per
// `fieldOptions.ts`'s own "rule of three" extraction convention).

import { useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";

import { usePortalPopover } from "../../../hooks/usePortalPopover";
import type { SelectOption } from "../../../shared/ui/index";
import "./AllowedDimensionsPicker.css";

interface AllowedDimensionsPickerProps {
  options: SelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}

export function AllowedDimensionsPicker({
  options,
  selected,
  onChange,
  disabled = false,
}: AllowedDimensionsPickerProps) {
  const { triggerRef, isOpen, panelPos, handleOpen, close } = usePortalPopover<HTMLButtonElement>();
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  function openPanel() {
    if (disabled) return;
    if (triggerRef.current) {
      setPortalTarget(triggerRef.current.closest("dialog[open]") ?? document.body);
    }
    handleOpen((rect) => ({ top: rect.bottom + 4, left: rect.left, width: rect.width }));
  }

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  // Contain Escape to this popover — without `preventDefault()`, the key
  // event's native default action still reaches `Modal.tsx`'s underlying
  // native `<dialog>` (ESC-closes is native `<dialog>` behavior) and closes
  // the whole parent modal, discarding all in-progress form state. Mirrors
  // `Select.tsx`'s `handleKeyDown` Escape branch — the "match Select's
  // portal pattern" this component follows (design.md D3) also has to cover
  // this half of that pattern, not just the positioning mechanics.
  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      close();
    }
  }

  const label =
    selected.length === 0
      ? "None selected"
      : `${selected.length} field${selected.length === 1 ? "" : "s"} selected`;

  return (
    <div className="ui-select">
      <button
        ref={triggerRef}
        type="button"
        className="ui-select__trigger"
        onClick={() => (isOpen ? close() : openPanel())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Allowed dimensions"
        disabled={disabled}
      >
        <span
          className={`ui-select__trigger-label${
            selected.length === 0 ? " ui-select__trigger-label--placeholder" : ""
          }`}
        >
          {label}
        </span>
        <FontAwesomeIcon icon={faChevronDown} className="ui-select__chevron" aria-hidden="true" />
      </button>

      {isOpen &&
        panelPos !== null &&
        createPortal(
          <>
            <button
              type="button"
              className="ui-select__scrim"
              aria-hidden="true"
              tabIndex={-1}
              onClick={close}
            />
            <ul
              className="ui-select__panel allowed-dimensions-picker__panel"
              role="listbox"
              aria-multiselectable="true"
              aria-label="Allowed dimensions options"
              style={{
                top: `${panelPos.top}px`,
                left: `${panelPos.left ?? 0}px`,
                minWidth: `${panelPos.width ?? 0}px`,
              }}
            >
              {options.length === 0 ? (
                <li className="allowed-dimensions-picker__empty">No fields available.</li>
              ) : (
                options.map((option) => (
                  <li key={option.value}>
                    <label className="allowed-dimensions-picker__option">
                      <input
                        type="checkbox"
                        checked={selected.includes(option.value)}
                        onChange={() => toggle(option.value)}
                      />
                      {option.label}
                    </label>
                  </li>
                ))
              )}
            </ul>
          </>,
          portalTarget ?? document.body,
        )}
    </div>
  );
}
