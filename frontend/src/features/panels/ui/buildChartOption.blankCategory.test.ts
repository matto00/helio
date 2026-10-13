import { defaultChartAppearance } from "../../../theme/appearance";
import type { ChartThemeTokens } from "../../../utils/chartAppearance";
import type { ChartTypeOptionsMap, PanelAppearance } from "../types/panel";
import type { ChartOverlay } from "../history/chartOverlay";
import type { GroupedAggregate } from "../../../utils/aggregate";
import { mapAggregateClickToSelection } from "../../../utils/chartClickSelection";
import { buildChartOption } from "./buildChartOption";

// HEL-1424 -- an aggregate's null group is labelled "(blank)" on the category axis (x, or y of a
// horizontal bar) and a pie's slice names; a literal "null" category stays when no record is null.

const themeTokens: ChartThemeTokens = {
  surfaceStrong: "#1a1d24",
  borderSubtle: "#d0d5dd",
  text: "#abcdef",
  fontSans: "Inter, sans-serif",
  fontMono: "ui-monospace, monospace",
  shadowSoft: "0 1px 2px rgba(0,0,0,0.1)",
  radiusMd: "8px",
  accentStrong: "#ea580c",
  accent: "#ea580c",
  textMuted: "#778899",
  success: "#4cc38a",
  warning: "#f5b944",
  error: "#f17b67",
};

const aggregate = (hasNullGroup: boolean): GroupedAggregate => ({
  categories: ["east", "null", "west"],
  values: [10, 2, 7],
  seriesName: "sum(amount)",
  groupBy: "team",
  hasNullGroup,
});

function build(
  chartType: "bar" | "line" | "pie",
  hasNullGroup: boolean,
  extra: { chartOptions?: ChartTypeOptionsMap; overlay?: ChartOverlay | null } = {},
) {
  const appearance: PanelAppearance = {
    background: "transparent",
    color: "inherit",
    transparency: 0,
    chart: { ...defaultChartAppearance, chartType },
  };
  return buildChartOption({
    appearance,
    chartAggregate: aggregate(hasNullGroup),
    chartOptions: extra.chartOptions,
    overlay: extra.overlay,
    effectiveCompact: false,
    measuredPieLegendOverlap: false,
    themeTokens,
    theme: "dark",
  });
}

const dataOf = (axis: unknown) => (axis as { data?: unknown[] }).data;

describe("buildChartOption blank category (HEL-1424)", () => {
  it("vertical bar and line: the category axis reads east, (blank), west in the same position", () => {
    for (const type of ["bar", "line"] as const) {
      expect(dataOf(build(type, true).xAxis)).toEqual(["east", "(blank)", "west"]);
    }
  });

  it("horizontal bar: the category axis (y) reads (blank)", () => {
    const opt = build("bar", true, { chartOptions: { bar: { orientation: "horizontal" } } });
    expect(dataOf(opt.yAxis)).toEqual(["east", "(blank)", "west"]);
  });

  it("pie: the slice name (legend and tooltip source) reads (blank)", () => {
    const series = build("pie", true).series as { data: { name: string }[] }[];
    expect(series[0].data.map((d) => d.name)).toEqual(["east", "(blank)", "west"]);
  });

  it("a literal 'null' category stays 'null' when no record holds a null", () => {
    expect(dataOf(build("bar", false).xAxis)).toEqual(["east", "null", "west"]);
    const pie = build("pie", false).series as { data: { name: string }[] }[];
    expect(pie[0].data.map((d) => d.name)).toEqual(["east", "null", "west"]);
  });

  it("a history overlay keeps its blank-group value at the (blank) index (aligned on raw keys first)", () => {
    const overlay: ChartOverlay = {
      label: "vs 7d",
      points: [
        ["east", 1],
        ["null", 9],
      ],
    };
    const opt = build("bar", true, { overlay });
    expect(dataOf(opt.xAxis)).toEqual(["east", "(blank)", "west"]);
    const series = opt.series as { name?: string; data: unknown[] }[];
    expect(series.find((s) => s.name === "vs 7d")?.data).toEqual([1, 9, null]);
  });

  it("clicking the rendered (blank) category selects '' for every orientation", () => {
    const spec = { groupBy: "team", agg: "sum" as const, yField: "amount", groupHasNull: true };
    for (const params of [
      { componentType: "series", name: "(blank)", seriesName: "sum(amount)" },
      { componentType: "series", name: "(blank)", seriesType: "pie" },
    ]) {
      expect(mapAggregateClickToSelection(params, spec)?.value).toBe("");
    }
  });
});
