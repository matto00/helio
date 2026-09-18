// HEL-1087 tasks.md 3.4 — unit coverage for `validateForSubmit`, `buildSubmitValues`, and
// `mapServerFieldErrors` (design.md D6).

import { buildSubmitValues, mapServerFieldErrors, validateForSubmit } from "./formSubmission";
import type { DatasetFieldResponse } from "../../sources/types/dataSource";
import type { FieldValidationError, FormFieldSpec, FormPanelConfig } from "../types/panel";

function config(fields: FormFieldSpec[]): FormPanelConfig {
  return { dataSourceId: "ds-1", fields, submit: { writeMode: "append" } };
}

const schema: DatasetFieldResponse[] = [
  { name: "note", type: "string", required: false },
  { name: "quantity", type: "integer", required: false },
  { name: "when", type: "timestamp", required: false },
  { name: "status", type: "string", required: false },
  { name: "active", type: "boolean", required: false },
];

describe("validateForSubmit", () => {
  it("reports a required empty field", () => {
    const field: FormFieldSpec = {
      sourceField: "note",
      control: "text",
      label: "Note",
      required: true,
    };
    const result = validateForSubmit(config([field]), schema, { note: "" });
    expect(result.fieldErrors.note).toBe("Note is required");
  });

  it("reports a non-numeric string typed into a number control", () => {
    const field: FormFieldSpec = { sourceField: "quantity", control: "number", label: "Quantity" };
    const result = validateForSubmit(config([field]), schema, { quantity: "abc" });
    expect(result.fieldErrors.quantity).toMatch(/whole number/);
  });

  it("reports a text control bound to a timestamp field with an unparseable date", () => {
    const field: FormFieldSpec = { sourceField: "when", control: "text", label: "When" };
    const result = validateForSubmit(config([field]), schema, { when: "not-a-date" });
    expect(result.fieldErrors.when).toMatch(/valid date/);
  });

  it("an editable select value outside its options is a field error, never dropped (C3)", () => {
    const field: FormFieldSpec = {
      sourceField: "status",
      control: "select",
      label: "Status",
      options: ["a", "b"],
    };
    const result = validateForSubmit(config([field]), schema, { status: "c" });
    expect(result.fieldErrors.status).toBe("Status must be one of the configured options");
  });

  it("an editable select value matching an option is valid", () => {
    const field: FormFieldSpec = {
      sourceField: "status",
      control: "select",
      label: "Status",
      options: ["a", "b"],
    };
    const result = validateForSubmit(config([field]), schema, { status: "a" });
    expect(result.fieldErrors.status).toBeUndefined();
  });

  it("an optional select whose options became invalid (type drift) HOLDING a value blocks with a form-level summary, no field error", () => {
    const field: FormFieldSpec = {
      sourceField: "status",
      control: "select",
      label: "Status",
      options: [],
    };
    const result = validateForSubmit(config([field]), schema, { status: "a" });
    expect(result.fieldErrors.status).toBeUndefined();
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      field: "status",
      message: expect.stringContaining("cannot be sent"),
    });
  });

  it("an optional orphaned field carrying a configured initialValue blocks the same way (D6)", () => {
    const field: FormFieldSpec = {
      sourceField: "ghost",
      control: "text",
      label: "Ghost",
      initialValue: "stale",
    };
    const result = validateForSubmit(config([field]), schema, { ghost: "stale" });
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].field).toBe("ghost");
  });

  it("a required file field blocks with a form-level summary naming the reason", () => {
    const field: FormFieldSpec = {
      sourceField: "photo",
      control: "file",
      label: "Photo",
      required: true,
    };
    const result = validateForSubmit(config([field]), schema, { photo: "" });
    expect(result.blocks).toEqual([
      { field: "photo", message: "Photo is required but file upload is not yet available" },
    ]);
  });

  it("a required (undeclared, form-only) issue field blocks with a form-level summary", () => {
    const field: FormFieldSpec = {
      sourceField: "ghost",
      control: "text",
      label: "Ghost",
      required: true,
    };
    const result = validateForSubmit(config([field]), schema, {});
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].message).toContain("Ghost is required but");
  });

  it("an optional non-editable field holding no value is skipped (no error, no block)", () => {
    const field: FormFieldSpec = { sourceField: "photo", control: "file", label: "Photo" };
    const result = validateForSubmit(config([field]), schema, { photo: "" });
    expect(result.fieldErrors).toEqual({});
    expect(result.blocks).toEqual([]);
  });
});

describe("buildSubmitValues", () => {
  it("types values per the declared field type", () => {
    const fields: FormFieldSpec[] = [
      { sourceField: "note", control: "text" },
      { sourceField: "quantity", control: "number" },
    ];
    const result = buildSubmitValues(config(fields), schema, { note: "hello", quantity: "5" });
    expect(result).toEqual({ note: "hello", quantity: 5 });
  });

  it("omits an empty/whitespace-only value", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "note", control: "text" }];
    const result = buildSubmitValues(config(fields), schema, { note: "   " });
    expect(result).toEqual({});
  });

  it("resolves a select value to its typed option, first match wins", () => {
    const fields: FormFieldSpec[] = [
      { sourceField: "quantity", control: "select", options: [1, 2, 3] },
    ];
    const result = buildSubmitValues(config(fields), schema, { quantity: "2" });
    expect(result).toEqual({ quantity: 2 });
  });

  it("sends a checkbox's boolean value", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "active", control: "checkbox" }];
    expect(buildSubmitValues(config(fields), schema, { active: true })).toEqual({ active: true });
    expect(buildSubmitValues(config(fields), schema, { active: false })).toEqual({ active: false });
  });

  it("never sends a file field", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "photo", control: "file" }];
    const result = buildSubmitValues(config(fields), schema, { photo: "anything" });
    expect(result).toEqual({});
  });

  it("never sends a non-editable (issue) field", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "ghost", control: "text" }];
    const result = buildSubmitValues(config(fields), schema, { ghost: "value" });
    expect(result).toEqual({});
  });
});

describe("mapServerFieldErrors", () => {
  it("maps a required reason to the label-aware wording", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "note", control: "text", label: "Note" }];
    const errors: FieldValidationError[] = [{ field: "note", reason: "required" }];
    const result = mapServerFieldErrors(config(fields), schema, errors);
    expect(result.fieldMessages.note).toBe("Note is required");
    expect(result.summaryLines).toEqual([]);
  });

  it("associates a type-mismatch reason with its rendered editable control", () => {
    const fields: FormFieldSpec[] = [
      { sourceField: "quantity", control: "number", label: "Quantity" },
    ];
    const errors: FieldValidationError[] = [
      { field: "quantity", reason: "expected integer, got string" },
    ];
    const result = mapServerFieldErrors(config(fields), schema, errors);
    expect(result.fieldMessages.quantity).toBe("Quantity: expected integer, got string");
  });

  it("puts an error naming a field the form does not configure into the summary", () => {
    const errors: FieldValidationError[] = [{ field: "bogus", reason: "not part of this form" }];
    const result = mapServerFieldErrors(config([]), schema, errors);
    expect(result.fieldMessages).toEqual({});
    expect(result.summaryLines).toEqual(["bogus: not part of this form"]);
  });

  it("puts an error naming a file field into the summary, not fieldMessages", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "photo", control: "file", label: "Photo" }];
    const errors: FieldValidationError[] = [
      { field: "photo", reason: "file fields are not yet supported" },
    ];
    const result = mapServerFieldErrors(config(fields), schema, errors);
    expect(result.fieldMessages).toEqual({});
    expect(result.summaryLines).toEqual(["Photo: file fields are not yet supported"]);
  });
});
