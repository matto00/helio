import {
  filterRecordRowsByDimension,
  filterRowsByDimension,
  isPanelFilterableByDimension,
} from "./crossFilterRows";

// HEL-588 tasks.md 6.1 — filterRowsByDimension.
describe("filterRowsByDimension", () => {
  const headers = ["quarter", "region", "revenue"];
  const rawRows = [
    ["Q1", "East", "100"],
    ["Q1", "West", "150"],
    ["Q2", "East", "120"],
  ];

  it("narrows to rows whose dimension column matches the value", () => {
    const result = filterRowsByDimension(rawRows, headers, "quarter", "Q1");
    expect(result).toEqual([
      ["Q1", "East", "100"],
      ["Q1", "West", "150"],
    ]);
  });

  it("is a no-op (returns rawRows unchanged, same reference) when the dimension isn't in headers", () => {
    const result = filterRowsByDimension(rawRows, headers, "not-a-column", "Q1");
    expect(result).toBe(rawRows);
  });

  it("matches a numeric selection against a differently-formatted numeric cell", () => {
    const numericHeaders = ["metric", "value"];
    const numericRows = [
      ["a", "3.0"],
      ["b", "4"],
    ];
    const result = filterRowsByDimension(numericRows, numericHeaders, "value", "3");
    expect(result).toEqual([["a", "3.0"]]);
  });

  it("does not numeric-match a non-numeric cell against a numeric value", () => {
    const mixedHeaders = ["label", "value"];
    const mixedRows = [
      ["a", "3"],
      ["b", "three"],
    ];
    const result = filterRowsByDimension(mixedRows, mixedHeaders, "value", "3");
    expect(result).toEqual([["a", "3"]]);
  });

  it("matches empty-string and zero values by exact equality", () => {
    const headers2 = ["label", "count"];
    const rows2 = [
      ["a", "0"],
      ["b", ""],
      ["c", "1"],
    ];
    expect(filterRowsByDimension(rows2, headers2, "count", "0")).toEqual([["a", "0"]]);
    expect(filterRowsByDimension(rows2, headers2, "count", "")).toEqual([["b", ""]]);
  });

  it("returns an empty array when nothing matches", () => {
    const result = filterRowsByDimension(rawRows, headers, "quarter", "Q9");
    expect(result).toEqual([]);
  });
});

// evaluation-1.md CR1 — the Record<string,unknown>[] shape TableRenderer
// actually reads from `paginationRows` (via `PanelCardBody`'s own
// `paginationState[panel.id]` selector), which is a DIFFERENT row shape from
// `filterRowsByDimension`'s positional `string[][]` and was the exact gap
// that let a Table-kind sibling panel narrow its truncation disclosure while
// never narrowing its actually-rendered grid.
describe("filterRecordRowsByDimension", () => {
  const rows = [
    { quarter: "Q1", region: "East", revenue: 100 },
    { quarter: "Q1", region: "West", revenue: 150 },
    { quarter: "Q2", region: "East", revenue: 120 },
  ];

  it("narrows to rows whose dimension key matches the value", () => {
    const result = filterRecordRowsByDimension(rows, "quarter", "Q1");
    expect(result).toEqual([
      { quarter: "Q1", region: "East", revenue: 100 },
      { quarter: "Q1", region: "West", revenue: 150 },
    ]);
  });

  it("matches a numeric selection against a differently-typed numeric cell value", () => {
    // Pagination rows carry NATIVE typed values (a number, not a string) —
    // unlike `filterRowsByDimension`'s already-stringified `rawRows`.
    const result = filterRecordRowsByDimension(rows, "revenue", "100");
    expect(result).toEqual([{ quarter: "Q1", region: "East", revenue: 100 }]);
  });

  it("treats null/undefined cells as empty string, matching only an empty-string selection", () => {
    const withNulls = [
      { label: "a", value: null },
      { label: "b", value: undefined },
      { label: "c", value: "0" },
    ];
    expect(filterRecordRowsByDimension(withNulls, "value", "")).toEqual([
      { label: "a", value: null },
      { label: "b", value: undefined },
    ]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterRecordRowsByDimension(rows, "quarter", "Q9")).toEqual([]);
  });
});

// HEL-588 tasks.md 6.2 — the per-output-kind filterable-panel check.
describe("isPanelFilterableByDimension", () => {
  describe("table", () => {
    it("matches when columnOrder (present, non-empty) includes the dimension", () => {
      expect(
        isPanelFilterableByDimension(
          "table",
          { columnOrder: ["quarter", "revenue"] },
          null,
          "quarter",
        ),
      ).toBe(true);
    });

    it("excludes a dimension not in a present, non-empty columnOrder", () => {
      expect(
        isPanelFilterableByDimension("table", { columnOrder: ["revenue"] }, null, "quarter"),
      ).toBe(false);
    });

    it("falls back to all loaded headers when columnOrder is absent", () => {
      expect(isPanelFilterableByDimension("table", {}, ["quarter", "revenue"], "quarter")).toBe(
        true,
      );
    });

    it("falls back to all loaded headers when columnOrder is present but empty", () => {
      expect(
        isPanelFilterableByDimension("table", { columnOrder: [] }, ["quarter"], "quarter"),
      ).toBe(true);
    });

    it("excludes a dimension absent from both columnOrder and loaded headers", () => {
      expect(isPanelFilterableByDimension("table", {}, ["revenue"], "quarter")).toBe(false);
    });
  });

  describe("every other output kind", () => {
    it("chart: matches when a fieldMapping value equals the dimension", () => {
      expect(
        isPanelFilterableByDimension(
          "chart",
          { fieldMapping: { xAxis: "quarter", yAxis: "revenue" } },
          null,
          "quarter",
        ),
      ).toBe(true);
    });

    it("metric: matches via its own fieldMapping", () => {
      expect(
        isPanelFilterableByDimension(
          "metric",
          { fieldMapping: { value: "revenue" } },
          null,
          "revenue",
        ),
      ).toBe(true);
    });

    it("markdown/collection/timeline all read fieldMapping the same way", () => {
      const config = { fieldMapping: { primary: "region" } };
      expect(isPanelFilterableByDimension("markdown", config, null, "region")).toBe(true);
      expect(isPanelFilterableByDimension("collection", config, null, "region")).toBe(true);
      expect(isPanelFilterableByDimension("timeline", config, null, "region")).toBe(true);
    });

    // spec.md "a panel with an unmapped, same-named column is unaffected" —
    // the load-bearing distinction from a plain header-presence check.
    it("excludes a panel whose underlying data has a same-named column that its own field mapping doesn't reference", () => {
      expect(
        isPanelFilterableByDimension(
          "chart",
          { fieldMapping: { xAxis: "region" } },
          ["region", "quarter"],
          "quarter",
        ),
      ).toBe(false);
    });

    it("an unrecognized output kind never matches (empty field mapping)", () => {
      expect(
        isPanelFilterableByDimension(
          "unsupported-kind",
          { fieldMapping: { a: "quarter" } },
          null,
          "quarter",
        ),
      ).toBe(false);
    });
  });
});
