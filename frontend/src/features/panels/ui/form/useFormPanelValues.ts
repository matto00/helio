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

export type FormFieldValue = string | boolean;

interface UseFormPanelValuesResult {
  values: Record<string, FormFieldValue>;
  touched: Record<string, boolean>;
  errors: Record<string, string | null>;
  setValue: (sourceField: string, value: FormFieldValue) => void;
  touch: (sourceField: string) => void;
  reset: () => void;
}

/** A field's empty representation, per control shape (design.md's "A field is prefilled from its
 *  initial value" requirement: "unchecked for checkbox, no option chosen for select"). */
function emptyValueFor(control: FormFieldSpec["control"]): FormFieldValue {
  return control === "checkbox" ? false : "";
}

/** Coerces a config `initialValue` (arbitrary JSON) into this hook's control-shaped value
 *  representation — every control but `checkbox` stores a string. */
function seedValueFor(field: FormFieldSpec): FormFieldValue {
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
  }

  function touch(sourceField: string) {
    setTouched((prev) => ({ ...prev, [sourceField]: true }));
  }

  function reset() {
    setValues(seedValues(fields));
    setTouched({});
  }

  return { values, touched, errors, setValue, touch, reset };
}

export { isFieldRequired };
