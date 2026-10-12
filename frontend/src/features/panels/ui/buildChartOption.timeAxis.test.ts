// HEL-1305 -- the time x axis and the multi-series gap on the option builder.
import * as echarts from "echarts";

import {
  mapChartClickToSelection,
  filterRowsForSelection,
} from "../../../utils/chartClickSelection";
import {
  build,
  internals,
  SERIES_HEADERS,
  SERIES_MAPPING,
  seriesOf,
  TIMESTAMP_X,
  utc,
  xAxisOf,
} from "./timeAxisTestSupport";

beforeAll(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(
      () => ({ measureText: (t: string) => ({ width: t.length * 6 }), font: "" }) as never,
    );
});

const DAYS = [
  ["2026-10-09", "9", "east"],
  ["2026-10-01", "1", "east"],
  ["2026-10-02", "2", "east"],
];

describe("a multi-series chart plots a gap, not 0, where a series has no value (category axis)", () => {
  const rows = [
    ["Mon", "1", "A"],
    ["Mon", "2", "B"],
    ["Tue", "3", "A"],
    ["Wed", "5", "A"],
    ["Wed", "6", "B"],
  ];

  it("emits null for the series that misses an x", () => {
    const option = build("line", { rows, headers: SERIES_HEADERS, fieldMapping: SERIES_MAPPING });
    const [a, b] = seriesOf(option);
    expect(a.data).toEqual([1, 3, 5]);
    expect(b.data).toEqual([2, null, 6]);
    expect(xAxisOf(option)).toMatchObject({ type: "category", data: ["Mon", "Tue", "Wed"] });
  });

  it("emits null for a row whose y is not numeric", () => {
    const withBlank = [...rows.slice(0, 4), ["Wed", "n/a", "B"], ["Mon", "2", "B"]];
    const [, b] = seriesOf(
      build("bar", { rows: withBlank, headers: SERIES_HEADERS, fieldMapping: SERIES_MAPPING }),
    );
    expect(b.data).toEqual([2, null, null]);
  });

  it("shows a gap as an em dash in the tooltip, never 0 or undefined", () => {
    const option = build("line", { rows, headers: SERIES_HEADERS, fieldMapping: SERIES_MAPPING });
    const format = (option.tooltip as { valueFormatter: (v: unknown) => string }).valueFormatter;
    expect(format(undefined)).toBe("—");
    expect(format(null)).toBe("—");
    expect(format(Number.NaN)).toBe("—");
    expect(format(3)).toBe("3");
    expect(format("Mon")).toBe("Mon");
  });
});

describe("a timestamp x field renders on a time axis", () => {
  it("sorts irregular dates and keeps each raw x as the point name", () => {
    const option = build("line", {
      rows: DAYS,
      headers: SERIES_HEADERS,
      fieldMapping: { xAxis: "day", yAxis: "amount" },
      fieldTypes: TIMESTAMP_X,
    });
    expect(xAxisOf(option)).toMatchObject({ type: "time" });
    expect(xAxisOf(option).data).toBeUndefined();
    expect(option.useUTC).toBe(true);
    expect(seriesOf(option)[0].data).toEqual([
      { name: "2026-10-01", value: [utc("2026-10-01"), 1] },
      { name: "2026-10-02", value: [utc("2026-10-02"), 2] },
      { name: "2026-10-09", value: [utc("2026-10-09"), 9] },
    ]);
  });

  it("spaces the points in proportion to the time between them on a real ECharts instance", () => {
    const option = build("line", {
      rows: DAYS,
      headers: SERIES_HEADERS,
      fieldMapping: { xAxis: "day", yAxis: "amount" },
      fieldTypes: TIMESTAMP_X,
    });
    const chart = echarts.init(null as never, undefined, {
      renderer: "svg",
      ssr: true,
      width: 800,
      height: 400,
    });
    chart.setOption(option);
    // Rendered pixel x of each plotted point, in the order the series draws them.
    const data = internals(chart).getModel().getSeriesByIndex(0).getData();
    const points = data.getLayout("points");
    const px = [points[0], points[2], points[4]];
    chart.dispose();
    expect((px[2] - px[1]) / (px[1] - px[0])).toBeCloseTo(7, 5);
  });

  it("reads a time-zone-less date-time as UTC and tooltips it with the time", () => {
    const option = build("line", {
      rows: [["2026-10-01T12:00", "4", "east"]],
      headers: SERIES_HEADERS,
      fieldMapping: { xAxis: "day", yAxis: "amount" },
      fieldTypes: TIMESTAMP_X,
    });
    expect(seriesOf(option)[0].data).toEqual([
      { name: "2026-10-01T12:00", value: [utc("2026-10-01T12:00"), 4] },
    ]);
  });

  it("does not plot a row whose x denotes no instant", () => {
    const option = build("bar", {
      rows: [...DAYS, ["garbage", "5", "east"], ["", "6", "east"]],
      headers: SERIES_HEADERS,
      fieldMapping: { xAxis: "day", yAxis: "amount" },
      fieldTypes: TIMESTAMP_X,
    });
    expect(seriesOf(option)[0].data).toHaveLength(3);
  });

  it("multi-series: every series shares the sorted instants and a missing point is null", () => {
    const rows = [
      ["2026-10-09", "9", "A"],
      ["2026-10-01", "1", "A"],
      ["2026-10-02", "2", "A"],
      ["2026-10-09", "90", "B"],
      ["2026-10-01", "10", "B"],
    ];
    const option = build("line", {
      rows,
      headers: SERIES_HEADERS,
      fieldMapping: SERIES_MAPPING,
      fieldTypes: TIMESTAMP_X,
    });
    const [a, b] = seriesOf(option);
    const ys = (s: typeof a) => (s.data as Array<{ value: [number, unknown] }>).map((p) => p.value);
    expect(ys(a)).toEqual([
      [utc("2026-10-01"), 1],
      [utc("2026-10-02"), 2],
      [utc("2026-10-09"), 9],
    ]);
    expect(ys(b)).toEqual([
      [utc("2026-10-01"), 10],
      [utc("2026-10-02"), null],
      [utc("2026-10-09"), 90],
    ]);
  });

  it("multi-series: two spellings of one instant are one x, not a false gap", () => {
    const rows = [
      ["2026-10-02", "2", "A"],
      ["2026-10-02T00:00:00Z", "20", "B"],
    ];
    const [a, b] = seriesOf(
      build("line", {
        rows,
        headers: SERIES_HEADERS,
        fieldMapping: SERIES_MAPPING,
        fieldTypes: TIMESTAMP_X,
      }),
    );
    expect(a.data).toEqual([{ name: "2026-10-02", value: [utc("2026-10-02"), 2] }]);
    expect(b.data).toEqual([{ name: "2026-10-02", value: [utc("2026-10-02"), 20] }]);
  });

  it("auto-detect branch (no y mapping) plots every numeric column on the time axis", () => {
    const option = build("line", {
      rows: [
        ["2026-10-09", "9", "x"],
        ["2026-10-01", "1", "y"],
      ],
      headers: ["day", "a", "label"],
      fieldMapping: { xAxis: "day" },
      fieldTypes: TIMESTAMP_X,
    });
    expect(xAxisOf(option)).toMatchObject({ type: "time" });
    expect(seriesOf(option)).toHaveLength(1);
    expect(seriesOf(option)[0].data).toEqual([
      { name: "2026-10-01", value: [utc("2026-10-01"), 1] },
      { name: "2026-10-09", value: [utc("2026-10-09"), 9] },
    ]);
  });

  it("scatter plots [instant, y] and a click on it selects the raw x", () => {
    const mapping = { xAxis: "day", yAxis: "amount" };
    const rows = [
      ["2026-10-09", "9", "e"],
      ["2026-10-01", "1", "e"],
    ];
    const option = build("scatter", {
      rows,
      headers: SERIES_HEADERS,
      fieldMapping: mapping,
      fieldTypes: TIMESTAMP_X,
    });
    expect(xAxisOf(option)).toMatchObject({ type: "time" });
    const first = seriesOf(option)[0].data?.[0] as { name: string; value: number[] };
    expect(first).toEqual({ name: "2026-10-01", value: [utc("2026-10-01"), 1] });
    const selection = mapChartClickToSelection(
      { name: first.name, value: first.value },
      "scatter",
      mapping,
      SERIES_HEADERS,
      rows,
    );
    expect(selection).toEqual({ dimension: "day", value: "2026-10-01", series: "amount" });
    expect(filterRowsForSelection(rows, SERIES_HEADERS, mapping, "scatter", selection!)).toEqual([
      rows[1],
    ]);
  });

  it("a stacked time-axis bar keeps one stack over identical instants", () => {
    const option = build("bar", {
      rows: [
        ["2026-10-01", "1", "A"],
        ["2026-10-01", "2", "B"],
        ["2026-10-09", "3", "B"],
      ],
      headers: SERIES_HEADERS,
      fieldMapping: SERIES_MAPPING,
      fieldTypes: TIMESTAMP_X,
      chartOptions: { bar: { stacking: "stacked" } },
    });
    const [a, b] = seriesOf(option);
    expect(xAxisOf(option).type).toBe("time");
    expect((a.data as Array<{ value: unknown[] }>).map((p) => p.value)).toEqual([
      [utc("2026-10-01"), 1],
      [utc("2026-10-09"), null],
    ]);
    expect(a.stack).toBe("total");
    expect(b.stack).toBe("total");
    expect((a.data as unknown[]).length).toBe((b.data as unknown[]).length);
  });

  it("normalized stacking sums to 100 per instant and keeps a missing value null", () => {
    const option = build("bar", {
      rows: [
        ["2026-10-01", "30", "A"],
        ["2026-10-09", "10", "A"],
        ["2026-10-09", "30", "B"],
      ],
      headers: SERIES_HEADERS,
      fieldMapping: SERIES_MAPPING,
      fieldTypes: TIMESTAMP_X,
      chartOptions: { bar: { stacking: "normalized" } },
    });
    const [a, b] = seriesOf(option);
    const ys = (s: typeof a) =>
      (s.data as Array<{ value: [number, unknown] }>).map((p) => p.value[1]);
    expect(ys(a)).toEqual([100, 25]);
    expect(ys(b)).toEqual([null, 75]);
  });

  it("normalized stacking on a category axis also keeps a missing value null", () => {
    const [a, b] = seriesOf(
      build("bar", {
        rows: [
          ["Mon", "30", "A"],
          ["Tue", "10", "A"],
          ["Tue", "30", "B"],
        ],
        headers: SERIES_HEADERS,
        fieldMapping: SERIES_MAPPING,
        chartOptions: { bar: { stacking: "normalized" } },
      }),
    );
    expect(a.data).toEqual([100, 25]);
    expect(b.data).toEqual([null, 75]);
  });

  it("hides overlapping x labels on a time axis only (a narrow chart would run them together)", () => {
    const labels = (o: ReturnType<typeof build>) =>
      (xAxisOf(o) as { axisLabel?: { hideOverlap?: boolean } }).axisLabel;
    const time = build("line", {
      rows: DAYS,
      headers: SERIES_HEADERS,
      fieldMapping: { xAxis: "day", yAxis: "amount" },
      fieldTypes: TIMESTAMP_X,
    });
    expect(labels(time)?.hideOverlap).toBe(true);
    const category = build("line", {
      rows: DAYS,
      headers: SERIES_HEADERS,
      fieldMapping: { xAxis: "day", yAxis: "amount" },
    });
    expect(labels(category)).not.toHaveProperty("hideOverlap");
  });

  it("the time x axis keeps the appearance's name and label styling", () => {
    const option = build("line", {
      rows: DAYS,
      headers: SERIES_HEADERS,
      fieldMapping: { xAxis: "day", yAxis: "amount" },
      fieldTypes: TIMESTAMP_X,
    });
    expect(xAxisOf(option)).toMatchObject({
      type: "time",
      axisLabel: expect.objectContaining({ color: "#abcdef" }),
    });
  });
});

describe("the aggregated (grouped-by-timestamp) path", () => {
  const aggregate = {
    categories: ["2026-10-01", "2026-10-09", "null"],
    values: [3, 9, 1],
    seriesName: "sum(amount)",
    groupBy: "day",
  };

  it("plots groups on a time axis ordered by instant and drops an unparseable group", () => {
    const option = build("bar", {
      rows: DAYS,
      headers: SERIES_HEADERS,
      fieldTypes: TIMESTAMP_X,
      chartAggregate: { ...aggregate, categories: ["2026-10-09", "2026-10-01", "null"] },
    });
    expect(xAxisOf(option)).toMatchObject({ type: "time" });
    expect(seriesOf(option)[0].data).toEqual([
      { name: "2026-10-01", value: [utc("2026-10-01"), 9] },
      { name: "2026-10-09", value: [utc("2026-10-09"), 3] },
    ]);
  });

  it("keeps the category axis when groupBy is absent or not a timestamp", () => {
    const { groupBy: _omitted, ...noGroupBy } = aggregate;
    for (const [agg, types] of [
      [noGroupBy, TIMESTAMP_X],
      [aggregate, { day: "string" }],
      [aggregate, null],
    ] as const) {
      const option = build("bar", {
        rows: DAYS,
        headers: SERIES_HEADERS,
        fieldTypes: types,
        chartAggregate: agg,
      });
      expect(xAxisOf(option)).toMatchObject({ type: "category", data: aggregate.categories });
    }
  });
});

describe("GUARD: every chart that is not a timestamp-x line/scatter/vertical bar is unchanged", () => {
  const mapping = { xAxis: "day", yAxis: "amount" };
  const categories = ["2026-10-09", "2026-10-01", "2026-10-02"];

  it.each(["line", "bar", "scatter"] as const)(
    "%s with a string-typed or absent-typed x keeps the category axis in row order",
    (chartType) => {
      for (const fieldTypes of [{ day: "string" }, null, undefined]) {
        const option = build(chartType, {
          rows: DAYS,
          headers: SERIES_HEADERS,
          fieldMapping: mapping,
          fieldTypes,
        });
        expect(option.useUTC).toBeUndefined();
        expect(xAxisOf(option)).toMatchObject({ type: "category" });
        if (chartType === "scatter") {
          expect(seriesOf(option)[0].data).toEqual([
            [2026, 9],
            [2026, 1],
            [2026, 2],
          ]);
        } else {
          expect(xAxisOf(option).data).toEqual(categories);
          expect(seriesOf(option)[0].data).toEqual([9, 1, 2]);
        }
      }
    },
  );

  it("a horizontal bar with a timestamp x keeps its category axis (on y)", () => {
    const option = build("bar", {
      rows: DAYS,
      headers: SERIES_HEADERS,
      fieldMapping: mapping,
      fieldTypes: TIMESTAMP_X,
      chartOptions: { bar: { orientation: "horizontal" } },
    });
    expect(option.useUTC).toBeUndefined();
    expect(option.yAxis).toMatchObject({ type: "category", data: categories });
    expect(seriesOf(option)[0].data).toEqual([9, 1, 2]);
  });

  it("a pie with a timestamp x is unchanged", () => {
    const option = build("pie", {
      rows: DAYS,
      headers: SERIES_HEADERS,
      fieldMapping: mapping,
      fieldTypes: TIMESTAMP_X,
    });
    expect(option.useUTC).toBeUndefined();
    expect(seriesOf(option)[0].data).toEqual([
      { name: "2026-10-09", value: 9 },
      { name: "2026-10-01", value: 1 },
      { name: "2026-10-02", value: 2 },
    ]);
  });

  it("a single-series category chart plots a non-numeric y as a gap (HEL-1508: gap-everywhere)", () => {
    const option = build("line", {
      rows: [
        ["Mon", "n/a", "x"],
        ["Tue", "2", "x"],
      ],
      headers: SERIES_HEADERS,
      fieldMapping: mapping,
    });
    expect(seriesOf(option)[0].data).toEqual([null, 2]);
  });

  it("a string-typed x multi-series chart keeps first-seen row order", () => {
    const option = build("line", {
      rows: [
        ["b", "1", "A"],
        ["a", "2", "A"],
      ],
      headers: SERIES_HEADERS,
      fieldMapping: SERIES_MAPPING,
      fieldTypes: { day: "string" },
    });
    expect(xAxisOf(option).data).toEqual(["b", "a"]);
  });
});
