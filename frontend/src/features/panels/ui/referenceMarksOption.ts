// HEL-1306 -- draws a chart Output's `referenceLines` / `referenceBands` (static targets on the value axis)
// as ECharts markLine / markArea. Every behaviour choice below was probed against ECharts 6.1 (see
// `openspec/changes/chart-reference-lines/skeptic-design-*.md`); the reasons are kept inline because none of
// them is visible from the option shape.

import type { EChartsOption } from "echarts";

import type { ChartTypeOptionsMap } from "../types/panel";
import { formatChartNumber, toSeriesArray } from "../../../utils/chartAppearance";
import type { ChartThemeTokens, ChartType } from "../../../utils/chartAppearance";
import { prefersReducedMotion } from "../../../utils/prefersReducedMotion";
import type { ReferenceMarks, ReferenceTone } from "../../../utils/referenceMarks";

export const REFERENCE_CARRIER_ID = "__helio_reference_marks__";
export const REFERENCE_LABEL_CARRIER_ID = "__helio_reference_band_labels__";
/** Above the data series (z 2) so a band label is never painted under a bar. */
export const BAND_LABEL_Z = 5;
export const REFERENCE_BAND_OPACITY = 0.12;
const LINE_WIDTH = 1.5;
const LABEL_FONT_SIZE = 11;
const LABEL_HALO_WIDTH = 3;

/** A tone's colour from the theme's hex tokens. Never a `-surface` token: those are `color-mix()` strings
 *  zrender cannot parse (the mark would render black). */
export function referenceToneColour(
  tone: ReferenceTone | undefined,
  tokens: ChartThemeTokens,
): string {
  switch (tone) {
    case "success":
      return tokens.success;
    case "warning":
      return tokens.warning;
    case "error":
      return tokens.error;
    default:
      return tokens.textMuted;
  }
}

function hasMarks(marks: ReferenceMarks | null | undefined): marks is ReferenceMarks {
  return marks != null && (marks.lines.length > 0 || marks.bands.length > 0);
}

function finiteOr(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** ECharts does not widen an axis to fit a mark (probed), so a threshold above the data would be clipped
 *  away. `dataMin`/`dataMax` add the marks to the axis's DATA extent before zero inclusion and nice ticks;
 *  a mark inside the data range changes nothing. The `min`/`max` callbacks are NOT used: they pin both ends
 *  and drop the zero baseline. */
function widenedAxis(axis: unknown, marks: ReferenceMarks): object {
  const values = [
    ...marks.lines.map((l) => l.value),
    ...marks.bands.flatMap((b) => [b.from, b.to]),
  ];
  const base = (axis ?? {}) as { dataMin?: unknown; dataMax?: unknown };
  const lowest = Math.min(...values, finiteOr(base.dataMin) ?? Infinity);
  const highest = Math.max(...values, finiteOr(base.dataMax) ?? -Infinity);
  return { ...base, dataMin: lowest, dataMax: highest };
}

/**
 * Appends one carrier series holding the marks, and widens the value axis to include them.
 * Returned unchanged (same object) when nothing is drawn: a pie or heatmap, a normalized (percent)
 * stacked bar (its axis is 0-100, not the data's units), no valid marks, or no series.
 *
 * Must run AFTER the overlay, axis-trigger tooltip and hover-emphasis passes: they count series
 * (`applyChartOverlay` needs exactly one, the tooltip switches to axis trigger at two) or style every
 * series, and the carrier must not change what they see. The compact pass reads none of the series.
 */
export function applyReferenceMarks(
  option: EChartsOption,
  chartType: ChartType,
  chartOptions: ChartTypeOptionsMap | null | undefined,
  marks: ReferenceMarks | null | undefined,
  tokens: ChartThemeTokens,
  textColor: string,
  /** False in compact mode: a ~60px plot has no room for a label that sits on the bars, so band labels
   *  are hidden there (lines keep theirs). */
  bandLabels = true,
): EChartsOption {
  if (chartType === "pie" || chartType === "heatmap" || !hasMarks(marks)) return option;
  if (chartType === "bar" && chartOptions?.bar?.stacking === "normalized") return option;
  const series = toSeriesArray(option);
  if (series.length === 0) return option;

  const horizontal = chartType === "bar" && chartOptions?.bar?.orientation === "horizontal";
  const axisKey = horizontal ? "xAxis" : "yAxis";
  const animation = !prefersReducedMotion();
  const label = {
    fontFamily: tokens.fontSans,
    fontSize: LABEL_FONT_SIZE,
  };

  const lineData = marks.lines.map((line) => {
    const colour = referenceToneColour(line.tone, tokens);
    return {
      [axisKey]: line.value,
      lineStyle: { color: colour, type: "solid", width: LINE_WIDTH },
      label: {
        ...label,
        color: colour,
        // A halo keeps the text legible where a bar passes behind it (the same one band labels carry).
        textBorderColor: tokens.surfaceStrong,
        textBorderWidth: LABEL_HALO_WIDTH,
        position: "insideEndTop",
        formatter: line.label ?? formatChartNumber(line.value),
      },
    };
  });

  const areaData = marks.bands.map((band) => {
    const colour = referenceToneColour(band.tone, tokens);
    return [
      { [axisKey]: band.from, itemStyle: { color: colour, opacity: REFERENCE_BAND_OPACITY } },
      { [axisKey]: band.to },
    ];
  });

  // A markArea's label takes the markArea's z, and the fill must stay under the bars (z 1 < 2) while the
  // text must not: so the labels ride a second, fully transparent markArea at a higher z.
  const labelledBands = bandLabels ? marks.bands.filter((b) => b.label !== undefined) : [];
  const labelAreaData = labelledBands.map((band) => [
    {
      [axisKey]: band.from,
      itemStyle: { opacity: 0 },
      label: {
        ...label,
        show: true,
        color: textColor,
        // A halo keeps the text legible where a bar passes behind it.
        textBorderColor: tokens.surfaceStrong,
        textBorderWidth: LABEL_HALO_WIDTH,
        position: "insideTop",
        formatter: band.label,
      },
    },
    { [axisKey]: band.to },
  ]);
  const labelCarrier =
    labelAreaData.length > 0
      ? {
          id: REFERENCE_LABEL_CARRIER_ID,
          type: "line",
          data: [],
          silent: true,
          tooltip: { show: false },
          emphasis: { disabled: true },
          markArea: {
            silent: true,
            z: BAND_LABEL_Z,
            animation,
            data: labelAreaData,
            blur: { itemStyle: { opacity: 0 }, label: { opacity: 1 } },
          },
        }
      : null;

  // The carrier is ALWAYS a line series: an empty `bar` series takes its own bar column and halves every
  // bar's width (probed 103.5 -> 52.1 px). It has no name (so no legend entry), is silent with the tooltip
  // off and emphasis disabled, and is separate from the data series so toggling one in the legend cannot
  // hide the target. `silent` on the series does not cover the markers, hence it is repeated on each.
  // `emphasis.disabled` does NOT stop ECharts blurring the marks when a data series with `focus: "series"`
  // is hovered (probed: line opacity 0.1, band 0.012), so each marker pins its own `blur` opacities.
  const carrier = {
    id: REFERENCE_CARRIER_ID,
    type: "line",
    data: [],
    silent: true,
    tooltip: { show: false },
    emphasis: { disabled: true },
    ...(marks.lines.length > 0
      ? {
          markLine: {
            silent: true,
            symbol: "none",
            animation,
            data: lineData,
            blur: { lineStyle: { opacity: 1 }, label: { opacity: 1 } },
          },
        }
      : {}),
    ...(marks.bands.length > 0
      ? {
          markArea: {
            silent: true,
            animation,
            data: areaData,
            blur: { itemStyle: { opacity: REFERENCE_BAND_OPACITY }, label: { opacity: 1 } },
          },
        }
      : {}),
  };

  return {
    ...option,
    [axisKey]: widenedAxis(option[axisKey], marks),
    series: [...series, carrier, ...(labelCarrier ? [labelCarrier] : [])],
  } as EChartsOption;
}
