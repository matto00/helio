import { isFieldRequired, validateFieldValue } from "./formFieldValidation";
import type { DatasetFieldResponse } from "../../sources/types/dataSource";
import type { FormFieldSpec } from "../types/panel";

function field(overrides: Partial<FormFieldSpec> = {}): FormFieldSpec {
  return { sourceField: "quantity", control: "number", label: "Quantity", ...overrides };
}

function declared(overrides: Partial<DatasetFieldResponse> = {}): DatasetFieldResponse {
  return { name: "quantity", type: "integer", required: false, ...overrides };
}

describe("isFieldRequired", () => {
  it("is required when the config flag is set even if the dataset does not declare it", () => {
    expect(isFieldRequired(field({ required: true }), declared({ required: false }))).toBe(true);
  });

  it("is required when the dataset declares it even without a config flag", () => {
    expect(isFieldRequired(field(), declared({ required: true }))).toBe(true);
  });

  it("is optional when neither the config nor the dataset requires it", () => {
    expect(isFieldRequired(field(), declared({ required: false }))).toBe(false);
  });
});

describe("validateFieldValue", () => {
  it("errors, naming the label, when a config-required field is empty", () => {
    const message = validateFieldValue(field({ required: true }), declared(), "");
    expect(message).toBe("Quantity is required");
  });

  it("errors, naming the label, when a dataset-declared-required field is empty", () => {
    const message = validateFieldValue(field(), declared({ required: true }), "");
    expect(message).toBe("Quantity is required");
  });

  it("errors on a non-integer value for an integer-typed field", () => {
    const message = validateFieldValue(field(), declared({ type: "integer" }), "1.5");
    expect(message).toBe("Quantity must be a whole number");
  });

  it("errors on an unparseable value for a float-typed field", () => {
    const message = validateFieldValue(
      field({ sourceField: "price", label: "Price" }),
      declared({ name: "price", type: "float" }),
      "not-a-number",
    );
    expect(message).toBe("Price must be a number");
  });

  it("returns null for a valid integer value", () => {
    const message = validateFieldValue(field(), declared({ type: "integer" }), "5");
    expect(message).toBeNull();
  });

  it("returns null for a valid float value", () => {
    const message = validateFieldValue(
      field({ sourceField: "price", label: "Price" }),
      declared({ name: "price", type: "float" }),
      "5.5",
    );
    expect(message).toBeNull();
  });

  it("never flags a checkbox's false value as empty", () => {
    const message = validateFieldValue(
      field({ sourceField: "active", control: "checkbox", label: "Active", required: true }),
      declared({ name: "active", type: "boolean", required: true }),
      false,
    );
    expect(message).toBeNull();
  });

  it("returns null for an optional, empty non-number field", () => {
    const message = validateFieldValue(
      field({ sourceField: "note", control: "text", label: "Note" }),
      declared({ name: "note", type: "string", required: false }),
      "",
    );
    expect(message).toBeNull();
  });
});
