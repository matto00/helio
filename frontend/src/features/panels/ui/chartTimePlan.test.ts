// HEL-1508 -- the shared time-axis plan: unit tests plus the full-chain GUARD that the option builder
// and the footnote can never disagree about whether a chart plots on a time axis.
import type { EChartsOption } from "echarts";

import { defaultChartAppearance } from "../../../theme/appearance";
import type { ChartType } from "../../../utils/chartAppearance";
import type { GroupedAggregate } from "../../../utils/aggregate";
import { parseChartInstant } from "../../../utils/chartTimeAxis";
import {
  planAggregateTimeAxis,
  planTimeAxis,
  resolveChartPlan,
  timeAxisOmittedNote,
} from "../../../utils/chartTimePlan";
import type { ChartTypeOptionsMap } from "../types/panel";
import { buildChartOption } from "./buildChartOption";
import { tokens } from "./timeAxisTestSupport";

beforeAll(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(
      () => ({ measureText: (t: string) => ({ width: t.length * 6 }), font: "" }) as never,
    );
});

const CTX = { fieldTypes: { day: "timestamp" } };
const HEADERS = ["day", "amount"];
const MAPPING = { xAxis: "day", yAxis: "amount" };

describe("planTimeAxis", () => {
  it("counts the rows whose x denotes no instant", () => {
    const plan = planTimeAxis(
      [
        ["2026-10-01", "1"],
        ["n/a", "2"],
        ["", "3"],
      ],
      HEADERS,
      MAPPING,
      "line",
      CTX,
    );
    expect(plan).toMatchObject({ kind: "time", omitted: 2 });
  });

  it("is none for a string-typed x, a horizontal bar and a pie", () => {
    const rows = [["2026-10-01", "1"]];
    expect(
      planTimeAxis(rows, HEADERS, MAPPING, "line", { fieldTypes: { day: "string" } }).kind,
    ).toBe("none");
    expect(planTimeAxis(rows, HEADERS, MAPPING, "bar", { ...CTX, horizontalBar: true }).kind).toBe(
      "none",
    );
    expect(planTimeAxis(rows, HEADERS, MAPPING, "pie", CTX).kind).toBe("none");
  });

  it("is a category fallback for a vertical bar with a repeated instant only", () => {
    const rows = [
      ["2026-10-01", "1"],
      ["2026-10-01T00:00:00Z", "2"],
    ];
    expect(planTimeAxis(rows, HEADERS, MAPPING, "bar", CTX).kind).toBe("category-fallback");
    expect(planTimeAxis(rows, HEADERS, MAPPING, "line", CTX).kind).toBe("time");
  });

  it("is none for an auto-detect time chart with no numeric column", () => {
    expect(planTimeAxis([["2026-10-01", "a"]], HEADERS, { xAxis: "day" }, "line", CTX).kind).toBe(
      "none",
    );
  });
});

describe("planAggregateTimeAxis", () => {
  const aggregate: GroupedAggregate = {
    categories: ["2026-10-01", "null", "x"],
    values: [1, 2, 3],
    seriesName: "sum",
    groupBy: "day",
  };

  it("counts the groups whose key denotes no instant", () => {
    expect(planAggregateTimeAxis(aggregate, "bar", CTX)).toMatchObject({
      kind: "time",
      omittedGroups: 2,
    });
  });

  it("is none for a pie and for a string-typed groupBy", () => {
    expect(planAggregateTimeAxis(aggregate, "pie", CTX).kind).toBe("none");
    expect(planAggregateTimeAxis(aggregate, "bar", { fieldTypes: { day: "string" } }).kind).toBe(
      "none",
    );
  });
});

describe("timeAxisOmittedNote", () => {
  const rows = (omitted: number) => ({ kind: "time" as const, timed: [], omitted });
  const groups = (omittedGroups: number) => ({ kind: "time" as const, points: [], omittedGroups });

  it("words rows and groups, singular and plural, and is null at zero or off a time axis", () => {
    expect(timeAxisOmittedNote(rows(0))).toBeNull();
    expect(timeAxisOmittedNote(rows(1))).toBe("1 row with no readable date not shown.");
    expect(timeAxisOmittedNote(rows(3))).toBe("3 rows with no readable date not shown.");
    expect(timeAxisOmittedNote(groups(1))).toBe("1 group with no readable date not shown.");
    expect(timeAxisOmittedNote(groups(2))).toBe("2 groups with no readable date not shown.");
    expect(timeAxisOmittedNote({ kind: "none" })).toBeNull();
    expect(timeAxisOmittedNote({ kind: "category-fallback", ordered: [] })).toBeNull();
  });
});

interface Case {
  label: string;
  dataset: Dataset;
  chartType: ChartType | undefined;
  rows: string[][];
  headers: string[];
  fieldMapping: Record<string, string>;
  fieldTypes: Record<string, string>;
  chartOptions?: ChartTypeOptionsMap;
  chartAggregate?: GroupedAggregate;
}

interface Dataset {
  label: string;
  headers: string[];
  mapping: Record<string, string>;
  rows: string[][];
  /** Hand-labelled facts the oracle below reads, so it never calls the code under test. */
  repeatsInstant: boolean;
  hasNumericColumn: boolean;
  hasSeriesMapping: boolean;
}

const DATASETS: Dataset[] = [
  {
    label: "distinct",
    repeatsInstant: false,
    hasNumericColumn: true,
    hasSeriesMapping: false,
    headers: ["day", "amount", "region"],
    mapping: { xAxis: "day", yAxis: "amount" },
    rows: [
      ["2026-10-02", "2", "a"],
      ["2026-10-01", "1", "b"],
    ],
  },
  {
    label: "repeated",
    repeatsInstant: true,
    hasNumericColumn: true,
    hasSeriesMapping: false,
    headers: ["day", "amount", "region"],
    mapping: { xAxis: "day", yAxis: "amount" },
    rows: [
      ["2026-10-01", "2", "a"],
      ["2026-10-01", "1", "b"],
    ],
  },
  {
    label: "unparseable",
    repeatsInstant: false,
    hasNumericColumn: true,
    hasSeriesMapping: false,
    headers: ["day", "amount", "region"],
    mapping: { xAxis: "day", yAxis: "amount" },
    rows: [
      ["2026-10-01", "2", "a"],
      ["n/a", "1", "b"],
      ["2026-10-03", "x", "b"],
    ],
  },
  {
    label: "repeated+unparseable",
    repeatsInstant: true,
    hasNumericColumn: true,
    hasSeriesMapping: false,
    headers: ["day", "amount", "region"],
    mapping: { xAxis: "day", yAxis: "amount" },
    rows: [
      ["2026-10-01", "2", "a"],
      ["2026-10-01", "1", "b"],
      ["n/a", "4", "a"],
    ],
  },
  {
    label: "auto-detect",
    repeatsInstant: true,
    hasNumericColumn: true,
    hasSeriesMapping: false,
    headers: ["day", "amount", "region"],
    mapping: { xAxis: "day" },
    rows: [
      ["2026-10-01", "2", "a"],
      ["2026-10-01", "1", "b"],
      ["n/a", "4", "a"],
    ],
  },
  {
    label: "auto-detect without a numeric column",
    repeatsInstant: false,
    hasNumericColumn: false,
    hasSeriesMapping: false,
    headers: ["day", "label"],
    mapping: { xAxis: "day" },
    rows: [
      ["2026-10-01", "a"],
      ["n/a", "b"],
    ],
  },
  {
    label: "multi-series",
    repeatsInstant: true,
    hasNumericColumn: true,
    hasSeriesMapping: true,
    headers: ["day", "amount", "region"],
    mapping: { xAxis: "day", yAxis: "amount", series: "region" },
    rows: [
      ["2026-10-01", "2", "a"],
      ["2026-10-01", "1", "b"],
      ["n/a", "4", "a"],
    ],
  },
];

const AGGREGATES: Array<GroupedAggregate | undefined> = [
  undefined,
  { categories: ["2026-10-01", "2026-10-02"], values: [1, 2], seriesName: "s", groupBy: "day" },
  { categories: ["2026-10-01", "null"], values: [1, 2], seriesName: "s", groupBy: "day" },
];

function cases(): Case[] {
  const out: Case[] = [];
  const types: Array<ChartType | undefined> = [
    undefined,
    "line",
    "bar",
    "scatter",
    "pie",
    "heatmap",
    "histogram",
  ];
  for (const chartType of types) {
    for (const ds of DATASETS) {
      for (const horizontal of [false, true]) {
        for (const chartAggregate of AGGREGATES) {
          for (const fieldType of ["timestamp", "string"]) {
            out.push({
              dataset: ds,
              label: `${chartType ?? "absent"} / ${ds.label} / ${horizontal ? "horizontal" : "vertical"} / ${chartAggregate ? `aggregate(${chartAggregate.categories.join(",")})` : "raw"} / ${fieldType}`,
              chartType,
              rows: ds.rows,
              headers: ds.headers,
              fieldMapping: ds.mapping,
              fieldTypes: { day: fieldType },
              chartOptions: horizontal ? { bar: { orientation: "horizontal" } } : undefined,
              chartAggregate,
            });
          }
        }
      }
    }
  }
  return out;
}

/** True when either cartesian axis is a time axis (a horizontal bar swaps x and y). */
const hasTimeAxis = (o: EChartsOption): boolean =>
  [o.xAxis, o.yAxis].some((a) => (a as { type?: string } | undefined)?.type === "time");

/** What the plan must be, from the chart's own rules and the dataset's labelled facts. */
function expectedKind(c: Case): "none" | "time" | "category-fallback" {
  const chartType = c.chartType ?? "line";
  const horizontalBar = chartType === "bar" && c.chartOptions?.bar?.orientation === "horizontal";
  const timeCapable =
    c.fieldTypes.day === "timestamp" &&
    (chartType === "line" || chartType === "scatter" || (chartType === "bar" && !horizontalBar));
  if (!timeCapable) return "none";
  const aggregated = !!c.chartAggregate && ["line", "bar", "pie"].includes(chartType);
  if (aggregated) return "time";
  const { dataset } = c;
  const autoDetect = !c.fieldMapping.yAxis;
  if (autoDetect && !dataset.hasNumericColumn) return "none";
  const onePointPerRow = !dataset.hasSeriesMapping || autoDetect;
  return chartType === "bar" && onePointPerRow && dataset.repeatsInstant
    ? "category-fallback"
    : "time";
}

describe("GUARD: the plan, the option's x axis and the footnote agree for every chart", () => {
  it.each(cases().map((c) => [c.label, c] as const))("%s", (_label, c) => {
    const params = {
      appearance: c.chartType
        ? {
            background: "transparent",
            color: "inherit",
            transparency: 0,
            chart: { ...defaultChartAppearance, chartType: c.chartType },
          }
        : undefined,
      rawRows: c.rows,
      headers: c.headers,
      fieldMapping: c.fieldMapping,
      chartAggregate: c.chartAggregate,
      chartOptions: c.chartOptions,
      fieldTypes: c.fieldTypes,
    };
    const plan = resolveChartPlan(params);
    const option = buildChartOption({
      ...params,
      effectiveCompact: false,
      measuredPieLegendOverlap: false,
      themeTokens: tokens,
      theme: "dark",
    });

    expect(plan.timePlan.kind).toBe(expectedKind(c));
    expect(hasTimeAxis(option)).toBe(plan.timePlan.kind === "time");

    const note = timeAxisOmittedNote(plan.timePlan);
    if (plan.timePlan.kind !== "time") {
      expect(note).toBeNull();
      return;
    }
    const keys =
      plan.source === "aggregate" ? c.chartAggregate!.categories : c.rows.map((r) => r[0]);
    const missing = keys.filter((k) => parseChartInstant(k) === null).length;
    expect(note).toBe(
      missing === 0
        ? null
        : `${missing} ${plan.source === "aggregate" ? "group" : "row"}${missing === 1 ? "" : "s"} with no readable date not shown.`,
    );
  });

  it("covers a time axis, a fallback and a note in the matrix (the guard is not vacuous)", () => {
    const kinds = new Set<string>();
    let noted = 0;
    for (const c of cases()) {
      const plan = resolveChartPlan({
        appearance: c.chartType
          ? {
              background: "transparent",
              color: "inherit",
              transparency: 0,
              chart: { ...defaultChartAppearance, chartType: c.chartType },
            }
          : undefined,
        rawRows: c.rows,
        headers: c.headers,
        fieldMapping: c.fieldMapping,
        chartAggregate: c.chartAggregate,
        chartOptions: c.chartOptions,
        fieldTypes: c.fieldTypes,
      });
      kinds.add(plan.timePlan.kind);
      if (timeAxisOmittedNote(plan.timePlan)) noted++;
    }
    expect([...kinds].sort()).toEqual(["category-fallback", "none", "time"]);
    expect(noted).toBeGreaterThan(0);
  });
});
