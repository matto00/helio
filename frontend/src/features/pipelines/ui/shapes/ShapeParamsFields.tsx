// ShapeParamsFields — shared params-form rendering + submit-time typed-value
// transform for a shape's `paramsSchema` (HEL-391 catalog / HEL-402 expand).
// Extracted from `ShapePickerModal.tsx` (design.md Decision 6) so both the
// in-editor "start from a shape" flow and panel creation's shape-instantiate
// step (HEL-399) share one widget-per-`dataType` implementation instead of
// two independently-maintained copies risking drift.
//
// `ShapeParamsFields` renders the form fields; `buildShapeParams` performs
// the string→typed-value transform at submit time (JSON.parse for
// `object[]`, comma-split for `string[]`, `Number.parseInt` for `integer`).
// Both preserve `ShapePickerModal`'s exact prior behavior, including the
// `object[]` JSON-parse-failure error message shape.

import { TextField } from "../../../../shared/ui/TextField";
import { Textarea } from "../../../../shared/ui/Textarea";
import { Select } from "../../../../shared/ui/Select";
import type { ShapeParamDescriptor } from "../../types/pipelineShape";

import "./ShapeParamsFields.css";

/** One widget per `dataType`, per design.md Decision 5 — never per-shape.
 *  HEL-908 design.md Decision 13 — `enum` (when present) takes priority
 *  over `dataType`, rendering a `<select>` regardless of the underlying
 *  `dataType`; `fieldRef` doesn't change the widget (still a text field —
 *  no live descriptor supplies a capabilities-at-node source to pick from
 *  yet) but is honored via a distinct placeholder/hint below. */
function widgetFor(
  field: ShapeParamDescriptor,
): "string" | "string[]" | "integer" | "object[]" | "enum" {
  if (field.enum && field.enum.length > 0) return "enum";
  switch (field.dataType) {
    case "string[]":
    case "integer":
    case "object[]":
      return field.dataType;
    default:
      return "string"; // fallback for "string" and any unrecognized dataType
  }
}

export type BuildShapeParamsResult = { params: Record<string, unknown> } | { fieldError: string };

/** Transforms raw string form values into the typed `params` payload
 *  `POST /api/pipeline-shapes/:id/expand` expects. Empty fields are omitted
 *  (server-side required-field validation surfaces via the expand call's
 *  422, not client-side here) so an unfilled optional field never sends an
 *  empty string. An `object[]` field's `JSON.parse` failure short-circuits
 *  with a `fieldError` — the caller must not call `expand` in that case. */
export function buildShapeParams(
  paramsSchema: ShapeParamDescriptor[],
  values: Record<string, string>,
): BuildShapeParamsResult {
  const params: Record<string, unknown> = {};
  for (const field of paramsSchema) {
    const raw = values[field.name] ?? "";
    if (raw.trim() === "") continue;
    const widget = widgetFor(field);
    if (widget === "object[]") {
      try {
        params[field.name] = JSON.parse(raw);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Invalid JSON.";
        return { fieldError: `Field "${field.label}" must be valid JSON: ${message}` };
      }
    } else if (widget === "string[]") {
      params[field.name] = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
    } else if (widget === "integer") {
      params[field.name] = Number.parseInt(raw, 10);
    } else {
      params[field.name] = raw;
    }
  }
  return { params };
}

interface ShapeParamsFieldsProps {
  paramsSchema: ShapeParamDescriptor[];
  /** Raw string values keyed by param name — every widget stores its value
   *  as a string; typing happens only at submit time via `buildShapeParams`. */
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  /** Prefixes each field's DOM id so two instances (e.g. the editor's
   *  `ShapePickerModal` and panel creation's `ShapeInstantiateStep`) never
   *  collide if both render into the same document at once. */
  idPrefix: string;
}

export function ShapeParamsFields({
  paramsSchema,
  values,
  onChange,
  idPrefix,
}: ShapeParamsFieldsProps) {
  return (
    <>
      {paramsSchema.map((field) => {
        const widget = widgetFor(field);
        const value = values[field.name] ?? "";
        const fieldId = `${idPrefix}-${field.name}`;
        return (
          <div className="shape-params-fields__field" key={field.name}>
            <label className="shape-params-fields__label" htmlFor={fieldId}>
              {field.label}
              {field.required && <span className="shape-params-fields__required"> *</span>}
            </label>
            {widget === "object[]" ? (
              <Textarea
                id={fieldId}
                mono
                rows={4}
                value={value}
                onChange={(e) => onChange(field.name, e.target.value)}
                aria-label={field.label}
              />
            ) : widget === "enum" ? (
              <Select
                value={value}
                options={(field.enum ?? []).map((v) => ({ value: v, label: v }))}
                onChange={(v) => onChange(field.name, v)}
                ariaLabel={field.label}
                placeholder="Select a value…"
              />
            ) : (
              <TextField
                id={fieldId}
                type={widget === "integer" ? "number" : "text"}
                value={value}
                onChange={(e) => onChange(field.name, e.target.value)}
                aria-label={field.label}
                placeholder={
                  widget === "string[]"
                    ? "comma-separated values"
                    : field.fieldRef
                      ? "column/field name"
                      : undefined
                }
              />
            )}
            {field.description && <p className="shape-params-fields__hint">{field.description}</p>}
          </div>
        );
      })}
    </>
  );
}
