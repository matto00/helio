// LimitConfig — numeric row-count input for the "limit" pipeline op.
// Renders a single number input (min=1). Calls onChange with '{"count":<n>}'
// on every valid change. N <= 0 is rejected with inline validation text.

import type { ChangeEvent } from "react";

import { TextField } from "./ui";

interface LimitConfigProps {
  /** Current row count limit (parsed from the step config). */
  count: number;
  /** Called with the typed config object on a valid change (CS2c-3a). */
  onChange: (newConfig: { count: number }) => void;
}

export function LimitConfig({ count, onChange }: LimitConfigProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) {
      onChange({ count: parsed });
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
          value={count}
          onChange={handleChange}
          aria-label="Row limit"
        />
      </div>
      {count <= 0 && (
        <span className="pipeline-detail-page__limit-config-error" role="alert">
          Row limit must be greater than 0.
        </span>
      )}
    </div>
  );
}
