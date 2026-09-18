// HEL-1087 design.md D6 — submit-time client validation and payload shaping for a `form` panel.
// Pure, side-effect-free; `FormPanelView` is the only caller. Client validation is a convenience
// — the server (`FormSubmission.buildRow`) enforces the same rules independently (design.md D3).

import { computeFormIssues } from "./formConfigValidation";
import { isValidTypedValue, parseTypedValue } from "./formConfigValidation";
import { isFieldRequired, validateFieldValue } from "./formFieldValidation";
import { validateFileUpload } from "./formUploadConfig";
import type { DatasetFieldResponse } from "../../sources/types/dataSource";
import type { FieldValidationError, FormFieldSpec, FormPanelConfig } from "../types/panel";
import type { FormFieldValue } from "../ui/form/useFormPanelValues";

/** A non-editable field (any field `computeFormIssues` flags — orphaned, unfit, bad options; a
 *  `file` control is editable as of HEL-1086) that blocks submit up front — either because it is
 *  required or because it currently holds a value that cannot be sent (design.md D6). */
export interface SubmitBlock {
  field: string;
  message: string;
}

export interface ValidateForSubmitResult {
  /** Per-editable-field error message, keyed by `sourceField` — associated with that control's
   *  `aria-invalid`/`aria-describedby` wiring, same as the blur-time errors. */
  fieldErrors: Record<string, string>;
  /** Non-editable fields blocking the submit — rendered as a form-level, announced summary
   *  naming each field and why (design.md D6/D8). Empty when nothing blocks. */
  blocks: SubmitBlock[];
}

/** Whether `value` counts as a genuinely HELD value for a non-editable field's "holds a value
 *  that cannot be sent" check — a `checkbox`'s `true`, a `file` control's chosen `File`, or any
 *  other control's non-empty/non-whitespace string. Mirrors `formFieldValidation.ts`'s
 *  `isEmptyValue`, inverted, since that helper is not exported (kept private to its own module's
 *  blur-time concern). */
function holdsValue(control: FormFieldSpec["control"], value: FormFieldValue): boolean {
  if (control === "checkbox") return value === true;
  if (control === "file") return value instanceof File;
  return typeof value === "string" && value.trim() !== "";
}

/** The human-readable reason a non-editable field cannot be entered/sent (design.md D6/D8 — the
 *  `computeFormIssues` message; `file` is editable as of HEL-1086, so it never reaches here). */
function nonEditableReason(_field: FormFieldSpec, issue: string | undefined): string {
  return issue ?? "it cannot be sent";
}

/** Validates one EDITABLE field's current value against the form's rules and the dataset's
 *  declared type — required (delegates to the existing blur-time `validateFieldValue`, which
 *  already covers required + a `number` control's typed-parse), a `select` value that no longer
 *  matches any configured option (never dropped, C3), and — for any OTHER string-valued control
 *  bound to a non-string declared type (`text`/`textarea`/`date` bound to integer/float/
 *  timestamp) — the same typed-parse check `number` controls already get. */
function validateEditableField(
  field: FormFieldSpec,
  declared: DatasetFieldResponse,
  value: FormFieldValue,
): string | null {
  const baseError = validateFieldValue(field, declared, value);
  if (baseError) return baseError;

  const label = field.label ?? field.sourceField;

  // HEL-1086 design.md D6/spec: a `file` field's extension/size are checked here, mirroring the
  // server's `FormUploadConfig` rules, once `baseError` above has already cleared the
  // required/empty check (an absent, optional file has nothing further to validate).
  if (field.control === "file") {
    if (value instanceof File) {
      const reason = validateFileUpload(value);
      if (reason) return `${label}: ${reason}`;
    }
    return null;
  }

  const stringValue = typeof value === "string" ? value : "";
  const nonEmpty = stringValue.trim() !== "";

  if (field.control === "select") {
    if (nonEmpty) {
      const options = Array.isArray(field.options) ? field.options : [];
      const matches = options.some((o) => String(o) === stringValue);
      if (!matches) return `${label} must be one of the configured options`;
    }
    return null;
  }

  if (
    nonEmpty &&
    field.control !== "number" &&
    declared.type !== "string" &&
    declared.type !== "string-body"
  ) {
    const parsed = parseTypedValue(declared.type, stringValue);
    if (parsed === undefined || !isValidTypedValue(declared.type, parsed)) {
      if (declared.type === "integer") return `${label} must be a whole number`;
      if (declared.type === "float") return `${label} must be a number`;
      if (declared.type === "timestamp") return `${label} must be a valid date`;
    }
  }

  return null;
}

/** Submit-time validation over every configured field (design.md D6). Editable fields
 *  (declared, fitting, no `computeFormIssues` issue, not `file`) get a per-control error;
 *  non-editable fields either block the submit (required, or holding a value that can't be sent)
 *  or are silently skipped (optional, holds nothing — the server ignores them too, D3). */
export function validateForSubmit(
  config: FormPanelConfig,
  schema: DatasetFieldResponse[],
  values: Record<string, FormFieldValue>,
): ValidateForSubmitResult {
  const issues = computeFormIssues(config, schema);
  const issuesByField = new Map(issues.map((i) => [i.field, i.message]));
  const declaredByField = new Map(schema.map((f) => [f.name, f]));

  const fieldErrors: Record<string, string> = {};
  const blocks: SubmitBlock[] = [];

  for (const field of config.fields) {
    const issue = issuesByField.get(field.sourceField);
    const declared = declaredByField.get(field.sourceField);
    // HEL-1086: `file` is editable as of this ticket — only an `issue`-flagged field (orphaned,
    // unfit, bad options) is non-editable now.
    const nonEditable = issue !== undefined;
    const value = values[field.sourceField];
    const label = field.label ?? field.sourceField;

    if (nonEditable) {
      // "For an undeclared field `field.required === true` alone" — `isFieldRequired` needs a
      // `declared` to call, so the undeclared case falls back to the form's own flag.
      const required = declared ? isFieldRequired(field, declared) : field.required === true;
      if (required) {
        blocks.push({
          field: field.sourceField,
          message: `${label} is required but ${nonEditableReason(field, issue)}`,
        });
      } else if (holdsValue(field.control, value)) {
        blocks.push({
          field: field.sourceField,
          message: `${label} holds a value that cannot be sent: ${nonEditableReason(field, issue)}`,
        });
      }
      continue;
    }

    if (!declared) continue; // unreachable — an undeclared field is always non-editable above.
    const err = validateEditableField(field, declared, value);
    if (err) fieldErrors[field.sourceField] = err;
  }

  return { fieldErrors, blocks };
}

/** Shapes `values` into the typed JSON payload the submit request sends — `select` resolves the
 *  typed option by matching its `String()` key (first match wins), `checkbox` sends the boolean,
 *  an empty/whitespace string is omitted (the server treats it as not-supplied anyway, D3), and a
 *  `file`/non-editable (`computeFormIssues`-flagged) field is NEVER sent here — a `file` field's
 *  chosen `File` travels as its own multipart part instead (see `buildSubmitFiles` below;
 *  `panelService.submitFormPanel` sends this JSON payload as the multipart body's `values` part
 *  alongside it when any file is attached, design.md D5). `validateForSubmit` above is what blocks
 *  a submit that would otherwise silently drop a held value (C3). */
export function buildSubmitValues(
  config: FormPanelConfig,
  schema: DatasetFieldResponse[],
  values: Record<string, FormFieldValue>,
): Record<string, unknown> {
  const issues = computeFormIssues(config, schema);
  const issuesByField = new Map(issues.map((i) => [i.field, i.message]));
  const declaredByField = new Map(schema.map((f) => [f.name, f]));

  const result: Record<string, unknown> = {};

  for (const field of config.fields) {
    if (field.control === "file") continue;
    if (issuesByField.has(field.sourceField)) continue;
    const declared = declaredByField.get(field.sourceField);
    if (!declared) continue;

    const value = values[field.sourceField];

    if (field.control === "checkbox") {
      result[field.sourceField] = value === true;
      continue;
    }

    const stringValue = typeof value === "string" ? value : "";
    if (stringValue.trim() === "") continue;

    if (field.control === "select") {
      const options = Array.isArray(field.options) ? field.options : [];
      const match = options.find((o) => String(o) === stringValue);
      if (match !== undefined) result[field.sourceField] = match;
      continue;
    }

    const parsed = parseTypedValue(declared.type, stringValue);
    result[field.sourceField] = parsed !== undefined ? parsed : stringValue;
  }

  return result;
}

/** HEL-1086 design.md D5: the `sourceField -> File` map for every editable, declared `file` field
 *  currently holding a chosen file — `panelService.submitFormPanel` sends plain JSON when this is
 *  empty (zero behavior change for every existing non-file form), and multipart only when it
 *  holds at least one entry. */
export function buildSubmitFiles(
  config: FormPanelConfig,
  schema: DatasetFieldResponse[],
  values: Record<string, FormFieldValue>,
): Record<string, File> {
  const issues = computeFormIssues(config, schema);
  const issuesByField = new Map(issues.map((i) => [i.field, i.message]));
  const declaredByField = new Map(schema.map((f) => [f.name, f]));

  const result: Record<string, File> = {};
  for (const field of config.fields) {
    if (field.control !== "file") continue;
    if (issuesByField.has(field.sourceField)) continue;
    if (!declaredByField.get(field.sourceField)) continue;
    const value = values[field.sourceField];
    if (value instanceof File) result[field.sourceField] = value;
  }
  return result;
}

export interface MappedServerErrors {
  /** Per-editable-field message, associated with that RENDERED control's `aria-invalid`/
   *  `aria-describedby`. */
  fieldMessages: Record<string, string>;
  /** One summary line per error naming a field the form does not render, or renders
   *  non-editably — surfaced only in the form-level alert, never associated with a control. */
  summaryLines: string[];
}

/** Maps a `400` response's structured `fieldErrors` into the same label-aware wording the
 *  client's own submit-time checks use (design.md D6/D8) — `required` → "<label> is required",
 *  the pinned type-mismatch reasons → the matching D6 message, otherwise "<label>: <reason>". A
 *  field the form does not configure, configures as `file`, or renders non-editably (a
 *  `computeFormIssues` issue) goes to `summaryLines` instead of `fieldMessages` — that is exactly
 *  the "focus stays on the submit button" case (design.md D8). */
export function mapServerFieldErrors(
  config: FormPanelConfig,
  schema: DatasetFieldResponse[],
  fieldErrors: FieldValidationError[],
): MappedServerErrors {
  const issues = computeFormIssues(config, schema);
  const issuesByField = new Map(issues.map((i) => [i.field, i.message]));
  const byField = new Map(config.fields.map((f) => [f.sourceField, f]));

  const fieldMessages: Record<string, string> = {};
  const summaryLines: string[] = [];

  for (const err of fieldErrors) {
    const field = byField.get(err.field);
    const label = field?.label ?? err.field;
    const message = err.reason === "required" ? `${label} is required` : `${label}: ${err.reason}`;

    const editable = field !== undefined && !issuesByField.has(err.field);
    if (editable) {
      fieldMessages[err.field] = message;
    } else {
      summaryLines.push(message);
    }
  }

  return { fieldMessages, summaryLines };
}
