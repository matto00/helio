import { useRef, type KeyboardEvent } from "react";

import { useIndicatorSlide } from "../motion/useIndicatorSlide";
import "./SegmentedRadioGroup.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedRadioGroupProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A small segmented single-choice control (HEL-1572): `role="radiogroup"` of `role="radio"` buttons with a roving
 *  tabindex, arrow keys moving (and selecting) the choice. Exactly one option is exposed as checked. The selected
 *  option's raised background is a `.motion-indicator` that slides between options (HEL-1573). */
export function SegmentedRadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedRadioGroupProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const groupRef = useIndicatorSlide<HTMLDivElement>();

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className="ui-segmented" role="radiogroup" aria-label={label} ref={groupRef}>
      <span className="motion-indicator ui-segmented__indicator" aria-hidden="true" />
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            data-indicator-active={selected ? "" : undefined}
            tabIndex={selected ? 0 : -1}
            className={`ui-segmented__option${selected ? " ui-segmented__option--selected" : ""}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
