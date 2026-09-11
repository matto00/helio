import type { DatasetFieldResponse, DatasetFieldType } from "../types/dataSource";

/** design.md Decision 6: the concrete editor kind for each declared `DatasetFieldType`.
 *  `BinaryRefType` ("binary-ref") is read-only -- it stores a JSON object reference, not an
 *  editable scalar. */
export type DatasetFieldEditorKind =
  | "text"
  | "textarea"
  | "number"
  | "checkbox"
  | "datetime"
  | "readonly";

const EDITOR_KIND_BY_TYPE: Record<DatasetFieldType, DatasetFieldEditorKind> = {
  string: "text",
  integer: "number",
  float: "number",
  boolean: "checkbox",
  timestamp: "datetime",
  "string-body": "textarea",
  "binary-ref": "readonly",
};

export function getEditorKind(type: DatasetFieldType): DatasetFieldEditorKind {
  return EDITOR_KIND_BY_TYPE[type] ?? "text";
}

/** design.md Decision 3a: every editor's "emptied" state (backspaced-to-`""` for text/textarea,
 *  cleared for number/datetime) is a uniform clear attempt -- there is no meaningful "empty"
 *  `BooleanType`, so checkbox is excluded (always has a value) and this always returns `false`
 *  for it. */
export function isEmptyEditorValue(kind: DatasetFieldEditorKind, raw: string): boolean {
  if (kind === "checkbox" || kind === "readonly") return false;
  return raw.trim() === "";
}

/** design.md Decision 3a/4.3b: a required field can be emptied ONLY when it has a declared
 *  default that is itself not JSON `null` -- a `default: null` is "no usable default" (4.3b),
 *  same as no default at all. Non-required fields can always be emptied. */
export function canEmptyField(field: DatasetFieldResponse): boolean {
  if (!field.required) return true;
  return field.default !== undefined && field.default !== null;
}

/** Serializes a raw editor string/checked value into the JSON value the PATCH body should carry
 *  for a non-empty edit. Numeric parsing failures return `undefined` (caller treats as a type
 *  validation error, client-side, before ever submitting). */
export function serializeEditorValue(
  kind: DatasetFieldEditorKind,
  raw: string,
): string | number | boolean | undefined {
  switch (kind) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(raw.trim() === "" ? NaN : n) ? n : undefined;
    }
    case "checkbox":
      return raw === "true";
    default:
      return raw;
  }
}

/** Renders a stored cell value back into the editor's raw string form (checkbox uses its own
 *  boolean prop instead of this). */
export function toEditorRawValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** design.md Decision 6 hook wrapper -- maps a declared field to its editor kind and clear
 *  eligibility. Pure/stateless (no React state of its own); exists as a hook per tasks.md 3.3's
 *  naming so `DatasetRowGrid` has one canonical place field-type-to-editor logic lives, even
 *  though today's implementation needs no hook internals. */
export function useDatasetFieldEditor(field: DatasetFieldResponse): {
  kind: DatasetFieldEditorKind;
  canEmpty: boolean;
} {
  return { kind: getEditorKind(field.type), canEmpty: canEmptyField(field) };
}
