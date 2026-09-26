import type { EChartsOption } from "echarts";

import type { ChartTypeOptionsMap, PanelAppearance } from "../types/panel";
import {
  appearanceToEChartsOption,
  applyAxisTriggerTooltip,
  applyHoverEmphasis,
  prefersReducedMotion,
} from "../../../utils/chartAppearance";
import type { ChartThemeTokens, ChartType } from "../../../utils/chartAppearance";
import { applyChartTypeOptions } from "../../../utils/chartTypeOptions";
import type { GroupedAggregate } from "../../../utils/aggregate";
import { buildAggregateDataOption, buildDataOption } from "./chartDataOptions";

// `type`/`data` only — no placeholder `name` (unlike the persisted-appearance
// default, `defaultChartAppearance` in theme/appearance.ts, this is never
// actually surfaced: the option-assembly below always reconstructs `xAxis`/
// `yAxis` from `dataOption/appearanceOption` and never falls back to this
// object's own `name`). Kept type-shaped so `EChartsOption` inference below
// still holds when data/appearance are both absent (see the "no data" tests).
export const defaultOption: EChartsOption = {
  legend: { show: true },
  xAxis: { type: "category", data: [] },
  yAxis: { type: "value" },
  series: [{ type: "line" }],
};

/** `compact` mode (HEL-301, phone stack + F-094/F-026 measured-small panels):
 *  axis-label font size, shrunk from ECharts' default to fit a narrow width
 *  (W5: "fix via ECharts config, not CSS" — this is an ECharts option value,
 *  not a CSS token). */
export const COMPACT_AXIS_LABEL_FONT_SIZE = 10;

/** F-028 — compact-mode grid inset (px). Paired with `containLabel: true` so
 *  ECharts reserves exactly the space the (now-shrunk) axis labels/names
 *  need instead of its own default percentage-based margins, which — on a
 *  ~140px-tall mobile chart canvas — consumed nearly the entire box and left
 *  the plotted series a near-invisible sliver. */
export const COMPACT_GRID_INSET_PX = 8;

/** Inputs to `buildChartOption` — the appearance/data/compact inputs the
 *  original inline `useMemo` closed over, plus the already-resolved
 *  `themeTokens` (design.md D2: `useChartOption.ts`'s own `useMemo` callback
 *  calls `resolveChartTheme()` and passes the result in here — this function
 *  never reads `theme`/`accentColor`/`themeSyncTick` directly, since it isn't
 *  a React hook and has no dependency array for them to justify). */
export interface BuildChartOptionParams {
  appearance?: PanelAppearance;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
  /** HEL-292: precomputed groupBy aggregate. Only applied when the rendered
   *  `chartType` is `bar`/`line`/`pie` (HEL-624) — scatter (or an absent
   *  aggregate) falls back to the existing per-row `rawRows` path unchanged. */
  chartAggregate?: GroupedAggregate | null;
  /** HEL-248: persisted per-chart-type display options. The active chart type's
   *  entry is applied to the built option; entries for other types are ignored
   *  on render but preserved in storage. */
  chartOptions?: ChartTypeOptionsMap | null;
  effectiveCompact: boolean;
  measuredPieLegendOverlap: boolean;
  themeTokens: ChartThemeTokens;
}

// F-231 — this used to rebuild the full ECharts option object on every
// render. `useChartOption.ts`'s `useMemo` memoizes on the actual inputs that
// can change its shape; this function itself is a plain, memo-free
// computation over already-resolved inputs.
export function buildChartOption({
  appearance,
  rawRows,
  headers,
  fieldMapping,
  chartAggregate,
  chartOptions,
  effectiveCompact,
  measuredPieLegendOverlap,
  themeTokens,
}: BuildChartOptionParams): EChartsOption {
  const { option: appearanceOption, chartType } =
    appearance?.chart != null
      ? appearanceToEChartsOption(appearance.chart, themeTokens)
      : { option: {} as EChartsOption, chartType: "line" as ChartType };

  const useAggregate =
    chartAggregate != null && (chartType === "bar" || chartType === "line" || chartType === "pie");

  const dataOption = useAggregate
    ? buildAggregateDataOption(chartAggregate, chartType)
    : rawRows && rawRows.length > 0 && headers && headers.length > 0
      ? buildDataOption(rawRows, headers, fieldMapping, chartType, chartOptions?.scatter)
      : {};

  const isPie = chartType === "pie";

  const textColor = appearance?.color;
  const textStyleOverride = textColor ? { color: textColor } : {};
  // F-196: `appearanceOption.textStyle` is where chartAppearance.ts wires
  // `fontFamily: --font-sans` (and the tooltip/axisLabel equivalents). Every
  // spot below that renders its own `textStyle`-shaped object must MERGE
  // that base in rather than replace it outright, or the color override
  // silently drops the font — the bug this finding described (legend text
  // rendering in ECharts' canvas-default font instead of the app's).
  const baseTextStyle = (appearanceOption.textStyle as object | undefined) ?? {};
  const textStyle = { ...baseTextStyle, ...textStyleOverride };

  let built: EChartsOption;
  if (isPie) {
    const { xAxis: _axA, yAxis: _ayA, ...appearOpt } = appearanceOption;
    const { xAxis: _axD, yAxis: _ayD, series: _sD, ...defaultOpt } = defaultOption;
    built = {
      ...defaultOpt,
      ...dataOption,
      ...appearOpt,
      backgroundColor: "transparent",
      textStyle,
      legend: {
        ...(dataOption.legend as object),
        ...(appearOpt.legend as object),
        textStyle: {
          ...baseTextStyle,
          ...((appearOpt.legend as { textStyle?: object } | undefined)?.textStyle ?? {}),
          ...textStyleOverride,
        },
      },
    };
  } else {
    built = {
      ...defaultOption,
      ...dataOption,
      ...appearanceOption,
      backgroundColor: "transparent",
      textStyle,
      xAxis: {
        ...(dataOption.xAxis as object),
        ...(appearanceOption.xAxis as object),
        nameTextStyle: textStyle,
        axisLabel: {
          ...(appearanceOption.xAxis as { axisLabel?: object } | undefined)?.axisLabel,
          color: textColor,
        },
      },
      yAxis: {
        ...(defaultOption.yAxis as object),
        ...(appearanceOption.yAxis as object),
        nameTextStyle: textStyle,
        axisLabel: {
          ...(appearanceOption.yAxis as { axisLabel?: object } | undefined)?.axisLabel,
          color: textColor,
        },
      },
      legend: {
        ...(dataOption.legend as object),
        ...(appearanceOption.legend as object),
        textStyle: {
          ...baseTextStyle,
          ...((appearanceOption.legend as { textStyle?: object } | undefined)?.textStyle ?? {}),
          ...textStyleOverride,
        },
      },
    };
  }

  // HEL-248 — apply the active chart type's persisted display options (line
  // smoothing/markers/area, bar stacking/orientation/gap, pie donut/labels)
  // after appearance merge and before the mobile `compact` pass, so `compact`
  // (HEL-301) stays the last transform and is unchanged.
  built = applyChartTypeOptions(built, chartType, chartOptions);

  // HEL-566 D3/D4 — axis-trigger tooltip (shared-x, multi-series bar/line)
  // and hover-emphasis styling both need the FINAL series array (after
  // chart-type options, so a normalized-stacking or scatter-grouping pass
  // above has already settled series count/shape), so both run as their
  // own post-merge passes here, mirroring `applyChartTypeOptions`
  // immediately above rather than folding into `appearanceToEChartsOption`
  // — which runs before `dataOption`'s real series are known (design.md
  // Decision 3).
  built = applyAxisTriggerTooltip(built, chartType);
  built = applyHoverEmphasis(built, themeTokens, prefersReducedMotion());

  // F-026 — a pie's own outer data-labels extend well outside its donut
  // radius, so a top/bottom legend collides with them at a *taller*
  // measured height than the generic compact tier below is set for.
  // Independent of `effectiveCompact` so a default-sized (`h: 4`) pie
  // panel clears the collision even though it's well above the generic
  // small-chart threshold.
  const hideLegendForMeasuredSize = effectiveCompact || (isPie && measuredPieLegendOverlap);

  if (hideLegendForMeasuredSize) {
    built = { ...built, legend: { ...(built.legend as object), show: false } };
  }

  if (effectiveCompact && !isPie) {
    built = {
      ...built,
      // F-028 — an explicit small inset + `containLabel` so ECharts
      // reserves only the space the (shrunk) axis labels/names actually
      // need, instead of its own default percentage-based grid margins,
      // which ate nearly the whole plot area on a ~140px-tall mobile
      // chart canvas.
      grid: {
        ...(built.grid as object),
        top: COMPACT_GRID_INSET_PX,
        right: COMPACT_GRID_INSET_PX,
        bottom: COMPACT_GRID_INSET_PX,
        left: COMPACT_GRID_INSET_PX,
        containLabel: true,
      },
      xAxis: {
        ...(built.xAxis as object),
        axisLabel: {
          ...(built.xAxis as { axisLabel?: object } | undefined)?.axisLabel,
          fontSize: COMPACT_AXIS_LABEL_FONT_SIZE,
        },
        nameTextStyle: {
          ...(built.xAxis as { nameTextStyle?: object } | undefined)?.nameTextStyle,
          fontSize: COMPACT_AXIS_LABEL_FONT_SIZE,
        },
      },
      yAxis: {
        ...(built.yAxis as object),
        axisLabel: {
          ...(built.yAxis as { axisLabel?: object } | undefined)?.axisLabel,
          fontSize: COMPACT_AXIS_LABEL_FONT_SIZE,
        },
        nameTextStyle: {
          ...(built.yAxis as { nameTextStyle?: object } | undefined)?.nameTextStyle,
          fontSize: COMPACT_AXIS_LABEL_FONT_SIZE,
        },
      },
    };
  }

  return built;
}
