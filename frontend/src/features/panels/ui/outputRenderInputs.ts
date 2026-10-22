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
import { chartAggregationSpec, type ChartAggregationSpec } from "../history/chartOverlay";
import { resolveServerMetricField } from "../history/metricHistoryView";
import { resolvePanelChartType } from "./resolvePanelChartType";

type Records = Record<string, unknown>[];

/** The stringified grid a renderer reads, from typed record rows: the exact conversion `usePanelData` has always done
 *  (header order = the first record's key order; a missing cell is `""`). */
export function recordsToPanelRows(records: Records | null | undefined): {
  headers: string[] | null;
  rawRows: string[][] | null;
} {
  if (!records || records.length === 0) return { headers: null, rawRows: null };
  return {
    headers: Object.keys(records[0]).map(String),
    rawRows: records.map((row) =>
      Object.values(row).map((v) => (v !== null && v !== undefined ? String(v) : "")),
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
