// HEL-1305 -- the input matrix behind the unchanged-path GUARD (`buildChartOption.unchangedPath.test.ts`).
// `chartUnchangedPath.main.snapshot.json` holds the options main (3eb0cc893) built for exactly these
// inputs, functions masked as "__fn__"; regenerate it only from the pre-change tree. Its histogram entry
// carries HEL-1487's one-precision bin labels ("1.0 to 3.7"), the only deliberate difference from main.
import type { BuildArgs } from "./timeAxisTestSupport";
import type { ChartType } from "../../../utils/chartAppearance";

export interface UnchangedCase {
  name: string;
  chartType: ChartType;
  args: BuildArgs;
  /** Every fieldTypes variant that must build main's option. */
  fieldTypes: Array<Record<string, string> | null | undefined>;
  /** [seriesIndex, dataIndex] cells main plotted as 0 that owner ruling 2 now plots as null. */
  gaps?: Array<[number, number]>;
}

export const SNAPSHOT_FILE = "chartUnchangedPath.main.snapshot.json";

const H = ["day", "amount", "region", "size", "other"];
const distinct = [
  ["2026-10-09", "9", "A", "3", "x"],
  ["2026-10-01", "1", "A", "4", "y"],
  ["2026-10-02", "2", "B", "5", "z"],
];
const gapless = [
  ["2026-10-01", "1", "A", "1", "x"],
  ["2026-10-01", "2", "B", "1", "x"],
  ["2026-10-02", "3", "A", "1", "x"],
  ["2026-10-02", "4", "B", "1", "x"],
];
const withGap = [...gapless, ["2026-10-09", "5", "A", "1", "x"]];

const NON_TIME: UnchangedCase["fieldTypes"] = [
  undefined,
  null,
  { day: "string" },
  { amount: "timestamp" },
];
const TIMESTAMP: UnchangedCase["fieldTypes"] = [{ day: "timestamp" }];
const single = { xAxis: "day", yAxis: "amount" };
const multi = { xAxis: "day", yAxis: "amount", series: "region" };
const base = { rows: distinct, headers: H, fieldMapping: single };
const overlay = {
  label: "vs prev",
  points: [
    ["2026-10-01", 3],
    ["2026-10-09", 4],
  ] as Array<[string, number]>,
};
const marks = { lines: [{ value: 5, label: "target" }], bands: [{ from: 0, to: 2 }] };
const aggregate = {
  categories: ["east", "null", "west"],
  values: [1, 2, 3],
  seriesName: "sum(amount)",
  groupBy: "region",
};

const c = (
  name: string,
  chartType: ChartType,
  args: Partial<BuildArgs>,
  fieldTypes = NON_TIME,
  gaps?: Array<[number, number]>,
): UnchangedCase => ({ name, chartType, args: { ...base, ...args }, fieldTypes, gaps });

export const UNCHANGED_CASES: UnchangedCase[] = [
  c("line single", "line", {}),
  c("line auto-detect", "line", { fieldMapping: { xAxis: "day" } }),
  c("line multi gapless", "line", { rows: gapless, fieldMapping: multi }),
  c("line smooth area", "line", { chartOptions: { line: { smooth: true, areaFill: true } } }),
  c("line overlay", "line", { overlay }),
  c("line reference marks", "line", { referenceMarks: marks }),
  c("line overlay + reference marks", "line", { overlay, referenceMarks: marks }),
  c(
    "line multi with a gap (ruling 2: 0 becomes null)",
    "line",
    { rows: withGap, fieldMapping: multi },
    NON_TIME,
    [[1, 2]],
  ),
  c("bar single", "bar", {}),
  c("bar multi gapless", "bar", { rows: gapless, fieldMapping: multi }),
  c("bar stacked", "bar", {
    rows: gapless,
    fieldMapping: multi,
    chartOptions: { bar: { stacking: "stacked" } },
  }),
  c("bar normalized", "bar", {
    rows: gapless,
    fieldMapping: multi,
    chartOptions: { bar: { stacking: "normalized" } },
  }),
  c("bar horizontal", "bar", { chartOptions: { bar: { orientation: "horizontal" } } }),
  c("bar overlay", "bar", { overlay }),
  c("bar reference marks", "bar", { referenceMarks: marks }),
  c(
    "bar multi with a gap (ruling 2: 0 becomes null)",
    "bar",
    { rows: withGap, fieldMapping: multi },
    NON_TIME,
    [[1, 2]],
  ),
  c("scatter", "scatter", {}),
  c("scatter size + colour", "scatter", {
    chartOptions: { scatter: { sizeField: "size", colorField: "region" } },
  }),
  c("pie", "pie", {}),
  c("heatmap", "heatmap", { fieldMapping: { xAxis: "day", yAxis: "region", value: "amount" } }),
  c("histogram", "histogram", {
    fieldMapping: { xAxis: "amount" },
    chartOptions: { histogram: { binCount: 3 } },
  }),
  c("aggregate bar", "bar", { chartAggregate: aggregate }),
  c("aggregate line", "line", { chartAggregate: aggregate }),
  c("aggregate pie", "pie", { chartAggregate: aggregate }),
  c(
    "aggregate bar with no groupBy",
    "bar",
    { chartAggregate: { ...aggregate, groupBy: undefined } },
    TIMESTAMP,
  ),
  c(
    "aggregate bar grouped by a non-timestamp field of a timestamp schema",
    "bar",
    { chartAggregate: aggregate },
    TIMESTAMP,
  ),
  c("timestamp x: pie", "pie", {}, TIMESTAMP),
  c(
    "timestamp x: heatmap",
    "heatmap",
    { fieldMapping: { xAxis: "day", yAxis: "region", value: "amount" } },
    TIMESTAMP,
  ),
  c("timestamp x: histogram", "histogram", { fieldMapping: { xAxis: "day" } }, TIMESTAMP),
  c(
    "timestamp x: horizontal bar",
    "bar",
    { chartOptions: { bar: { orientation: "horizontal" } } },
    TIMESTAMP,
  ),
  c(
    "timestamp x: horizontal stacked bar",
    "bar",
    {
      rows: gapless,
      fieldMapping: multi,
      chartOptions: { bar: { orientation: "horizontal", stacking: "stacked" } },
    },
    TIMESTAMP,
  ),
  c(
    "timestamp x: aggregate pie",
    "pie",
    { chartAggregate: { ...aggregate, groupBy: "day" } },
    TIMESTAMP,
  ),
];
