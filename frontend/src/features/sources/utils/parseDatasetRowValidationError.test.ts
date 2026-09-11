import { parseDatasetRowValidationError } from "./parseDatasetRowValidationError";

describe("parseDatasetRowValidationError (design.md Decision 3a)", () => {
  it("parses a required-field message and attaches it to the named field", () => {
    const parsed = parseDatasetRowValidationError("row 0: field 'name' is required");
    expect(parsed).toEqual([{ fieldName: "name", message: "row 0: field 'name' is required" }]);
  });

  it("parses a type-mismatch message and attaches it to the named field", () => {
    const parsed = parseDatasetRowValidationError(
      "row 0: field 'age' — expected integer, got string",
    );
    expect(parsed).toEqual([
      { fieldName: "age", message: "row 0: field 'age' — expected integer, got string" },
    ]);
  });

  it("a row-length mismatch has no field to attach to (grid-level banner)", () => {
    const parsed = parseDatasetRowValidationError("row 0: expected 3 fields, got 2");
    expect(parsed).toEqual([{ fieldName: null, message: "row 0: expected 3 fields, got 2" }]);
  });

  it("an unparseable message falls back to fieldName: null rather than being silently dropped", () => {
    const parsed = parseDatasetRowValidationError("some future validator message shape");
    expect(parsed).toEqual([{ fieldName: null, message: "some future validator message shape" }]);
  });

  it("splits multiple ';'-joined messages independently", () => {
    const parsed = parseDatasetRowValidationError(
      "row 0: field 'a' is required; row 1: field 'b' — expected float, got string",
    );
    expect(parsed.map((p) => p.fieldName)).toEqual(["a", "b"]);
  });
});
