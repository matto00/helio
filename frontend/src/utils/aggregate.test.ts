import { computeAggregate, groupAndAggregate } from "./aggregate";

// Mirrors AggregateStepSpec.scala's scenarios (null-skip, all-null → null,
// sum = 0 on zero coercible values, count of non-null, mixed string/number
// fields) plus the TS-specific empty-string / real-null distinction that
// `usePanelData`'s stringified `rawRows` collapses but the typed `rows`
// path (what `computeAggregate`/`groupAndAggregate` actually receive) must
// preserve — see design.md Decision 2 and Decision 4.

describe("computeAggregate", () => {
  it("counts rows where the field is non-null", () => {
    const rows = [{ title: "A" }, { title: "B" }, { title: null }, { title: undefined }];
    expect(computeAggregate(rows, "title", "count")).toBe(2);
  });

  it("sums coercible numeric values, skipping non-coercible ones", () => {
    const rows = [{ n: 10 }, { n: "20" }, { n: "not-a-number" }, { n: null }];
    expect(computeAggregate(rows, "n", "sum")).toBe(30);
  });

  it("returns 0 for sum when zero coercible values exist (mirrors AggregateStep's nums.sum on empty list)", () => {
    const rows = [{ n: null }, { n: null }];
    expect(computeAggregate(rows, "n", "sum")).toBe(0);
  });

  it("returns null for avg when zero coercible values exist", () => {
    const rows = [{ n: null }, { n: undefined }];
    expect(computeAggregate(rows, "n", "avg")).toBeNull();
  });

  it("returns null for min when zero coercible values exist", () => {
    const rows = [{ n: null }];
    expect(computeAggregate(rows, "n", "min")).toBeNull();
  });

  it("returns null for max when zero coercible values exist", () => {
    const rows = [{ n: null }];
    expect(computeAggregate(rows, "n", "max")).toBeNull();
  });

  it("computes avg over coercible values only", () => {
    const rows = [{ n: 10 }, { n: 20 }, { n: "not-a-number" }];
    expect(computeAggregate(rows, "n", "avg")).toBe(15);
  });

  it("computes min and max over coercible values only", () => {
    const rows = [{ n: 5 }, { n: 1 }, { n: "9" }, { n: "nope" }];
    expect(computeAggregate(rows, "n", "min")).toBe(1);
    expect(computeAggregate(rows, "n", "max")).toBe(9);
  });

  it("returns null for min/max on a string-typed field with no coercible values", () => {
    const rows = [{ label: "alpha" }, { label: "beta" }];
    expect(computeAggregate(rows, "label", "min")).toBeNull();
    expect(computeAggregate(rows, "label", "max")).toBeNull();
  });

  // ── Empty-string vs real null/undefined (Decision 2 / Decision 4) ─────────

  it("excludes an empty-string cell from sum/avg/min/max rather than coercing it to 0", () => {
    // Number("") === 0 and Number("  ") === 0 — the classic JS gotcha this
    // guard exists to avoid. An empty string must behave like a non-coercible
    // value, not like a real zero.
    const rows = [{ n: 10 }, { n: "" }, { n: "  " }];
    expect(computeAggregate(rows, "n", "sum")).toBe(10);
    expect(computeAggregate(rows, "n", "avg")).toBe(10);
  });

  it("excludes a real JS null/undefined value from count without coercing to 0 for sum/avg/min/max", () => {
    // Typed-row shape (Record<string, unknown>) — the actual input shape
    // computeAggregate receives from usePanelData, NOT the stringified
    // rawRows where null/undefined and "" are already collapsed to "".
    const rows: Record<string, unknown>[] = [
      { rating: 4 },
      { rating: null },
      { rating: undefined },
      { rating: 6 },
    ];
    expect(computeAggregate(rows, "rating", "count")).toBe(2);
    expect(computeAggregate(rows, "rating", "sum")).toBe(10);
    expect(computeAggregate(rows, "rating", "avg")).toBe(5);
    expect(computeAggregate(rows, "rating", "min")).toBe(4);
    expect(computeAggregate(rows, "rating", "max")).toBe(6);
  });

  it("handles mixed string/number fields for count", () => {
    const rows = [{ v: "a" }, { v: 1 }, { v: null }, { v: "" }];
    // count only cares about non-null/non-undefined — "" counts as present.
    expect(computeAggregate(rows, "v", "count")).toBe(3);
  });

  it("handles an empty row set", () => {
    expect(computeAggregate([], "n", "sum")).toBe(0);
    expect(computeAggregate([], "n", "avg")).toBeNull();
    expect(computeAggregate([], "n", "count")).toBe(0);
  });
});

describe("groupAndAggregate", () => {
  it("groups rows by groupBy and computes one aggregate per group, sorted by category", () => {
    const rows = [
      { year: "2020", rating: 5 },
      { year: "2019", rating: 3 },
      { year: "2020", rating: 7 },
    ];
    const result = groupAndAggregate(rows, "year", "avg", "rating");
    expect(result.categories).toEqual(["2019", "2020"]);
    expect(result.values).toEqual([3, 6]);
  });

  it("reuses computeAggregate's coercion guard per group (empty-string excluded, not coerced to 0)", () => {
    const rows = [
      { year: "2020", rating: 5 },
      { year: "2020", rating: "" },
    ];
    const result = groupAndAggregate(rows, "year", "avg", "rating");
    expect(result.categories).toEqual(["2020"]);
    expect(result.values).toEqual([5]);
  });

  it("count aggregation distinguishes a real null from an empty string within a group", () => {
    // This is the round-2 design review's flagged case: a real JS null must
    // be excluded from count while a genuine empty string counts as present.
    const rows: Record<string, unknown>[] = [
      { year: "2020", title: "A" },
      { year: "2020", title: null },
      { year: "2020", title: "" },
    ];
    const result = groupAndAggregate(rows, "year", "count", "title");
    expect(result.categories).toEqual(["2020"]);
    // "A" and "" both count as present; null is excluded → 2, not 3.
    expect(result.values).toEqual([2]);
  });

  it("returns empty categories/values for an empty row set", () => {
    const result = groupAndAggregate([], "year", "sum", "rating");
    expect(result.categories).toEqual([]);
    expect(result.values).toEqual([]);
  });
});
