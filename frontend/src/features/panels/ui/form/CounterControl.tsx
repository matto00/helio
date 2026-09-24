// HEL-1088 design.md Decision 4 — the compact value/`+`/`-` chrome shared by both the embedded
// (non-immediate) and compact single-field (immediate) counter layouts. Presentational only: it
// never decides whether a click submits or just updates local state — that split is `onStep`'s
// caller's concern (`FormFieldControl`'s "counter" case), so this component's ARIA/keyboard
// behavior is identical either way.

import type { KeyboardEvent } from "react";

import "./CounterControl.css";
import { IconButton } from "../../../../shared/ui/IconButton";
import { Minus, Plus } from "lucide-react";

interface CounterControlProps {
  id: string;
  /** The current numeric value — already resolved by the caller from the field's string-shaped
   *  form-state value (non-numeric/empty parses to `0`, mirroring the `number` control's own
   *  empty-string handling). */
  value: number;
  step: number;
  min?: number;
  max?: number;
  ariaLabel: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  /** A counter field is unconditionally required (HEL-1089's `isFieldRequired` override) — always
   *  `"true"` from every call site, not computed from `declared`/config `required` like other
   *  controls. */
  ariaRequired?: boolean;
  /** HEL-1095 design.md D8/D9 — `true` while ANY immediate-submit request from this counter is
   *  outstanding (computed from the caller's pending-delta map, never the old single-value
   *  `submitState`). `undefined`/`false` for a non-`immediate` counter, which has no request of
   *  its own to be busy about. */
  ariaBusy?: boolean;
  disabled?: boolean;
  onStep: (direction: 1 | -1) => void;
}

/** design.md Decision 4: `role="spinbutton"` carries the computed value/step state
 *  (`aria-valuenow`/`aria-valuetext`/`aria-valuemin`/`aria-valuemax`) so a screen reader announces
 *  both the value and the step in one read, without requiring the user to separately locate a step
 *  control. `aria-valuetext` is the human-readable pairing ("12, step 5") — `aria-valuenow` alone
 *  would announce only the number. */
export function CounterControl({
  id,
  value,
  step,
  min,
  max,
  ariaLabel,
  ariaDescribedBy,
  ariaInvalid,
  ariaRequired,
  ariaBusy,
  disabled,
  onStep,
}: CounterControlProps) {
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      onStep(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onStep(-1);
    }
  }

  return (
    <div className="counter-control">
      <IconButton
        icon={<Minus size={16} />}
        aria-label={`Decrease ${ariaLabel} by ${step}`}
        title="Decrease"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => onStep(-1)}
      />
      <div
        id={id}
        className="counter-control__value mono"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-valuenow={value}
        aria-valuetext={`${value}, step ${step}`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid ? "true" : undefined}
        aria-required={ariaRequired ? "true" : undefined}
        aria-busy={ariaBusy ? "true" : undefined}
        aria-disabled={disabled ? "true" : undefined}
        onKeyDown={handleKeyDown}
      >
        {value}
      </div>
      <IconButton
        icon={<Plus size={16} />}
        aria-label={`Increase ${ariaLabel} by ${step}`}
        title="Increase"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => onStep(1)}
      />
    </div>
  );
}
