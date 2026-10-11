// HEL-1311 -- the histogram's bin-count control: empty = Automatic (Sturges, clamped 1-50), else a
// whole number from 2 to 100 saved as `chartOptions.histogram.binCount`. An invalid draft is shown
// as an error and never committed, so the editor can only ever save a value the server accepts.

import { useEffect, useState } from "react";

import { TextField } from "../../../../shared/ui/index";

export const BIN_COUNT_MIN = 2;
export const BIN_COUNT_MAX = 100;
const BIN_COUNT_ERROR = `Enter a whole number from ${BIN_COUNT_MIN} to ${BIN_COUNT_MAX}, or leave empty for automatic.`;

/** `undefined` for Automatic (empty), a number for a valid count, `"invalid"` otherwise. */
export function parseBinCountDraft(draft: string): number | undefined | "invalid" {
  const text = draft.trim();
  if (text === "") return undefined;
  if (!/^\d+$/.test(text)) return "invalid";
  const n = Number(text);
  return n >= BIN_COUNT_MIN && n <= BIN_COUNT_MAX ? n : "invalid";
}

interface HistogramBinCountFieldProps {
  binCount: number | undefined;
  onChange: (binCount: number | undefined) => void;
  /** Reports whether the draft is currently unusable, so the sheet can block Save (an invalid draft
   *  is never committed, and a Save would otherwise silently keep the previous value). */
  onInvalidChange: (invalid: boolean) => void;
}

export function HistogramBinCountField({
  binCount,
  onChange,
  onInvalidChange,
}: HistogramBinCountFieldProps) {
  const [draft, setDraft] = useState(binCount === undefined ? "" : String(binCount));
  const invalid = parseBinCountDraft(draft) === "invalid";
  // Leaving the field (another chart type, closing the sheet) must not leave Save blocked.
  useEffect(() => () => onInvalidChange(false), [onInvalidChange]);
  return (
    <div className="output-editor-sheet__data-section">
      <label className="output-editor-sheet__data-label" htmlFor="output-histogram-bins">
        Bins
      </label>
      <TextField
        id="output-histogram-bins"
        className="output-editor-sheet__bin-count"
        type="number"
        inputMode="numeric"
        min={BIN_COUNT_MIN}
        max={BIN_COUNT_MAX}
        step={1}
        value={draft}
        placeholder="Automatic"
        aria-label="Bin count"
        aria-invalid={invalid || undefined}
        aria-describedby="output-histogram-bins-hint"
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parseBinCountDraft(e.target.value);
          onInvalidChange(parsed === "invalid");
          if (parsed !== "invalid") onChange(parsed);
        }}
      />
      <p
        id="output-histogram-bins-hint"
        className={invalid ? "output-editor-sheet__type-hint" : "output-editor-sheet__field-hint"}
        role={invalid ? "alert" : undefined}
      >
        {invalid
          ? BIN_COUNT_ERROR
          : `Leave empty to size bins automatically, or enter ${BIN_COUNT_MIN} to ${BIN_COUNT_MAX}.`}
      </p>
    </div>
  );
}
