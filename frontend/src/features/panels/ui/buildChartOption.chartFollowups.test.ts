// HEL-1517 -- follow-ups to HEL-1508: tick floor, summed duplicate x+series rows, scatter non-numeric x,
// and the marker kept on a value that stands alone between gaps.
import { build, SERIES_HEADERS, seriesOf, TIMESTAMP_X, xAxisOf } from "./timeAxisTestSupport";

beforeAll(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(
      () => ({ measureText: (t: string) => ({ width: t.length * 6 }), font: "" }) as never,
    );
});

const DAY = 86_400_000;
const HOUR = 3_600_000;
const utc = (iso: string): number => Date.parse(`${iso}Z`);

const minIntervalOf = (o: ReturnType<typeof build>) =>
  (o.xAxis as { minInterval?: number }).minInterval;

describe("item 1: a time axis never ticks finer than its data", () => {
  const line = (rows: string[][]) =>
    build("line", {
      rows,
      headers: ["day", "amount"],
      fieldMapping: { xAxis: "day", yAxis: "amount" },
      fieldTypes: TIMESTAMP_X,
    });

  it("sets a one-day minimum on whole-day raw rows", () => {
    const option = line([
      ["2026-10-01", "1"],
      ["2026-10-02", "2"],
    ]);
    expect(xAxisOf(option).type).toBe("time");
    expect(minIntervalOf(option)).toBe(DAY);
  });

  it("sets a one-hour minimum on whole-hour data that is not all midnight", () => {
    expect(
      minIntervalOf(
        line([
          ["2026-10-01T00:00:00Z", "1"],
          ["2026-10-01T03:00:00Z", "2"],
        ]),
      ),
    ).toBe(HOUR);
  });

  it("sets no minimum when an instant has a millisecond part", () => {
    expect(
      minIntervalOf(
        line([
          ["2026-10-01T00:00:00Z", "1"],
          ["2026-10-01T00:00:00.500Z", "2"],
        ]),
      ),
    ).toBeUndefined();
  });

  it("sets a one-day minimum on an aggregation grouped by a daily timestamp", () => {
    const option = build("bar", {
      rows: [["x", "1"]],
      headers: ["day", "amount"],
      fieldTypes: TIMESTAMP_X,
      chartAggregate: {
        categories: ["2026-10-01", "2026-10-02"],
        values: [1, 2],
        seriesName: "sum",
        groupBy: "day",
      },
    });
    expect(xAxisOf(option).type).toBe("time");
    expect(minIntervalOf(option)).toBe(DAY);
  });

  it("sets no minimum on a category axis", () => {
    const option = build("line", {
      rows: [
        ["2026-10-01", "1"],
        ["2026-10-02", "2"],
      ],
      headers: ["day", "amount"],
      fieldMapping: { xAxis: "day", yAxis: "amount" },
      fieldTypes: { day: "string" },
    });
    expect(xAxisOf(option).type).toBe("category");
    expect(minIntervalOf(option)).toBeUndefined();
  });
});

describe("item 2: rows sharing an x and series are summed", () => {
  const MAPPING = { xAxis: "day", yAxis: "amount", series: "region" };
  const multi = (
    chartType: "line" | "bar",
    rows: string[][],
    fieldTypes: Record<string, string> | null,
  ) => build(chartType, { rows, headers: SERIES_HEADERS, fieldMapping: MAPPING, fieldTypes });

  it("adds two rows at one category x and series", () => {
    const option = multi(
      "bar",
      [
        ["Mon", "3", "A"],
        ["Mon", "4", "A"],
        ["Tue", "1", "A"],
        ["Mon", "9", "B"],
      ],
      { day: "string" },
    );
    expect(seriesOf(option).map((s) => [s.name, s.data])).toEqual([
      ["A", [7, 1]],
      ["B", [9, null]],
    ]);
  });

  it("lets a non-numeric y contribute nothing, and keeps an all-non-numeric cell a gap", () => {
    const option = multi(
      "line",
      [
        ["Mon", "3", "A"],
        ["Mon", "n/a", "A"],
        ["Tue", "n/a", "A"],
      ],
      { day: "string" },
    );
    expect(seriesOf(option)[0].data).toEqual([3, null]);
  });

  it("adds two spellings of one instant on a time axis", () => {
    const option = multi(
      "line",
      [
        ["2026-10-01", "2", "A"],
        ["2026-10-01T00:00:00Z", "5", "A"],
      ],
      TIMESTAMP_X,
    );
    expect(xAxisOf(option).type).toBe("time");
    expect(seriesOf(option)[0].data).toEqual([
      { name: "2026-10-01", value: [utc("2026-10-01T00:00:00"), 7] },
    ]);
  });

  it("does not add different times on one date", () => {
    const option = multi(
      "line",
      [
        ["2026-10-01T01:00", "2", "A"],
        ["2026-10-01T02:00", "5", "A"],
      ],
      TIMESTAMP_X,
    );
    expect(
      (seriesOf(option)[0].data as Array<{ value: unknown[] }>).map((d) => d.value[1]),
    ).toEqual([2, 5]);
  });
});

describe("item 3: a scatter does not plot a non-numeric x at 0", () => {
  const scatter = (rows: string[][], extra: Record<string, unknown> = {}) =>
    build("scatter", {
      rows,
      headers: ["label", "n", "g"],
      fieldMapping: { xAxis: "label", yAxis: "n" },
      fieldTypes: { label: "string" },
      ...extra,
    });

  it("draws no point for a row whose x is not numeric", () => {
    const option = scatter([
      ["1", "10", "a"],
      ["abc", "20", "a"],
      ["3", "30", "a"],
    ]);
    expect(seriesOf(option)[0].data).toEqual([
      [1, 10],
      [3, 30],
    ]);
  });

  it("applies per colour group and keeps an emptied group's legend entry", () => {
    const option = scatter(
      [
        ["1", "10", "a"],
        ["abc", "20", "b"],
      ],
      { chartOptions: { scatter: { colorField: "g" } } },
    );
    expect(seriesOf(option).map((s) => [s.name, s.data])).toEqual([
      ["a", [[1, 10]]],
      ["b", []],
    ]);
  });
});

describe("item 4: an isolated value keeps a marker on a line with markers off", () => {
  type Mark = { markPoint?: { data: Array<{ coord: unknown[] }>; silent?: boolean } };
  const marks = (o: ReturnType<typeof build>) =>
    (seriesOf(o)[0] as Mark).markPoint?.data.map((d) => d.coord);
  const off = { line: { showPoints: false } };
  const category = (ys: string[], xs?: string[], chartOptions: object | null = off) =>
    build("line", {
      rows: ys.map((y, i) => [xs?.[i] ?? `c${i}`, y]),
      headers: ["x", "y"],
      fieldMapping: { xAxis: "x", yAxis: "y" },
      fieldTypes: { x: "string" },
      chartOptions: chartOptions ?? undefined,
    });

  it("marks a value between two gaps, and an end value whose only neighbour is a gap", () => {
    expect(marks(category(["4", "n/a", "7", "n/a", "5", "6"]))).toEqual([
      [0, 4],
      [2, 7],
    ]);
  });

  it("marks the only value of a series", () => {
    expect(marks(category(["n/a", "9", "n/a"]))).toEqual([[1, 9]]);
    expect(marks(category(["9"]))).toEqual([[0, 9]]);
  });

  it("marks nothing when every value has a numeric neighbour", () => {
    expect((seriesOf(category(["1", "2", "3"]))[0] as Mark).markPoint).toBeUndefined();
  });

  it("does not mark a point with one numeric neighbour", () => {
    expect(marks(category(["1", "2", "n/a", "n/a", "5"]))).toEqual([[4, 5]]);
  });

  it("is silent, so a click never lands on it", () => {
    expect((seriesOf(category(["n/a", "9", "n/a"]))[0] as Mark).markPoint?.silent).toBe(true);
  });

  it("places a marker by category index, so a repeated category lands where it is drawn", () => {
    expect(marks(category(["1", "n/a", "3"], ["a", "b", "a"]))).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("uses the instant as the coord on a time axis", () => {
    const option = build("line", {
      rows: [
        ["2026-10-01", "1"],
        ["2026-10-02", "n/a"],
        ["2026-10-03", "3"],
      ],
      headers: ["day", "y"],
      fieldMapping: { xAxis: "day", yAxis: "y" },
      fieldTypes: TIMESTAMP_X,
      chartOptions: off,
    });
    expect(marks(option)).toEqual([
      [utc("2026-10-01T00:00:00"), 1],
      [utc("2026-10-03T00:00:00"), 3],
    ]);
  });

  it("adds no markPoint when markers are on or the setting is absent", () => {
    expect(
      (seriesOf(category(["4", "n/a", "7"], undefined, { line: { showPoints: true } }))[0] as Mark)
        .markPoint,
    ).toBeUndefined();
    expect(
      (seriesOf(category(["4", "n/a", "7"], undefined, null))[0] as Mark).markPoint,
    ).toBeUndefined();
  });
});
