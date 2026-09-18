// HEL-1084 design.md D2/D3 — pure validation logic for the form builder,
// mirroring the backend `FormSchemaConsistency`/`FormFieldSpec.FittingControls`
// (`backend/src/main/scala/com/helio/domain/panels/FormPanel.scala`). This is UX
// only — the write API (`PanelService.rejectInconsistentForm`) is the actual
// enforcement; this module exists so the builder can surface the same
// mismatches before a save round-trips to the server.

import type { DatasetFieldResponse, DatasetFieldType } from "../../sources/types/dataSource";
import type { FormFieldControl, FormFieldSpec, FormPanelConfig } from "../types/panel";

/** design.md D2 — the control-to-type fitness matrix, first entry = the type's default control.
 *  THE mirror of the backend's `FormFieldSpec.FittingControls` — drift-guarded by
 *  `controlFitnessDriftGuard.test.ts` (C4). Never edit this without editing the Scala side too. */
export const CONTROL_FITNESS: Record<DatasetFieldType, FormFieldControl[]> = {
  string: ["text", "textarea", "select"],
  "string-body": ["textarea", "text", "select"],
  integer: ["number", "select", "text", "counter"],
  float: ["number", "select", "text", "counter"],
  boolean: ["checkbox", "select"],
  timestamp: ["date", "text", "select"],
  "binary-ref": ["file"],
};

export function fittingControls(fieldType: DatasetFieldType): FormFieldControl[] {
  return CONTROL_FITNESS[fieldType];
}

export function defaultControl(fieldType: DatasetFieldType): FormFieldControl {
  return CONTROL_FITNESS[fieldType][0];
}

/** Parses raw control input text into a typed JSON value per the declared field type, mirroring
 *  the backend's `DatasetRowValidator.validateValue` acceptance rules. Returns `undefined` on a
 *  value that does not fit the type (an empty string is also `undefined` — "nothing entered"). */
export function parseTypedValue(fieldType: DatasetFieldType, text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  switch (fieldType) {
    case "string":
    case "string-body":
    case "timestamp":
      return trimmed;
    case "integer": {
      const n = Number(trimmed);
      return Number.isInteger(n) ? n : undefined;
    }
    case "float": {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : undefined;
    }
    case "boolean":
      if (trimmed === "true") return true;
      if (trimmed === "false") return false;
      return undefined;
    case "binary-ref":
      // No typed-text entry point for a binary-ref value in this builder.
      return undefined;
  }
}

/** Whether `value` is itself a valid typed value for `fieldType` — the client-side mirror of
 *  `DatasetRowValidator.validateValue`, operating on an already-parsed JSON value (an option
 *  entry, an `initialValue`) rather than raw text. */
export function isValidTypedValue(fieldType: DatasetFieldType, value: unknown): boolean {
  switch (fieldType) {
    case "string":
    case "string-body":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "float":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "timestamp":
      return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
    case "binary-ref":
      return typeof value === "object" && value !== null;
  }
}

export function isOptionsArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

/** One field-associated issue the builder surfaces (design.md's "surfaced at author time").
 *  `field` is the form field's `sourceField` (empty string is never a real field name, so it is
 *  never ambiguous with a real issue key). */
export interface FormFieldIssue {
  field: string;
  message: string;
}

/** A form field's declared-schema pairing, or `undefined` when the field names a
 *  `sourceField` the bound dataset does not declare (the "orphaned" case). */
function declaredFieldFor(
  field: FormFieldSpec,
  schema: DatasetFieldResponse[],
): DatasetFieldResponse | undefined {
  return schema.find((f) => f.name === field.sourceField);
}

/** design.md's "checked ... when the sheet opens, when the bound dataset is switched, and on
 *  every field edit" — mirrors `FormSchemaConsistency.check` (D1 b-e) plus the purely structural
 *  rules `FormPanel.validateConfig` already enforces (duplicate field, step-on-non-number).
 *  Returns every issue found — the caller (`FormEditor`) decides how to render them; `[]` means
 *  the config is save-able. */
export function computeFormIssues(
  config: FormPanelConfig,
  schema: DatasetFieldResponse[],
): FormFieldIssue[] {
  const issues: FormFieldIssue[] = [];
  const seen = new Set<string>();

  for (const field of config.fields) {
    if (seen.has(field.sourceField)) {
      issues.push({ field: field.sourceField, message: `Duplicate field '${field.sourceField}'` });
      continue;
    }
    seen.add(field.sourceField);

    const declared = declaredFieldFor(field, schema);
    if (!declared) {
      issues.push({
        field: field.sourceField,
        message: `'${field.sourceField}' is not declared by the bound dataset`,
      });
      continue;
    }

    const fitting = fittingControls(declared.type);
    if (!fitting.includes(field.control)) {
      issues.push({
        field: field.sourceField,
        message: `Control '${field.control}' does not fit — fitting controls: ${fitting.join(", ")}`,
      });
      continue;
    }

    if (field.control === "number" && field.step !== undefined && field.step <= 0) {
      issues.push({ field: field.sourceField, message: "Step must be positive" });
    }
    if (field.step !== undefined && field.control !== "number") {
      issues.push({
        field: field.sourceField,
        message: "Step is only valid for the number control",
      });
    }

    if (field.control === "select") {
      if (!isOptionsArray(field.options)) {
        issues.push({ field: field.sourceField, message: "Options must be a non-empty list" });
      } else {
        const bad = field.options.find((v) => !isValidTypedValue(declared.type, v));
        if (bad !== undefined) {
          issues.push({
            field: field.sourceField,
            message: `Option ${JSON.stringify(bad)} is not a valid ${declared.type} value`,
          });
        }
      }
    }

    if (field.initialValue !== undefined && field.initialValue !== null) {
      if (!isValidTypedValue(declared.type, field.initialValue)) {
        issues.push({
          field: field.sourceField,
          message: `Initial value is not a valid ${declared.type} value`,
        });
      }
    }
  }

  const counterIssue = checkCounterRowShape(config, schema);
  if (counterIssue) issues.push(counterIssue);

  return issues;
}

/** HEL-1089 design.md Decision 3a "Failure mode" — client-side mirror of the backend's
 *  `FormSchemaConsistency.checkCounterRowShape`: a `counter`-control field can only be saved
 *  bound to a dataset declaring a `timestamp` field named `occurred_at` and a numeric,
 *  non-required field named `value`. Runs only when the config actually has a counter field. */
function checkCounterRowShape(
  config: FormPanelConfig,
  schema: DatasetFieldResponse[],
): FormFieldIssue | undefined {
  const counterField = config.fields.find((f) => f.control === "counter");
  if (!counterField) return undefined;

  const occurredAt = schema.find((f) => f.name === "occurred_at");
  if (!occurredAt) {
    return {
      field: counterField.sourceField,
      message: "counter field requires the bound dataset to declare a field named 'occurred_at'",
    };
  }
  if (occurredAt.type !== "timestamp") {
    return {
      field: counterField.sourceField,
      message: "counter field requires 'occurred_at' to be declared as a timestamp field",
    };
  }

  const value = schema.find((f) => f.name === "value");
  if (!value) {
    return {
      field: counterField.sourceField,
      message: "counter field requires the bound dataset to declare a field named 'value'",
    };
  }
  if (value.type !== "integer" && value.type !== "float") {
    return {
      field: counterField.sourceField,
      message: "counter field requires 'value' to be declared as a numeric field",
    };
  }
  if (value.required) {
    return {
      field: counterField.sourceField,
      message:
        "counter field requires 'value' to be declared as not required — a nullable snapshot can never be required",
    };
  }

  return undefined;
}
