// HEL-1632 (design.md D1): the pure render inputs the saved panel path (`ChartOutputPanel`, `MetricOutputPanel`,
// `usePanelData`) and the pipeline page's live Output column both feed to the shared renderers. One definition of each
// conversion is what makes the live render match a saved panel for the same rows by construction, not by convention.

import type { ChartTypeOptionsMap, PanelAppearance } from "../types/panel";
import type { OutputSchemaField } from "../../pipelines/types/output";
import {
  readChartConfig,
  readMetricConfig,
} from "../../pipelines/ui/outputEditor/outputConfigTypes";
import { computeAggregate, groupAndAggregate } from "../../../utils/aggregate";
import { aggregateSeriesName } from "../../../utils/chartClickSelection";
import { defaultChartAppearance } from "../../../theme/appearance";
import { groupHasNull } from "../../../utils/blankLabel";
import { isNonAggregatingChartType } from "../../../utils/chartTypes";
import { toChartFieldTypes, type ChartFieldTypes } from "../../../utils/chartTimeAxis";
import { sanitizeReferenceMarks, type ReferenceMarks } from "../../../utils/referenceMarks";
import {
  chartAggregationSpec,
  selectChartOverlay,
  type ChartAggregationSpec,
  type ChartOverlay,
  type ChartOverlayContext,
} from "../history/chartOverlay";
import type { OutputHistory } from "../history/outputHistoryService";
import { resolveChartPlan } from "../../../utils/chartTimePlan";
import { defaultPanelAppearance } from "../../../theme/appearance";
import { resolveServerMetricField } from "../history/metricHistoryView";
import { resolvePanelChartType } from "./resolvePanelChartType";

type Records = Record<string, unknown>[];

/** The stringified grid a renderer reads, from typed record rows (a missing cell is `""`). The header order is `columns`
 *  when the rows response carried one (HEL-1705: a parsed row's key order is not the Output's, and a browser lists integer-like
 *  keys first), else the first record's key order; each raw row is read by header, never by `Object.values`. */
export function recordsToPanelRows(
  records: Records | null | undefined,
  columns?: readonly string[] | null,
): {
  headers: string[] | null;
  rawRows: string[][] | null;
} {
  if (!records || records.length === 0) return { headers: null, rawRows: null };
  const headers =
    columns && columns.length > 0 ? [...columns] : Object.keys(records[0]).map(String);
  return {
    headers,
    rawRows: records.map((row) =>
      headers.map((h) => {
        const v = row[h];
        return v !== null && v !== undefined ? String(v) : "";
      }),
    ),
  };
}

/** The panel's stored chart type wins; an absent one renders `line`, so only a type the renderers would not already
 *  default to needs injecting. */
export function resolveChartAppearance(
  appearance: PanelAppearance,
  chartType: ReturnType<typeof resolvePanelChartType>,
): PanelAppearance {
  return appearance.chart?.chartType || chartType === "line"
    ? appearance
    : { ...appearance, chart: { ...(appearance.chart ?? defaultChartAppearance), chartType } };
}

/** The grouped series an aggregated chart plots, or `null` when there is no spec or no records to group. */
export function buildChartAggregate(
  spec: ChartAggregationSpec | null,
  records: Records | null | undefined,
  hasNullGroup: boolean,
) {
  if (!spec || !records) return null;
  return {
    ...groupAndAggregate(records, spec.groupBy, spec.agg, spec.yField),
    seriesName: aggregateSeriesName(spec),
    groupBy: spec.groupBy,
    // HEL-1424 -- the chart relabels the null group "(blank)" only when it really is null.
    hasNullGroup,
  };
}

/** The spec an aggregated, non-scatter chart groups by (scatter never aggregates). */
export function chartGroupingSpec(
  chartType: ReturnType<typeof resolvePanelChartType>,
  config: Record<string, unknown>,
): ChartAggregationSpec | null {
  return isNonAggregatingChartType(chartType) ? null : chartAggregationSpec(config);
}

export interface ChartRenderInputs {
  appearance: PanelAppearance;
  fieldMapping: Record<string, string>;
  chartAggregate: ReturnType<typeof buildChartAggregate>;
  /** The click spec: the grouping spec carrying whether a strict-null group exists. */
  aggregationSpec: (ChartAggregationSpec & { groupHasNull: boolean }) | null;
  chartOptions: ChartTypeOptionsMap | null | undefined;
  annotation: string | null;
  referenceMarks: ReferenceMarks;
  fieldTypes: ChartFieldTypes | null;
}

/** Everything `ChartRenderer` takes from an Output's config and rows, minus the history overlay. `appearance` is the
 *  panel's own (the live view passes the default one, so the chart type is the Output's). */
export function chartRenderInputs(args: {
  config: Record<string, unknown>;
  schema?: OutputSchemaField[] | null;
  appearance: PanelAppearance;
  records: Records | null | undefined;
}): ChartRenderInputs {
  const { config, schema, appearance, records } = args;
  const cfg = readChartConfig(config);
  const chartType = resolvePanelChartType(appearance.chart, config);
  const spec = chartGroupingSpec(chartType, config);
  const hasNullGroup = groupHasNull(records, spec?.groupBy);
  return {
    appearance: resolveChartAppearance(appearance, chartType),
    fieldMapping: cfg.fieldMapping,
    chartAggregate: buildChartAggregate(spec, records, hasNullGroup),
    aggregationSpec: spec ? { ...spec, groupHasNull: hasNullGroup } : null,
    chartOptions: cfg.chartOptions,
    annotation: cfg.annotation ?? null,
    referenceMarks: sanitizeReferenceMarks(config.referenceLines, config.referenceBands),
    fieldTypes: toChartFieldTypes(schema),
  };
}

/** A metric's headline from the rows alone (never the history): the aggregate of the resolved field, else the first
 *  row's cell. `records` win over the stringified grid when both are given. */
export function metricLoadedValue(
  config: Record<string, unknown>,
  records: Records | null | undefined,
  rawRows: string[][] | null | undefined,
  headers: string[] | null | undefined,
): string {
  const cfg = readMetricConfig(config);
  const firstRow =
    rawRows && headers && rawRows.length > 0
      ? Object.fromEntries(headers.map((h, i) => [h, rawRows[0][i]]))
      : null;
  const valueColumn = resolveServerMetricField(config)?.field;
  const rowsAsRecords =
    records ??
    (rawRows && headers
      ? rawRows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])))
      : []);
  return valueColumn && cfg.aggregation?.agg
    ? String(computeAggregate(rowsAsRecords, valueColumn, cfg.aggregation.agg) ?? "")
    : valueColumn && firstRow
      ? String(firstRow[valueColumn] ?? "")
      : "";
}

export interface KeyAggregate {
  /** Uppercase tile label, e.g. `AVG MINUTES`. */
  label: string;
  value: number;
}

/** The live view's second summary tile: a metric's resolved field and aggregation, or an aggregated chart's y field
 *  and aggregation, via `computeAggregate`. `null` for every other shape (only the rows tile shows). */
export function keyAggregate(
  kind: string,
  config: Record<string, unknown>,
  records: Records | null | undefined,
): KeyAggregate | null {
  if (!records) return null;
  let field: string | null = null;
  let agg: string | null = null;
  if (kind === "metric") {
    const resolved = resolveServerMetricField(config);
    field = resolved?.field ?? null;
    agg = resolved?.agg ?? null;
  } else if (kind === "chart") {
    const spec = chartGroupingSpec(resolvePanelChartType(undefined, config), config);
    field = spec?.yField ?? null;
    agg = spec?.agg ?? null;
  }
  if (field === null || agg === null) return null;
  const value = computeAggregate(records, field, agg as Parameters<typeof computeAggregate>[2]);
  if (value === null) return null;
  return { label: `${agg} ${field}`.toUpperCase(), value };
}

/** The overlay a chart Output draws from its history baseline: `selectChartOverlay`, except while the chart falls back to raw
 *  rows although the Output is aggregated (no records to group), where the grouped baseline does not describe the plot. The one
 *  definition the dashboard panel and the live Output column share (HEL-1705). */
export function chartPlotOverlay(args: {
  history: OutputHistory | null;
  config: Record<string, unknown>;
  aggregationSpec: ChartAggregationSpec | null;
  chartAggregate: ReturnType<typeof buildChartAggregate>;
  ctx: ChartOverlayContext;
}): ChartOverlay | null {
  const { history, config, aggregationSpec, chartAggregate, ctx } = args;
  const groupedPlot = aggregationSpec === null || chartAggregate !== null;
  return groupedPlot ? selectChartOverlay(history, config, ctx) : null;
}

/** HEL-1705 D5 -- the live view's `LATEST <Y>` tile for a plain chart: a single-series line or bar chart with no aggregation,
 *  an x and a y mapped, shows the y of the last point the chart plots, in the order it plots them (the time-axis plan's, not
 *  record order); a last point with no numeric y is walked back over. `null` for every other shape. */
export function latestYAggregate(
  kind: string,
  config: Record<string, unknown>,
  schema: OutputSchemaField[] | null | undefined,
  records: Records | null | undefined,
  columns?: readonly string[] | null,
): KeyAggregate | null {
  if (kind !== "chart" || !records || records.length === 0) return null;
  const chartType = resolvePanelChartType(undefined, config);
  if (chartType !== "line" && chartType !== "bar") return null;
  if (chartGroupingSpec(chartType, config) !== null) return null;
  const { fieldMapping, appearance, chartOptions, fieldTypes } = chartRenderInputs({
    config,
    schema,
    appearance: defaultPanelAppearance,
    records,
  });
  const { xAxis, yAxis, series } = fieldMapping;
  if (!xAxis || !yAxis || series) return null;
  const { headers, rawRows } = recordsToPanelRows(records, columns);
  if (!headers || !rawRows) return null;
  const yCol = headers.indexOf(yAxis);
  if (yCol === -1 || !headers.includes(xAxis)) return null;
  const plan = resolveChartPlan({
    appearance,
    rawRows,
    headers,
    fieldMapping,
    chartAggregate: null,
    chartOptions,
    fieldTypes,
  });
  if (plan.source !== "rows") return null;
  const plotted =
    plan.timePlan.kind === "time"
      ? plan.timePlan.timed.map((r) => r.row)
      : plan.timePlan.kind === "category-fallback"
        ? plan.timePlan.ordered
        : rawRows;
  for (let i = plotted.length - 1; i >= 0; i -= 1) {
    const y = parseFloat(plotted[i][yCol] ?? "");
    if (!Number.isNaN(y)) return { label: `LATEST ${yAxis}`.toUpperCase(), value: y };
  }
  return null;
}
