// LimitConfig — numeric row-count input for the "limit" pipeline op.
// Renders a single number input (min=1). Calls onChange with '{"count":<n>}'
// on every valid change. N <= 0 (or blank) is rejected with inline validation
// text.

import { useEffect, useState, type ChangeEvent } from "react";

import { TextField } from "../../../../shared/ui/index";

interface LimitConfigProps {
  /** Current row count limit (parsed from the step config). */
  count: number;
  /** Called with the typed config object on a valid change (CS2c-3a). */
  onChange: (newConfig: { count: number }) => void;
}

export function LimitConfig({ count, onChange }: LimitConfigProps) {
  // The input mirrors this local text, not `count` directly (HEL sweep
  // F-033). A controlled `value={count}` binding can only ever show the last
  // value onChange accepted — every keystroke that didn't parse to a valid
  // positive integer (clearing the field, typing "0") snapped the DOM back
  // to the old value before the next keystroke landed, so a clear-then-type
  // "50" over a "10" produced "1050" instead of "50". Buffering the raw text
  // locally lets the field show exactly what was typed, including
  // transiently-invalid text; onChange still only fires once that text
  // parses to a valid count.
  const [text, setText] = useState(String(count));

  // Resync when the parent hands this instance a different starting value
  // (a fresh valid count from our own onChange round-trips back here too,
  // but only after `text` already equals its string form, so it's a no-op).
  useEffect(() => {
    setText(String(count));
  }, [count]);

  const parsed = parseInt(text, 10);
  const isValid = text.trim() !== "" && !isNaN(parsed) && parsed > 0;

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setText(raw);
    const nextParsed = parseInt(raw, 10);
    if (raw.trim() !== "" && !isNaN(nextParsed) && nextParsed > 0) {
      onChange({ count: nextParsed });
    }
  }

  return (
    <div className="pipeline-detail-page__limit-config">
      <div className="pipeline-detail-page__limit-config-row">
        <label className="pipeline-detail-page__limit-config-label" htmlFor="limit-count-input">
          Row limit (N)
        </label>
        <TextField
          id="limit-count-input"
          type="number"
          min={1}
          value={text}
          onChange={handleChange}
          aria-label="Row limit"
        />
      </div>
      {!isValid && (
        <span className="pipeline-detail-page__limit-config-error" role="alert">
          Row limit must be greater than 0.
        </span>
      )}
    </div>
  );
}
