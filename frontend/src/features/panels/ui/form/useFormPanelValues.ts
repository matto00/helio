// HEL-1085 design.md D6 — per-instance draft state for a rendered form panel. Seeds from
// `initialValue` (prefill-only, never changes what's stored for an omitted field), tracks which
// fields have been left ("touched", gating when an error may show per D5), and re-seeds whenever
// the field list itself changes (e.g. a sheet edit while the panel is mounted). Deliberately NOT
// Redux — ephemeral, per-mount state with no consumer yet; a grid card and a modal view of the
// same panel hold separate drafts (recorded, not hidden).

import { useMemo, useState } from "react";

import { isFieldRequired, validateFieldValue } from "../../state/formFieldValidation";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormFieldSpec } from "../../types/panel";

// HEL-1086: widened to include a `file` control's value — `File` when chosen, `null` when not
// (never `undefined`/`""`, so `isEmptyValue`'s existing null/undefined check covers it for free).
export type FormFieldValue = string | boolean | File | null;

interface UseFormPanelValuesResult {
  values: Record<string, FormFieldValue>;
  touched: Record<string, boolean>;
  errors: Record<string, string | null>;
  setValue: (sourceField: string, value: FormFieldValue) => void;
  touch: (sourceField: string) => void;
  reset: () => void;
  /** HEL-1087: marks every field touched at once — a client-side-blocked submit attempt shows
   *  every failing field's error immediately, not only ones the user has individually blurred. */
  markAllTouched: () => void;
  /** HEL-1087 design.md D7: sets server-reported errors, keyed by `sourceField` — takes
   *  precedence over the client-side rule for that field until `setValue` clears it (the next
   *  edit invalidates a stale server verdict). */
  setExternalErrors: (errors: Record<string, string>) => void;
  /** HEL-1095 design.md D9: adds `delta` to `sourceField`'s CURRENT numeric value via React's
   *  functional `setState` updater — never a value read from an async closure, which could be
   *  stale by the time a concurrent immediate-submit request's callback runs (a second click can
   *  commit its own state update between this call being scheduled and the updater actually
   *  running). This is what makes rapid-click accumulation and per-click rollback correct: every
   *  call is applied against whatever the LATEST committed value is, in call order, even when
   *  several fire within the same tick. Non-numeric/empty parses as `0`, mirroring every other
   *  numeric-field empty-string handling in this hook's callers. */
  adjustNumericValue: (sourceField: string, delta: number) => void;
}

/** A field's empty representation, per control shape (design.md's "A field is prefilled from its
 *  initial value" requirement: "unchecked for checkbox, no option chosen for select"). */
function emptyValueFor(control: FormFieldSpec["control"]): FormFieldValue {
  if (control === "checkbox") return false;
  if (control === "file") return null;
  return "";
}

/** Coerces a config `initialValue` (arbitrary JSON) into this hook's control-shaped value
 *  representation — every control but `checkbox` stores a string. A `file` control always seeds
 *  empty regardless of `initialValue` (HEL-1087: there is no typed entry point for a
 *  `binary-ref` value in this builder — design.md D7). */
function seedValueFor(field: FormFieldSpec): FormFieldValue {
  if (field.control === "file") return emptyValueFor(field.control);
  if (field.initialValue === undefined || field.initialValue === null) {
    return emptyValueFor(field.control);
  }
  if (field.control === "checkbox") return Boolean(field.initialValue);
  return String(field.initialValue);
}

function seedValues(fields: FormFieldSpec[]): Record<string, FormFieldValue> {
  const next: Record<string, FormFieldValue> = {};
  for (const field of fields) next[field.sourceField] = seedValueFor(field);
  return next;
}

/** `fields` keyed by field identity so a genuine field-list edit (not merely a re-render with a
 *  structurally-equal-but-new array) triggers the re-seed below. */
function fieldsKey(fields: FormFieldSpec[]): string {
  return fields.map((f) => f.sourceField).join("|");
}

export function useFormPanelValues(
  fields: FormFieldSpec[],
  schema: DatasetFieldResponse[],
): UseFormPanelValuesResult {
  const key = fieldsKey(fields);
  const [seededKey, setSeededKey] = useState(key);
  const [values, setValues] = useState(() => seedValues(fields));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [externalErrors, setExternalErrorsState] = useState<Record<string, string>>({});

  // "Adjusting state when a prop changes" (react.dev) — a field-list edit re-seeds synchronously
  // during render rather than via an effect, so no stale-values frame is ever painted.
  if (key !== seededKey) {
    setSeededKey(key);
    setValues(seedValues(fields));
    setTouched({});
  }

  const declaredByField = useMemo(() => {
    const map = new Map<string, DatasetFieldResponse>();
    for (const declared of schema) map.set(declared.name, declared);
    return map;
  }, [schema]);

  const errors: Record<string, string | null> = {};
  for (const field of fields) {
    // HEL-1087 design.md D7: a server-reported error takes precedence over the client-side rule
    // for this field until the next `setValue` edit clears it.
    if (externalErrors[field.sourceField] !== undefined) {
      errors[field.sourceField] = externalErrors[field.sourceField];
      continue;
    }
    if (!touched[field.sourceField]) {
      errors[field.sourceField] = null;
      continue;
    }
    const declared = declaredByField.get(field.sourceField);
    errors[field.sourceField] = declared
      ? validateFieldValue(field, declared, values[field.sourceField])
      : null;
  }

  function setValue(sourceField: string, value: FormFieldValue) {
    setValues((prev) => ({ ...prev, [sourceField]: value }));
    setExternalErrorsState((prev) => {
      if (!(sourceField in prev)) return prev;
      const next = { ...prev };
      delete next[sourceField];
      return next;
    });
  }

  function touch(sourceField: string) {
    setTouched((prev) => ({ ...prev, [sourceField]: true }));
  }

  function reset() {
    setValues(seedValues(fields));
    setTouched({});
  }

  function markAllTouched() {
    setTouched((prev) => {
      const next = { ...prev };
      for (const field of fields) next[field.sourceField] = true;
      return next;
    });
  }

  function setExternalErrors(next: Record<string, string>) {
    setExternalErrorsState(next);
  }

  function adjustNumericValue(sourceField: string, delta: number) {
    setValues((prev) => {
      const current = prev[sourceField];
      const currentNum = typeof current === "string" && current !== "" ? Number(current) || 0 : 0;
      return { ...prev, [sourceField]: String(currentNum + delta) };
    });
  }

  return {
    values,
    touched,
    errors,
    setValue,
    touch,
    reset,
    markAllTouched,
    setExternalErrors,
    adjustNumericValue,
  };
}

export { isFieldRequired };
