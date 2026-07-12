// State + dirty-tracking + patch-shaping for one `BoundOrLiteralField`
// instance (HEL-243). Extracted out of `BindingEditor` so the metric Label
// and Unit rows don't duplicate six `useState` calls + dirty comparisons
// each — `BindingEditor` calls this hook once per slot and wires the result
// straight into `BoundOrLiteralField`'s props and into `updatePanelBinding`.

import { useState } from "react";
import type { BoundOrLiteralMode } from "./BoundOrLiteralField";

export interface BoundOrLiteralState {
  mode: BoundOrLiteralMode;
  setMode: (mode: BoundOrLiteralMode) => void;
  fieldValue: string;
  setFieldValue: (value: string) => void;
  literalValue: string;
  setLiteralValue: (value: string) => void;
  /** True when mode, field binding, or literal text differs from the
   *  initial (panel-derived) values. */
  dirty: boolean;
  reset: () => void;
  /** The `config.<slot>` PATCH value: `undefined` when untouched (omit the
   *  key — leaves any existing literal unchanged), `null` when the slot is
   *  in "field" mode or the literal text is empty (explicit clear), else the
   *  literal string to set. Mirrors the `aggregation` absent/null/value
   *  convention (HEL-292) — see `buildBindingPatch`. */
  patchValue: string | null | undefined;
  /** The `fieldMapping.<slot>` value to submit — only present when mode is
   *  "field" and a field is chosen, so a literal override and a field
   *  mapping for the same slot can never both be set (design.md Decision 2). */
  fieldMappingValue: string | undefined;
}

export function useBoundOrLiteralState(
  initialMode: BoundOrLiteralMode,
  initialFieldValue: string,
  initialLiteralValue: string,
): BoundOrLiteralState {
  const [mode, setMode] = useState<BoundOrLiteralMode>(initialMode);
  const [fieldValue, setFieldValue] = useState<string>(initialFieldValue);
  const [literalValue, setLiteralValue] = useState<string>(initialLiteralValue);

  const dirty =
    mode !== initialMode ||
    fieldValue !== initialFieldValue ||
    literalValue !== initialLiteralValue;

  const patchValue: string | null | undefined = !dirty
    ? undefined
    : mode === "literal"
      ? literalValue.length > 0
        ? literalValue
        : null
      : null;

  const fieldMappingValue = mode === "field" && fieldValue ? fieldValue : undefined;

  return {
    mode,
    setMode,
    fieldValue,
    setFieldValue,
    literalValue,
    setLiteralValue,
    dirty,
    reset: () => {
      setMode(initialMode);
      setFieldValue(initialFieldValue);
      setLiteralValue(initialLiteralValue);
    },
    patchValue,
    fieldMappingValue,
  };
}
