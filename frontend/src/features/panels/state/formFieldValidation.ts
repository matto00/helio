// HEL-1085 design.md D5 — the minimal field-level validation set that produces an associated
// error for a rendered form panel field. UX only: HEL-1087 owns submit-time enforcement.

import { isValidTypedValue, parseTypedValue } from "./formConfigValidation";
import type { DatasetFieldResponse } from "../../sources/types/dataSource";
import type { FormFieldSpec } from "../types/panel";

/** Whether `value` counts as "empty" for the required-field check, per control shape — a
 *  `checkbox`'s `false` is a real, present value (never "empty"); every other control's empty
 *  representation is an empty/whitespace-only string, `undefined`, or `null`. */
function isEmptyValue(control: FormFieldSpec["control"], value: unknown): boolean {
  if (control === "checkbox") return false;
  if (value === undefined || value === null) return true;
  return typeof value === "string" && value.trim() === "";
}

/** Resolves whether `field` is presented as required — config `required: true` OR the dataset's
 *  own declaration (tighten-only; design.md D3a/the spec's "Required-ness" requirement). */
export function isFieldRequired(field: FormFieldSpec, declared: DatasetFieldResponse): boolean {
  return field.required === true || declared.required;
}

/** Validates one field's current raw value against `field`/`declared`, returning the error
 *  message to show (naming the field) or `null` when the value is valid. Callers gate this on
 *  "touched" themselves (design.md D5 — no error before the field has been left). */
export function validateFieldValue(
  field: FormFieldSpec,
  declared: DatasetFieldResponse,
  value: unknown,
): string | null {
  const label = field.label ?? field.sourceField;

  if (isFieldRequired(field, declared) && isEmptyValue(field.control, value)) {
    return `${label} is required`;
  }

  if (field.control === "number" && !isEmptyValue(field.control, value)) {
    const text = typeof value === "string" ? value : String(value);
    const parsed = parseTypedValue(declared.type, text);
    if (parsed === undefined) {
      return declared.type === "integer"
        ? `${label} must be a whole number`
        : `${label} must be a number`;
    }
    if (!isValidTypedValue(declared.type, parsed)) {
      return declared.type === "integer"
        ? `${label} must be a whole number`
        : `${label} must be a number`;
    }
  }

  return null;
}
