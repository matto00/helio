import {
  canEmptyField,
  getEditorKind,
  isEmptyEditorValue,
  serializeEditorValue,
} from "./useDatasetFieldEditor";
import type { DatasetFieldResponse } from "../types/dataSource";

describe("getEditorKind", () => {
  it.each([
    ["string", "text"],
    ["integer", "number"],
    ["float", "number"],
    ["boolean", "checkbox"],
    ["timestamp", "datetime"],
    ["string-body", "textarea"],
    ["binary-ref", "readonly"],
  ] as const)("%s -> %s", (type, expected) => {
    expect(getEditorKind(type)).toBe(expected);
  });
});

describe("isEmptyEditorValue", () => {
  it("treats a blank string as empty for text/textarea/number/datetime", () => {
    expect(isEmptyEditorValue("text", "")).toBe(true);
    expect(isEmptyEditorValue("text", "  ")).toBe(true);
    expect(isEmptyEditorValue("number", "")).toBe(true);
  });

  it("checkbox is never empty (no meaningful empty boolean)", () => {
    expect(isEmptyEditorValue("checkbox", "")).toBe(false);
  });
});

describe("canEmptyField (design.md Decision 3a/4.3b)", () => {
  const base: DatasetFieldResponse = { name: "f", type: "string", required: true };

  it("a required field with no default cannot be emptied", () => {
    expect(canEmptyField(base)).toBe(false);
  });

  it("a required field with a null default cannot be emptied (4.3b: null is 'no usable default')", () => {
    expect(canEmptyField({ ...base, default: null })).toBe(false);
  });

  it("a required field with a real declared default CAN be emptied", () => {
    expect(canEmptyField({ ...base, default: "fallback" })).toBe(true);
  });

  it("a non-required field can always be emptied", () => {
    expect(canEmptyField({ ...base, required: false })).toBe(true);
  });
});

describe("serializeEditorValue", () => {
  it("parses a valid number", () => {
    expect(serializeEditorValue("number", "42")).toBe(42);
  });

  it("returns undefined for an invalid number (client-side type error)", () => {
    expect(serializeEditorValue("number", "not-a-number")).toBeUndefined();
  });

  it("serializes checkbox 'true'/'false' strings to booleans", () => {
    expect(serializeEditorValue("checkbox", "true")).toBe(true);
    expect(serializeEditorValue("checkbox", "false")).toBe(false);
  });

  it("passes text through unchanged", () => {
    expect(serializeEditorValue("text", "hello")).toBe("hello");
  });
});
