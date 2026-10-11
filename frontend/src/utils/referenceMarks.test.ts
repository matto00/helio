import { isValidReferenceLabel, sanitizeReferenceMarks } from "./referenceMarks";

describe("sanitizeReferenceMarks", () => {
  it("reads valid lines and bands unchanged", () => {
    const lines = [{ value: 95, label: "SLO", tone: "warning" }, { value: 10 }];
    const bands = [{ from: 0, to: 50, tone: "success" }];
    expect(sanitizeReferenceMarks(lines, bands)).toEqual({ lines, bands });
  });

  it("reads a non-array, null and undefined as none", () => {
    expect(sanitizeReferenceMarks({ value: 1 }, "x")).toEqual({ lines: [], bands: [] });
    expect(sanitizeReferenceMarks(null, undefined)).toEqual({ lines: [], bands: [] });
  });

  it("drops an invalid item and keeps the rest", () => {
    const out = sanitizeReferenceMarks(
      [
        { value: "95" },
        { value: Infinity },
        { value: 1, tone: "red" },
        { value: 2, label: "   " },
        { value: 3, label: "a".repeat(61) },
        42,
        { value: 4 },
      ],
      [
        { from: 5, to: 5 },
        { from: 9, to: 1 },
        { from: "0", to: 1 },
        { from: 0, to: 1 },
      ],
    );
    expect(out.lines).toEqual([{ value: 4 }]);
    expect(out.bands).toEqual([{ from: 0, to: 1 }]);
  });

  it("truncates an over-cap list to the cap", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ value: i }));
    const four = Array.from({ length: 4 }, (_, i) => ({ from: i, to: i + 1 }));
    const out = sanitizeReferenceMarks(six, four);
    expect(out.lines.map((l) => l.value)).toEqual([0, 1, 2, 3, 4]);
    expect(out.bands).toHaveLength(3);
  });
});

describe("isValidReferenceLabel", () => {
  it("accepts 1 to 60 characters with a non-whitespace one", () => {
    expect(isValidReferenceLabel("a")).toBe(true);
    expect(isValidReferenceLabel("a".repeat(60))).toBe(true);
    expect(isValidReferenceLabel("")).toBe(false);
    expect(isValidReferenceLabel("   ")).toBe(false);
    expect(isValidReferenceLabel("a".repeat(61))).toBe(false);
  });

  it("counts code points, so 60 emoji pass and 61 do not", () => {
    expect(isValidReferenceLabel("😀".repeat(60))).toBe(true);
    expect(isValidReferenceLabel("😀".repeat(61))).toBe(false);
  });
});
