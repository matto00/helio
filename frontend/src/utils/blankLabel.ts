import type { EChartsOption } from "echarts";

/** HEL-1424 -- the one label a null/blank category or selection value is shown as (DESIGN.md copy
 *  rule). Presentation only: a blank selection's stored value stays `""` everywhere. */
export const BLANK_LABEL = "(blank)";

/** The category a `groupAndAggregate` null group is keyed under (`String(null)`). */
const NULL_GROUP_KEY = "null";

/** A selection/cross-filter value as shown to the user: the empty string reads "(blank)". */
export function selectionValueLabel(value: string): string {
  return value === "" ? BLANK_LABEL : value;
}

/** Whether the loaded records hold a null group value, strictly `=== null` (never the null-to-""
 *  stringified rows). The one predicate the dashboard panel and the Output editor preview share, so a
 *  "null" category is relabelled and click-mapped only where it really is a null group. */
export function groupHasNull(
  records: readonly Record<string, unknown>[] | null | undefined,
  groupBy: string | null | undefined,
): boolean {
  return groupBy && records ? records.some((r) => r[groupBy] === null) : false;
}

/** Relabel a null group's category key for display. A real text value "(blank)" sharing a group with
 *  nulls is indistinguishable from the label -- the same accepted trade-off the old "null" check had. */
export function relabelNullCategory<T>(category: T): T | string {
  return category === NULL_GROUP_KEY ? BLANK_LABEL : category;
}

/** True when a click on a category named `name` selects the blank group. */
export function isBlankCategoryClick(name: string, hasNullGroup: boolean | undefined): boolean {
  return !!hasNullGroup && name === BLANK_LABEL;
}

interface CategoryAxisLike {
  type?: string;
  data?: unknown;
}

function relabelAxis(axis: unknown): unknown {
  const a = axis as CategoryAxisLike | undefined;
  if (!a || a.type !== "category" || !Array.isArray(a.data)) return axis;
  return { ...a, data: a.data.map(relabelNullCategory) };
}

/** Relabel the null group in a built aggregate chart option: the category axis' `data` (the x axis,
 *  or the y axis of a horizontal bar) and a pie's `data[].name` (legend and tooltip read these). Runs
 *  AFTER the history overlay has aligned on the raw keys. A time axis has no category data and is
 *  left untouched. */
export function relabelBlankCategory(option: EChartsOption): EChartsOption {
  const series = Array.isArray(option.series)
    ? option.series
    : option.series
      ? [option.series]
      : [];
  const relabelledSeries = series.map((s) => {
    const pie = s as { type?: string; data?: unknown };
    if (pie.type !== "pie" || !Array.isArray(pie.data)) return s;
    return {
      ...pie,
      data: pie.data.map((d: unknown) => {
        const item = d as { name?: unknown };
        return item && typeof item === "object" && item.name === NULL_GROUP_KEY
          ? { ...item, name: BLANK_LABEL }
          : d;
      }),
    };
  });
  return {
    ...option,
    ...(option.xAxis ? { xAxis: relabelAxis(option.xAxis) } : {}),
    ...(option.yAxis ? { yAxis: relabelAxis(option.yAxis) } : {}),
    ...(series.length > 0 ? { series: relabelledSeries } : {}),
  } as EChartsOption;
}
