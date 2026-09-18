// HEL-1084 task 4.6 — `formConfigValidation.ts`: every issue kind, `parseTypedValue` per
// declared type, `fittingControls` default ordering.
import {
  computeFormIssues,
  defaultControl,
  fittingControls,
  isOptionsArray,
  parseTypedValue,
} from "./formConfigValidation";
import type { DatasetFieldResponse } from "../../sources/types/dataSource";
import type { FormFieldSpec, FormPanelConfig } from "../types/panel";

const schema: DatasetFieldResponse[] = [
  { name: "quantity", type: "integer", required: true },
  { name: "note", type: "string", required: false },
  { name: "when", type: "timestamp", required: false },
  { name: "flag", type: "boolean", required: false },
];

function config(fields: FormFieldSpec[]): FormPanelConfig {
  return { dataSourceId: "ds-1", fields, submit: { writeMode: "append" } };
}

describe("fittingControls / defaultControl", () => {
  it("defaults integer to number", () => {
    expect(fittingControls("integer")).toEqual(["number", "select", "text"]);
    expect(defaultControl("integer")).toBe("number");
  });

  it("defaults boolean to checkbox", () => {
    expect(defaultControl("boolean")).toBe("checkbox");
  });

  it("maps binary-ref to file only", () => {
    expect(fittingControls("binary-ref")).toEqual(["file"]);
  });
});

describe("parseTypedValue", () => {
  it("parses an integer", () => {
    expect(parseTypedValue("integer", "5")).toBe(5);
    expect(parseTypedValue("integer", "5.5")).toBeUndefined();
  });

  it("parses a float", () => {
    expect(parseTypedValue("float", "5.5")).toBe(5.5);
  });

  it("parses a boolean", () => {
    expect(parseTypedValue("boolean", "true")).toBe(true);
    expect(parseTypedValue("boolean", "false")).toBe(false);
    expect(parseTypedValue("boolean", "nope")).toBeUndefined();
  });

  it("parses a string/timestamp as trimmed text", () => {
    expect(parseTypedValue("string", "  hi  ")).toBe("hi");
    expect(parseTypedValue("timestamp", "2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
  });

  it("treats an empty string as nothing entered", () => {
    expect(parseTypedValue("integer", "   ")).toBeUndefined();
  });

  it("has no typed-text entry point for binary-ref", () => {
    expect(parseTypedValue("binary-ref", "anything")).toBeUndefined();
  });
});

describe("isOptionsArray", () => {
  it("accepts a non-empty array", () => {
    expect(isOptionsArray([1, 2])).toBe(true);
  });

  it("rejects an empty array or a non-array", () => {
    expect(isOptionsArray([])).toBe(false);
    expect(isOptionsArray("nope")).toBe(false);
    expect(isOptionsArray(undefined)).toBe(false);
  });
});

describe("computeFormIssues", () => {
  it("returns no issues for a fully valid config", () => {
    expect(
      computeFormIssues(config([{ sourceField: "quantity", control: "number" }]), schema),
    ).toEqual([]);
  });

  it("flags an undeclared field", () => {
    const issues = computeFormIssues(config([{ sourceField: "legacy", control: "text" }]), schema);
    expect(issues).toEqual([{ field: "legacy", message: expect.stringContaining("not declared") }]);
  });

  it("flags an unfit control", () => {
    const issues = computeFormIssues(
      config([{ sourceField: "note", control: "checkbox" }]),
      schema,
    );
    expect(issues[0].field).toBe("note");
    expect(issues[0].message).toContain("does not fit");
  });

  it("flags a duplicate field", () => {
    const issues = computeFormIssues(
      config([
        { sourceField: "note", control: "text" },
        { sourceField: "note", control: "text" },
      ]),
      schema,
    );
    expect(issues.some((i) => i.message.includes("Duplicate"))).toBe(true);
  });

  it("flags missing, empty, or wrongly typed options on a select control", () => {
    expect(
      computeFormIssues(config([{ sourceField: "quantity", control: "select" }]), schema)[0]
        .message,
    ).toContain("Options must be a non-empty list");
    expect(
      computeFormIssues(
        config([{ sourceField: "quantity", control: "select", options: [] }]),
        schema,
      )[0].message,
    ).toContain("Options must be a non-empty list");
    expect(
      computeFormIssues(
        config([{ sourceField: "quantity", control: "select", options: [1, "two"] }]),
        schema,
      )[0].message,
    ).toContain("not a valid integer");
  });

  it("accepts typed options that fit the declared type", () => {
    expect(
      computeFormIssues(
        config([{ sourceField: "quantity", control: "select", options: [1, 2, 3] }]),
        schema,
      ),
    ).toEqual([]);
  });

  it("flags a wrongly typed initialValue", () => {
    const issues = computeFormIssues(
      config([{ sourceField: "when", control: "text", initialValue: "soon" }]),
      schema,
    );
    expect(issues[0].message).toContain("not a valid timestamp");
  });

  it("treats a null initialValue as absent", () => {
    expect(
      computeFormIssues(
        config([{ sourceField: "when", control: "text", initialValue: null }]),
        schema,
      ),
    ).toEqual([]);
  });

  it("flags step on a non-number control", () => {
    const issues = computeFormIssues(
      config([{ sourceField: "quantity", control: "text", step: 1 }]),
      schema,
    );
    expect(issues[0].message).toContain("Step is only valid");
  });

  it("flags a non-positive step", () => {
    const issues = computeFormIssues(
      config([{ sourceField: "quantity", control: "number", step: 0 }]),
      schema,
    );
    expect(issues[0].message).toContain("Step must be positive");
  });
});
