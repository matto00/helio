import {
  filterRowsForSelection,
  mapChartClickToSelection,
  resolvePieValueColumn,
} from "./chartClickSelection";
import type { ChartClickParams } from "./chartClickSelection";

describe("mapChartClickToSelection — bar/line single-series (design.md D3)", () => {
  const headers = ["quarter", "revenue"];
  const rawRows = [
    ["Q1", "100"],
    ["Q2", "200"],
  ];
  const fieldMapping = { xAxis: "quarter", yAxis: "revenue" };

  it("populates dimension, value, and series from the mapped columns", () => {
    const params: ChartClickParams = {
      componentType: "series",
      name: "Q1",
      seriesName: "revenue",
    };
    const selection = mapChartClickToSelection(params, "bar", fieldMapping, headers, rawRows);
    expect(selection).toEqual({ dimension: "quarter", value: "Q1", series: "revenue" });
  });
});

describe("mapChartClickToSelection — bar/line multi-series (fieldMapping.series grouped)", () => {
  const headers = ["quarter", "region", "revenue"];
  const rawRows = [
    ["Q1", "East", "100"],
    ["Q1", "West", "150"],
    ["Q2", "East", "120"],
  ];
  const fieldMapping = { xAxis: "quarter", yAxis: "revenue", series: "region" };

  it("resolves value from the clicked category and series from the clicked group, not any other group sharing that category", () => {
    const params: ChartClickParams = { componentType: "series", name: "Q1", seriesName: "West" };
    const selection = mapChartClickToSelection(params, "line", fieldMapping, headers, rawRows);
    expect(selection).toEqual({ dimension: "quarter", value: "Q1", series: "West" });
    expect(selection?.series).not.toBe("East");
  });
});

describe("mapChartClickToSelection — bar/line auto-detected multi-series (no yAxis mapping)", () => {
  const headers = ["quarter", "revenue", "cost"];
  const rawRows = [
    ["Q1", "100", "40"],
    ["Q2", "200", "80"],
  ];
  const fieldMapping = { xAxis: "quarter" };

  it("identifies the clicked auto-detected series via seriesName, same as the grouped-multi shape", () => {
    const params: ChartClickParams = { componentType: "series", name: "Q1", seriesName: "cost" };
    const selection = mapChartClickToSelection(params, "bar", fieldMapping, headers, rawRows);
    expect(selection).toEqual({ dimension: "quarter", value: "Q1", series: "cost" });
  });
});

describe("mapChartClickToSelection — pie (design.md D3)", () => {
  const headers = ["category", "amount"];
  const rawRows = [
    ["Books", "10"],
    ["Games", "20"],
  ];

  it("mapped-y case: value is the slice name, series is the mapped y-column name", () => {
    const fieldMapping = { xAxis: "category", yAxis: "amount" };
    const params: ChartClickParams = { componentType: "series", name: "Books" };
    const selection = mapChartClickToSelection(params, "pie", fieldMapping, headers, rawRows);
    expect(selection).toEqual({ dimension: "category", value: "Books", series: "amount" });
  });

  it("auto-detected case (no yAxis mapping): series resolves to the first numeric column", () => {
    const fieldMapping = { xAxis: "category" };
    const params: ChartClickParams = { componentType: "series", name: "Games" };
    const selection = mapChartClickToSelection(params, "pie", fieldMapping, headers, rawRows);
    expect(selection).toEqual({ dimension: "category", value: "Games", series: "amount" });
  });
});

describe("mapChartClickToSelection — scatter (design.md D3)", () => {
  const headers = ["x", "y", "region"];
  const rawRows = [
    ["1", "10", "East"],
    ["1", "20", "West"],
    ["2", "30", "East"],
  ];
  const fieldMapping = { xAxis: "x", yAxis: "y" };

  it("color-grouped: resolves the clicked point's group via seriesName", () => {
    const params: ChartClickParams = {
      componentType: "series",
      value: [1, 10],
      seriesName: "West",
    };
    const selection = mapChartClickToSelection(params, "scatter", fieldMapping, headers, rawRows, {
      colorField: "region",
    });
    expect(selection).toEqual({ dimension: "x", value: "1", series: "West" });
  });

  it("ungrouped: series falls back to the mapped y-column name", () => {
    const params: ChartClickParams = { componentType: "series", value: [2, 30] };
    const selection = mapChartClickToSelection(params, "scatter", fieldMapping, headers, rawRows);
    expect(selection).toEqual({ dimension: "x", value: "2", series: "y" });
  });

  it("two points sharing an x value both resolve to the same value", () => {
    const paramsA: ChartClickParams = {
      componentType: "series",
      value: [1, 10],
      seriesName: "East",
    };
    const paramsB: ChartClickParams = {
      componentType: "series",
      value: [1, 20],
      seriesName: "West",
    };
    const scatterOptions = { colorField: "region" };
    const selectionA = mapChartClickToSelection(
      paramsA,
      "scatter",
      fieldMapping,
      headers,
      rawRows,
      scatterOptions,
    );
    const selectionB = mapChartClickToSelection(
      paramsB,
      "scatter",
      fieldMapping,
      headers,
      rawRows,
      scatterOptions,
    );
    expect(selectionA?.value).toBe("1");
    expect(selectionB?.value).toBe("1");
  });
});

describe("resolvePieValueColumn", () => {
  const headers = ["category", "label", "amount"];
  const rawRows = [
    ["Books", "n/a", "10"],
    ["Games", "n/a", "20"],
  ];

  it("returns yCol directly when mapped", () => {
    expect(resolvePieValueColumn(rawRows, headers, 0, 2)).toBe(2);
  });

  it("auto-detects the first numeric column, skipping xCol and any non-numeric column", () => {
    expect(resolvePieValueColumn(rawRows, headers, 0, -1)).toBe(2);
  });

  it("returns -1 when no numeric column exists", () => {
    const noNumericRows = [["Books", "n/a", "n/a"]];
    expect(resolvePieValueColumn(noNumericRows, headers, 0, -1)).toBe(-1);
  });
});

describe("filterRowsForSelection — bar/line/pie (design.md D4)", () => {
  const headers = ["quarter", "region", "revenue"];
  const rawRows = [
    ["Q1", "East", "100"],
    ["Q1", "West", "150"],
    ["Q2", "East", "120"],
  ];

  it("filters by x-value alone when there is no series column (pie / single-series bar-line)", () => {
    const fieldMapping = { xAxis: "quarter", yAxis: "revenue" };
    const rows = filterRowsForSelection(rawRows, headers, fieldMapping, "bar", {
      value: "Q1",
      series: "revenue",
    });
    expect(rows).toEqual([
      ["Q1", "East", "100"],
      ["Q1", "West", "150"],
    ]);
  });

  it("filters by x-value AND series column when fieldMapping.series is set", () => {
    const fieldMapping = { xAxis: "quarter", yAxis: "revenue", series: "region" };
    const rows = filterRowsForSelection(rawRows, headers, fieldMapping, "line", {
      value: "Q1",
      series: "West",
    });
    expect(rows).toEqual([["Q1", "West", "150"]]);
  });
});

describe("filterRowsForSelection — scatter (design.md D4)", () => {
  const headers = ["x", "y", "region"];
  const rawRows = [
    ["1", "10", "East"],
    ["1", "20", "West"],
    ["2", "30", "East"],
  ];
  const fieldMapping = { xAxis: "x", yAxis: "y" };

  it("filters by numeric x-equality, narrowed by the color column when grouped", () => {
    const rows = filterRowsForSelection(
      rawRows,
      headers,
      fieldMapping,
      "scatter",
      { value: "1", series: "West" },
      { colorField: "region" },
    );
    expect(rows).toEqual([["1", "20", "West"]]);
  });

  it("matches numerically, not by raw string equality (e.g. '1' vs '1.0')", () => {
    const rows = filterRowsForSelection(
      [["1.0", "10", "East"]],
      headers,
      fieldMapping,
      "scatter",
      { value: "1", series: "East" },
      { colorField: "region" },
    );
    expect(rows).toEqual([["1.0", "10", "East"]]);
  });
});

describe("click mapping and row filtering agree on the same selection (regression guard)", () => {
  it("bar/line multi-series: the row filter matches exactly the rows the click mapping identified", () => {
    const headers = ["quarter", "region", "revenue"];
    const rawRows = [
      ["Q1", "East", "100"],
      ["Q1", "West", "150"],
      ["Q2", "East", "120"],
    ];
    const fieldMapping = { xAxis: "quarter", yAxis: "revenue", series: "region" };
    const params: ChartClickParams = { componentType: "series", name: "Q1", seriesName: "West" };
    const selection = mapChartClickToSelection(params, "bar", fieldMapping, headers, rawRows)!;
    const rows = filterRowsForSelection(rawRows, headers, fieldMapping, "bar", selection);
    expect(rows).toEqual([["Q1", "West", "150"]]);
  });

  it("pie: the row filter matches exactly the row the click mapping identified", () => {
    const headers = ["category", "amount"];
    const rawRows = [
      ["Books", "10"],
      ["Games", "20"],
    ];
    const fieldMapping = { xAxis: "category" };
    const params: ChartClickParams = { componentType: "series", name: "Games" };
    const selection = mapChartClickToSelection(params, "pie", fieldMapping, headers, rawRows)!;
    const rows = filterRowsForSelection(rawRows, headers, fieldMapping, "pie", selection);
    expect(rows).toEqual([["Games", "20"]]);
  });

  it("scatter (color-grouped): the row filter matches exactly the point the click mapping identified", () => {
    const headers = ["x", "y", "region"];
    const rawRows = [
      ["1", "10", "East"],
      ["1", "20", "West"],
    ];
    const fieldMapping = { xAxis: "x", yAxis: "y" };
    const scatterOptions = { colorField: "region" };
    const params: ChartClickParams = {
      componentType: "series",
      value: [1, 20],
      seriesName: "West",
    };
    const selection = mapChartClickToSelection(
      params,
      "scatter",
      fieldMapping,
      headers,
      rawRows,
      scatterOptions,
    )!;
    const rows = filterRowsForSelection(
      rawRows,
      headers,
      fieldMapping,
      "scatter",
      selection,
      scatterOptions,
    );
    expect(rows).toEqual([["1", "20", "West"]]);
  });
});
