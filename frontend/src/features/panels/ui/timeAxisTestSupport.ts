// Shared fixtures for the HEL-1305 time-axis option tests.
import type { ECharts, EChartsOption } from "echarts";

import { defaultChartAppearance } from "../../../theme/appearance";
import type { ChartThemeTokens, ChartType } from "../../../utils/chartAppearance";
import type { GroupedAggregate } from "../../../utils/aggregate";
import type { ReferenceMarks } from "../../../utils/referenceMarks";
import type { ChartOverlay } from "../history/chartOverlay";
import type { ChartTypeOptionsMap } from "../types/panel";
import { buildChartOption } from "./buildChartOption";

export const tokens: ChartThemeTokens = {
  surfaceStrong: "#1a1d24",
  borderSubtle: "#d0d5dd",
  text: "#abcdef",
  fontSans: "Inter, sans-serif",
  fontMono: "ui-monospace, monospace",
  shadowSoft: "0 1px 2px rgba(0,0,0,0.1)",
  radiusMd: "8px",
  accentEmphasis: "#ea580c",
  accent: "#ea580c",
  textMuted: "#778899",
  success: "#4cc38a",
  warning: "#f5b944",
  error: "#f17b67",
};

export const utc = (iso: string): number => Date.parse(`${iso}Z`);

export interface BuildArgs {
  rows: string[][];
  headers: string[];
  fieldMapping?: Record<string, string>;
  fieldTypes?: Record<string, string> | null;
  chartOptions?: ChartTypeOptionsMap;
  overlay?: ChartOverlay | null;
  referenceMarks?: ReferenceMarks | null;
  chartAggregate?: GroupedAggregate | null;
}

export function build(chartType: ChartType, a: BuildArgs): EChartsOption {
  return buildChartOption({
    appearance: {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...defaultChartAppearance, chartType },
    },
    rawRows: a.rows,
    headers: a.headers,
    fieldMapping: a.fieldMapping,
    fieldTypes: a.fieldTypes,
    chartOptions: a.chartOptions,
    overlay: a.overlay,
    referenceMarks: a.referenceMarks,
    chartAggregate: a.chartAggregate,
    effectiveCompact: false,
    measuredPieLegendOverlap: false,
    themeTokens: tokens,
    theme: "dark",
  });
}

export interface SeriesLike {
  type?: string;
  name?: string;
  stack?: string;
  data?: unknown[];
  id?: string;
}
export const seriesOf = (o: EChartsOption): SeriesLike[] => (o.series as SeriesLike[]) ?? [];
export const xAxisOf = (o: EChartsOption) => o.xAxis as { type?: string; data?: unknown[] };
export const TIMESTAMP_X = { day: "timestamp" };
export const SERIES_HEADERS = ["day", "amount", "region"];
export const SERIES_MAPPING = { xAxis: "day", yAxis: "amount", series: "region" };

interface ChartInternals {
  getModel(): {
    getSeriesByIndex(i: number): { getData(): { getLayout(key: string): number[] } };
    getComponent(name: string): { axis: { scale: { getExtent(): number[] } } };
  };
}
/** ECharts' resolved layout, which no public getter exposes (the option alone does not prove it). */
export const internals = (chart: ECharts): ChartInternals => chart as unknown as ChartInternals;
