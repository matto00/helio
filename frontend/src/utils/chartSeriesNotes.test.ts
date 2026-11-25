// HEL-1517 -- the summed-rows and no-numeric-x footnotes, and the GUARD that their counts and the plotted
// sums cannot drift from the input rows. The oracle below groups the rows itself (category keys by raw x,
// time keys by `parseChartInstant`) and never calls `sumBySeriesAndKey`.
import { defaultChartAppearance } from "../theme/appearance";
import type { ChartType } from "./chartAppearance";
import { parseChartInstant } from "./chartTimeAxis";
import { resolveChartPlan } from "./chartTimePlan";
import { scatterOmittedNote, summedRowsNote } from "./chartSeriesNotes";
import { buildChartOption } from "../features/panels/ui/buildChartOption";
import { tokens } from "../features/panels/ui/timeAxisTestSupport";

beforeAll(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(
      () => ({ measureText: (t: string) => ({ width: t.length * 6 }), font: "" }) as never,
    );
});

const HEADERS = ["day", "amount", "region"];
const MAPPING = { xAxis: "day", yAxis: "amount", series: "region" };

interface Params {
  chartType: ChartType;
  rows: string[][];
  headers?: string[];
  mapping?: Record<string, string>;
  fieldTypes?: Record<string, string>;
}

const input = (p: Params) => ({
  appearance: {
    background: "transparent",
    color: "inherit",
    transparency: 0,
    chart: { ...defaultChartAppearance, chartType: p.chartType },
  },
  rawRows: p.rows,
  headers: p.headers ?? HEADERS,
  fieldMapping: p.mapping ?? MAPPING,
  fieldTypes: p.fieldTypes ?? { day: "string" },
});

const noteOf = (p: Params) => {
  const i = input(p);
  return summedRowsNote(resolveChartPlan(i), i.rawRows, i.headers, i.fieldMapping);
};
const scatterNoteOf = (p: Params) => {
  const i = input(p);
  return scatterOmittedNote(resolveChartPlan(i), i.rawRows, i.headers, i.fieldMapping);
};

describe("summedRowsNote", () => {
  it("counts every row that took part in a sum of two or more (category)", () => {
    expect(
      noteOf({
        chartType: "bar",
        rows: [
          ["Mon", "3", "A"],
          ["Mon", "4", "A"],
        ],
      }),
    ).toBe("2 rows with the same x value and series were added together.");
    expect(
      noteOf({
        chartType: "bar",
        rows: [
          ["Mon", "3", "A"],
          ["Mon", "4", "A"],
          ["Mon", "5", "A"],
          ["Tue", "1", "A"],
          ["Tue", "2", "A"],
        ],
      }),
    ).toBe("5 rows with the same x value and series were added together.");
  });

  it("says 'time' on a time axis and sums spellings of one instant", () => {
    expect(
      noteOf({
        chartType: "line",
        fieldTypes: { day: "timestamp" },
        rows: [
          ["2026-10-01", "2", "A"],
          ["2026-10-01T00:00:00Z", "5", "A"],
        ],
      }),
    ).toBe("2 rows with the same time and series were added together.");
  });

  it("is null for different times on one date, a non-numeric y, distinct keys and other charts", () => {
    expect(
      noteOf({
        chartType: "line",
        fieldTypes: { day: "timestamp" },
        rows: [
          ["2026-10-01T01:00", "2", "A"],
          ["2026-10-01T02:00", "5", "A"],
        ],
      }),
    ).toBeNull();
    expect(
      noteOf({
        chartType: "bar",
        rows: [
          ["Mon", "3", "A"],
          ["Mon", "n/a", "A"],
        ],
      }),
    ).toBeNull();
    expect(
      noteOf({
        chartType: "bar",
        rows: [
          ["Mon", "3", "A"],
          ["Mon", "4", "B"],
          ["Tue", "4", "A"],
        ],
      }),
    ).toBeNull();
    const dup = [
      ["Mon", "3", "A"],
      ["Mon", "4", "A"],
    ];
    expect(noteOf({ chartType: "pie", rows: dup })).toBeNull();
    expect(noteOf({ chartType: "scatter", rows: dup })).toBeNull();
    expect(
      noteOf({ chartType: "bar", rows: dup, mapping: { xAxis: "day", yAxis: "amount" } }),
    ).toBeNull();
    expect(
      noteOf({ chartType: "bar", rows: dup, mapping: { xAxis: "day", series: "region" } }),
    ).toBeNull();
  });
});

describe("scatterOmittedNote", () => {
  const rows = [
    ["1", "10", "a"],
    ["abc", "20", "a"],
    ["3", "30", "a"],
  ];
  const mapping = { xAxis: "day", yAxis: "amount" };

  it("counts every row whose x is not numeric, singular and plural", () => {
    expect(scatterNoteOf({ chartType: "scatter", rows, mapping })).toBe(
      "1 row with no numeric x value not shown.",
    );
    expect(scatterNoteOf({ chartType: "scatter", rows: [...rows, ["", "5", "b"]], mapping })).toBe(
      "2 rows with no numeric x value not shown.",
    );
  });

  it("is null when nothing is left out, for other chart types, and for a time-axis scatter", () => {
    expect(scatterNoteOf({ chartType: "scatter", rows: [rows[0], rows[2]], mapping })).toBeNull();
    expect(scatterNoteOf({ chartType: "line", rows, mapping })).toBeNull();
    expect(
      scatterNoteOf({ chartType: "scatter", rows, mapping, fieldTypes: { day: "timestamp" } }),
    ).toBeNull();
  });
});

describe("GUARD: the summed-rows note and the plotted sums match an independent brute force", () => {
  interface Case {
    label: string;
    chartType: "line" | "bar";
    time: boolean;
    rows: string[][];
  }
  const CASES: Case[] = [
    {
      label: "category, two series, one duplicated cell",
      chartType: "bar",
      time: false,
      rows: [
        ["Mon", "3", "A"],
        ["Mon", "4", "A"],
        ["Mon", "1", "B"],
        ["Tue", "2", "A"],
      ],
    },
    {
      label: "category, triple and pair, a non-numeric y",
      chartType: "line",
      time: false,
      rows: [
        ["Mon", "1", "A"],
        ["Mon", "2", "A"],
        ["Mon", "4", "A"],
        ["Tue", "5", "B"],
        ["Tue", "6", "B"],
        ["Tue", "n/a", "B"],
        ["Wed", "n/a", "A"],
        ["Wed", "n/a", "A"],
      ],
    },
    {
      label: "time, two spellings of one instant plus an intraday same-date pair",
      chartType: "line",
      time: true,
      rows: [
        ["2026-10-01", "2", "A"],
        ["2026-10-01T00:00:00Z", "5", "A"],
        ["2026-10-02T01:00", "10", "A"],
        ["2026-10-02T02:00", "20", "A"],
        ["2026-10-02", "1", "B"],
      ],
    },
    {
      label: "time bar with an unreadable date",
      chartType: "bar",
      time: true,
      rows: [
        ["2026-10-01", "2", "A"],
        ["2026-10-01", "3", "A"],
        ["n/a", "9", "A"],
        ["2026-10-03", "4", "B"],
      ],
    },
  ];

  it.each(CASES.map((c) => [c.label, c] as const))("%s", (_label, c) => {
    const params: Params = {
      chartType: c.chartType,
      rows: c.rows,
      fieldTypes: { day: c.time ? "timestamp" : "string" },
    };
    // Independent oracle: its own grouping, its own number parsing.
    const cells = new Map<string, number[]>();
    for (const [x, y, g] of c.rows) {
      const key = c.time ? parseChartInstant(x) : x;
      if (key === null) continue;
      const v = parseFloat(y);
      if (Number.isNaN(v)) continue;
      const id = `${g}\u0000${key}`;
      cells.set(id, [...(cells.get(id) ?? []), v]);
    }
    let expectedN = 0;
    for (const vs of cells.values()) if (vs.length >= 2) expectedN += vs.length;

    expect(noteOf(params)).toBe(
      expectedN === 0
        ? null
        : `${expectedN} rows with the same ${c.time ? "time" : "x value"} and series were added together.`,
    );

    const i = input(params);
    const option = buildChartOption({
      ...i,
      effectiveCompact: false,
      measuredPieLegendOverlap: false,
      themeTokens: tokens,
      theme: "dark",
    });
    for (const s of option.series as Array<{ name: string; data: unknown[] }>) {
      for (const point of s.data) {
        if (point === null || point === undefined) continue;
        const item = point as { name?: string; value?: unknown[] };
        const x = c.time ? (item.value?.[0] as number) : undefined;
        const y = (c.time ? item.value?.[1] : point) as number | null;
        if (y === null) continue;
        if (c.time) {
          const vs = cells.get(`${s.name}\u0000${x}`);
          expect(vs).toBeDefined();
          expect(y).toBe(vs!.reduce((a, b) => a + b, 0));
        }
      }
      if (!c.time) {
        const xs = [...new Set(c.rows.map((r) => r[0]))];
        s.data.forEach((y, idx) => {
          const vs = cells.get(`${s.name}\u0000${xs[idx]}`);
          expect(y).toBe(vs ? vs.reduce((a, b) => a + b, 0) : null);
        });
      }
    }
    // Not vacuous: a case whose note is null still has cells, and at least one case sums.
    expect(cells.size).toBeGreaterThan(0);
  });

  it("covers a summed cell in the matrix (the guard is not vacuous)", () => {
    expect(
      CASES.filter((c) =>
        noteOf({
          chartType: c.chartType,
          rows: c.rows,
          fieldTypes: { day: c.time ? "timestamp" : "string" },
        }),
      ).length,
    ).toBeGreaterThanOrEqual(3);
  });
});
