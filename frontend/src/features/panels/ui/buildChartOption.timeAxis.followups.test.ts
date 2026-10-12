// HEL-1508 -- follow-ups to the HEL-1305 time axis: same-instant bar fallback and non-numeric y gaps.
import { build, SERIES_HEADERS, seriesOf, TIMESTAMP_X, utc, xAxisOf } from "./timeAxisTestSupport";

beforeAll(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(
      () => ({ measureText: (t: string) => ({ width: t.length * 6 }), font: "" }) as never,
    );
});

const MAPPING = { xAxis: "day", yAxis: "amount" };
const SAME_DAY = [
  ["2026-10-09", "7", "e"],
  ["2026-10-01", "5", "e"],
  ["2026-10-01", "9", "e"],
];

const bar = (rows: string[][], extra: Record<string, unknown> = {}) =>
  build("bar", {
    rows,
    headers: SERIES_HEADERS,
    fieldMapping: MAPPING,
    fieldTypes: TIMESTAMP_X,
    ...extra,
  });

describe("a raw-row vertical bar with a repeated instant falls back to a category axis", () => {
  it("keeps one bar per row, in instant order, so neither value is hidden", () => {
    const option = bar(SAME_DAY);
    expect(xAxisOf(option)).toMatchObject({
      type: "category",
      data: ["2026-10-01", "2026-10-01", "2026-10-09"],
    });
    expect(seriesOf(option)[0].data).toEqual([5, 9, 7]);
  });

  it("stays on the time axis when every instant is distinct", () => {
    expect(xAxisOf(bar(SAME_DAY.slice(0, 2))).type).toBe("time");
  });

  it("counts two spellings of one instant as a repeat", () => {
    const option = bar([
      ["2026-10-01", "5", "e"],
      ["2026-10-01T00:00:00Z", "9", "e"],
    ]);
    expect(xAxisOf(option).type).toBe("category");
    expect(seriesOf(option)[0].data).toEqual([5, 9]);
  });

  it("keeps a row whose x denotes no instant as its own last bar", () => {
    const option = bar([...SAME_DAY, ["n/a", "3", "e"]]);
    expect(xAxisOf(option).data).toEqual(["2026-10-01", "2026-10-01", "2026-10-09", "n/a"]);
    expect(seriesOf(option)[0].data).toEqual([5, 9, 7, 3]);
  });

  it("applies to the auto-detected series when no y field is mapped", () => {
    const option = build("bar", {
      rows: [
        ["2026-10-02", "4"],
        ["2026-10-01", "5"],
        ["2026-10-01", "9"],
      ],
      headers: ["day", "amount"],
      fieldMapping: { xAxis: "day" },
      fieldTypes: TIMESTAMP_X,
    });
    expect(xAxisOf(option).type).toBe("category");
    expect(seriesOf(option)[0].data).toEqual([5, 9, 4]);
  });

  it("leaves a line, a scatter, a multi-series bar and a horizontal bar as they were", () => {
    expect(
      xAxisOf(
        build("line", {
          rows: SAME_DAY,
          headers: SERIES_HEADERS,
          fieldMapping: MAPPING,
          fieldTypes: TIMESTAMP_X,
        }),
      ).type,
    ).toBe("time");
    expect(
      xAxisOf(
        build("scatter", {
          rows: SAME_DAY,
          headers: SERIES_HEADERS,
          fieldMapping: MAPPING,
          fieldTypes: TIMESTAMP_X,
        }),
      ).type,
    ).toBe("time");
    expect(
      xAxisOf(
        build("bar", {
          rows: SAME_DAY,
          headers: SERIES_HEADERS,
          fieldMapping: { ...MAPPING, series: "region" },
          fieldTypes: TIMESTAMP_X,
        }),
      ).type,
    ).toBe("time");
    const horizontal = bar(SAME_DAY, { chartOptions: { bar: { orientation: "horizontal" } } });
    expect(horizontal.xAxis).not.toMatchObject({ type: "time" });
  });

  it("a fallback bar is an ordinary category chart: the 'vs' overlay aligns by category string", () => {
    const option = bar(SAME_DAY, {
      overlay: {
        label: "vs",
        points: [
          ["2026-10-01", 1],
          ["2026-10-09", 2],
        ],
      },
    });
    const vs = seriesOf(option).find((s) => s.name === "vs");
    expect(vs?.data).toEqual([1, 1, 2]);
  });

  it("an aggregated bar is unaffected", () => {
    const option = bar(SAME_DAY, {
      chartAggregate: {
        categories: ["2026-10-01", "2026-10-09"],
        values: [14, 7],
        seriesName: "sum",
        groupBy: "day",
      },
    });
    expect(xAxisOf(option).type).toBe("time");
  });
});

describe("a non-numeric y is a gap on single-series and auto-detect charts", () => {
  const rows = [
    ["2026-10-01", "4", "e"],
    ["2026-10-02", "n/a", "e"],
    ["2026-10-03", "", "e"],
    ["2026-10-04", "7", "e"],
  ];

  it("category single-series: null, not 0", () => {
    const option = build("bar", { rows, headers: SERIES_HEADERS, fieldMapping: MAPPING });
    expect(seriesOf(option)[0].data).toEqual([4, null, null, 7]);
  });

  it("category auto-detect: null, not 0", () => {
    const option = build("line", {
      rows,
      headers: SERIES_HEADERS,
      fieldMapping: { xAxis: "day" },
    });
    expect(seriesOf(option)[0].data).toEqual([4, null, null, 7]);
  });

  it("time single-series: [instant, null]", () => {
    const option = build("line", {
      rows,
      headers: SERIES_HEADERS,
      fieldMapping: MAPPING,
      fieldTypes: TIMESTAMP_X,
    });
    expect((seriesOf(option)[0].data as Array<{ value: unknown[] }>).map((p) => p.value)).toEqual([
      [utc("2026-10-01"), 4],
      [utc("2026-10-02"), null],
      [utc("2026-10-03"), null],
      [utc("2026-10-04"), 7],
    ]);
  });

  it("time auto-detect: [instant, null]", () => {
    const option = build("bar", {
      rows,
      headers: SERIES_HEADERS,
      fieldMapping: { xAxis: "day" },
      fieldTypes: TIMESTAMP_X,
    });
    expect(
      (seriesOf(option)[0].data as Array<{ value: unknown[] }>).map((p) => p.value[1]),
    ).toEqual([4, null, null, 7]);
  });

  it("the fallback bar output uses the same null rule", () => {
    const option = bar([...SAME_DAY, ["2026-10-05", "n/a", "e"]]);
    expect(seriesOf(option)[0].data).toEqual([5, 9, null, 7]);
  });

  it("a scatter point with no numeric y is not drawn (category and time axes)", () => {
    for (const fieldTypes of [undefined, TIMESTAMP_X]) {
      const option = build("scatter", {
        rows,
        headers: SERIES_HEADERS,
        fieldMapping: MAPPING,
        fieldTypes,
      });
      expect(seriesOf(option)[0].data).toHaveLength(2);
    }
  });

  it("a coloured scatter draws no point for a non-numeric y either", () => {
    for (const fieldTypes of [undefined, TIMESTAMP_X]) {
      const option = build("scatter", {
        rows,
        headers: SERIES_HEADERS,
        fieldMapping: MAPPING,
        fieldTypes,
        chartOptions: { scatter: { colorField: "region" } },
      });
      expect(seriesOf(option)).toHaveLength(1);
      expect(seriesOf(option)[0].data).toHaveLength(2);
    }
  });

  it("normalized stacking treats a single-series null as no value", () => {
    const option = build("bar", {
      rows,
      headers: SERIES_HEADERS,
      fieldMapping: MAPPING,
      chartOptions: { bar: { stacking: "normalized" } },
    });
    expect(seriesOf(option)[0].data).toEqual([100, null, null, 100]);
  });

  it("the tooltip valueFormatter renders a null value as an em dash", () => {
    const option = build("bar", { rows, headers: SERIES_HEADERS, fieldMapping: MAPPING });
    const format = (option.tooltip as { valueFormatter: (v: unknown) => string }).valueFormatter;
    expect(format(seriesOf(option)[0].data?.[1])).toBe("—");
  });
});
