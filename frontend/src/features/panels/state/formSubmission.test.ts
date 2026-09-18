// HEL-1087/HEL-1086 tasks.md 3.4 — unit coverage for `validateForSubmit`, `buildSubmitValues`,
// `buildSubmitFiles`, and `mapServerFieldErrors` (design.md D6).

import {
  buildSubmitFiles,
  buildSubmitValues,
  mapServerFieldErrors,
  validateForSubmit,
} from "./formSubmission";
import type { DatasetFieldResponse } from "../../sources/types/dataSource";
import type { FieldValidationError, FormFieldSpec, FormPanelConfig } from "../types/panel";

function config(fields: FormFieldSpec[]): FormPanelConfig {
  return { dataSourceId: "ds-1", fields, submit: { writeMode: "append" } };
}

function makeFile(name: string, sizeBytes = 10): File {
  return new File([new Uint8Array(sizeBytes)], name);
}

const schema: DatasetFieldResponse[] = [
  { name: "note", type: "string", required: false },
  { name: "quantity", type: "integer", required: false },
  { name: "when", type: "timestamp", required: false },
  { name: "status", type: "string", required: false },
  { name: "active", type: "boolean", required: false },
  { name: "photo", type: "binary-ref", required: false },
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

  it("a required file field left empty is a field error, not a block (HEL-1086: file is editable)", () => {
    const field: FormFieldSpec = {
      sourceField: "photo",
      control: "file",
      label: "Photo",
      required: true,
    };
    const result = validateForSubmit(config([field]), schema, { photo: null });
    expect(result.fieldErrors.photo).toBe("Photo is required");
    expect(result.blocks).toEqual([]);
  });

  it("an oversized attached file is a field error naming the reason", () => {
    const field: FormFieldSpec = { sourceField: "photo", control: "file", label: "Photo" };
    const oversized = makeFile("big.pdf", 20 * 1024 * 1024);
    const result = validateForSubmit(config([field]), schema, { photo: oversized });
    expect(result.fieldErrors.photo).toMatch(/exceeds the maximum/);
  });

  it("a disallowed extension is a field error naming the reason", () => {
    const field: FormFieldSpec = { sourceField: "photo", control: "file", label: "Photo" };
    const badExt = makeFile("payload.exe");
    const result = validateForSubmit(config([field]), schema, { photo: badExt });
    expect(result.fieldErrors.photo).toMatch(/[Uu]nsupported file extension/);
  });

  it("a valid attached file is not a field error", () => {
    const field: FormFieldSpec = { sourceField: "photo", control: "file", label: "Photo" };
    const result = validateForSubmit(config([field]), schema, { photo: makeFile("report.pdf") });
    expect(result.fieldErrors.photo).toBeUndefined();
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

  it("an optional file field holding no value is skipped (no error, no block)", () => {
    const field: FormFieldSpec = { sourceField: "photo", control: "file", label: "Photo" };
    const result = validateForSubmit(config([field]), schema, { photo: null });
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

  it("never sends a file field in the JSON values payload (it travels as its own multipart part)", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "photo", control: "file" }];
    const result = buildSubmitValues(config(fields), schema, { photo: makeFile("report.pdf") });
    expect(result).toEqual({});
  });

  it("never sends a non-editable (issue) field", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "ghost", control: "text" }];
    const result = buildSubmitValues(config(fields), schema, { ghost: "value" });
    expect(result).toEqual({});
  });
});

describe("buildSubmitFiles", () => {
  it("includes a declared, fitting file field currently holding a chosen file", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "photo", control: "file" }];
    const file = makeFile("report.pdf");
    const result = buildSubmitFiles(config(fields), schema, { photo: file });
    expect(result).toEqual({ photo: file });
  });

  it("omits a file field holding no chosen file", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "photo", control: "file" }];
    const result = buildSubmitFiles(config(fields), schema, { photo: null });
    expect(result).toEqual({});
  });

  it("omits an orphaned (undeclared) file field even when it holds a chosen file", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "missing", control: "file" }];
    const result = buildSubmitFiles(config(fields), schema, { missing: makeFile("report.pdf") });
    expect(result).toEqual({});
  });

  it("never includes a non-file field", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "note", control: "text" }];
    const result = buildSubmitFiles(config(fields), schema, { note: "hello" });
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

  it("associates a file field's server error with its rendered control (HEL-1086: file is editable)", () => {
    const fields: FormFieldSpec[] = [{ sourceField: "photo", control: "file", label: "Photo" }];
    const errors: FieldValidationError[] = [{ field: "photo", reason: "invalid" }];
    const result = mapServerFieldErrors(config(fields), schema, errors);
    expect(result.fieldMessages.photo).toBe("Photo: invalid");
    expect(result.summaryLines).toEqual([]);
  });
});
