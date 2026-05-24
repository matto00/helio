import { useEffect, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";

import { usePortalPopover } from "../../hooks/usePortalPopover";
import "./inputs.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** ARIA label for the trigger. */
  ariaLabel?: string;
  className?: string;
}

/** App-styled custom dropdown that replaces native <select>. Renders a button
 * trigger and a portal-rendered listbox of options. Native selects are
 * impossible to style consistently across browsers — this provides a unified
 * look using the same accent / surface tokens as the rest of the app. */
export function Select({
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled = false,
  ariaLabel,
  className,
}: SelectProps) {
  const { triggerRef, isOpen, panelPos, handleOpen, close } = usePortalPopover<HTMLButtonElement>();
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const enabledIndices = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i !== -1);

  function openPanel() {
    if (disabled) return;
    if (triggerRef.current) {
      // Portal into the nearest open <dialog> if present so the listbox renders
      // in the dialog's top layer (otherwise it falls behind the modal backdrop).
      setPortalTarget(triggerRef.current.closest("dialog[open]") ?? document.body);
    }
    handleOpen((rect) => ({ top: rect.bottom + 4, left: rect.left, width: rect.width }));
    const selectedIndex = options.findIndex((o) => o.value === value);
    setFocusedIndex(selectedIndex >= 0 ? selectedIndex : (enabledIndices[0] ?? -1));
  }

  function closePanel() {
    close();
    setFocusedIndex(-1);
  }

  function selectOption(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    closePanel();
    triggerRef.current?.focus();
  }

  function moveFocus(delta: number) {
    if (!isOpen || enabledIndices.length === 0) return;
    const currentEnabledIdx = enabledIndices.indexOf(focusedIndex);
    const nextEnabledIdx =
      currentEnabledIdx === -1
        ? 0
        : (currentEnabledIdx + delta + enabledIndices.length) % enabledIndices.length;
    setFocusedIndex(enabledIndices[nextEnabledIdx]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) openPanel();
      else moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) openPanel();
      else moveFocus(-1);
    } else if (event.key === "Enter" || event.key === " ") {
      if (!isOpen) {
        event.preventDefault();
        openPanel();
      } else if (focusedIndex >= 0) {
        event.preventDefault();
        selectOption(options[focusedIndex]);
      }
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closePanel();
    }
  }

  // Reposition on resize/scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    function reposition() {
      handleOpen((rect) => ({ top: rect.bottom + 4, left: rect.left, width: rect.width }));
    }
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [isOpen, handleOpen]);

  const triggerClasses = ["ui-select__trigger", className ?? null].filter(Boolean).join(" ");

  return (
    <div className="ui-select">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={triggerClasses}
        onClick={() => (isOpen ? closePanel() : openPanel())}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span
          className={`ui-select__trigger-label${
            selected === null ? " ui-select__trigger-label--placeholder" : ""
          }`}
        >
          {selected?.label ?? placeholder}
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
              onClick={closePanel}
            />
            <ul
              className="ui-select__panel"
              role="listbox"
              style={{
                top: `${panelPos.top}px`,
                left: `${panelPos.left ?? 0}px`,
                minWidth: `${panelPos.width ?? 0}px`,
              }}
            >
              {options.map((option, index) => {
                const isSelected = option.value === value;
                const isFocused = index === focusedIndex;
                const classes = [
                  "ui-select__option",
                  isSelected ? "ui-select__option--selected" : null,
                  isFocused && !isSelected ? "ui-select__option--focused" : null,
                  option.disabled ? "ui-select__option--disabled" : null,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled}
                      className={classes}
                      onMouseEnter={() => setFocusedIndex(index)}
                      onClick={() => selectOption(option)}
                      disabled={option.disabled}
                    >
                      {option.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>,
          portalTarget ?? document.body,
        )}
    </div>
  );
}
