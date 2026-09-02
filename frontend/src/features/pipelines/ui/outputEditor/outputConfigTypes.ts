// Config shapes stored in `Output.config` (raw JSON on the wire), per
// `OutputKind` (task 5.1). Unlike the retired `PanelConfig` variants these
// carry no bind-target id — a bound field is just a column name resolved
// against capabilities-at-node (`NodeCapabilities.columns`), not a
// type-registry entity (design.md decision 3/HEL-903 dropped the DataType/
// Metric entities).
// Field names otherwise mirror the equivalent `PanelConfig` variant closely
// so a future Output->Panel-config render adapter (task 4.2) stays a
// near-identity mapping.

import type {
  AggFn,
  ChartAggregation,
  ChartTypeOptionsMap,
  MetricAggregation,
} from "../../../panels/types/panel";
import type { ChartType } from "../../../../utils/chartAppearance";
import type { CapabilityColumn, NodeCapabilities } from "../../types/output";
import type { SelectOption } from "../../../../shared/ui/index";

export interface ChartOutputConfig {
  chartType: ChartType;
  fieldMapping: Record<string, string>;
  aggregation?: ChartAggregation | null;
  chartOptions?: ChartTypeOptionsMap | null;
  annotation?: string | null;
}

export interface TableOutputConfig {
  fieldMapping: Record<string, string>;
  columnOrder?: string[];
}

/** Numeric display style for `metric`/`collection baseType: metric` renderers
 *  (HEL-876). `undefined`/absent behaves exactly like the pre-HEL-876 default
 *  (2 max fraction digits, no thousands grouping) — this is a purely additive
 *  config field, no existing Output loses its current rendering. */
export type MetricFormat = "number" | "integer" | "currency" | "percent";

export function isMetricFormat(value: unknown): value is MetricFormat {
  return value === "number" || value === "integer" || value === "currency" || value === "percent";
}

export interface MetricOutputConfig {
  fieldMapping: Record<string, string>;
  aggregation?: MetricAggregation | null;
  label?: string;
  unit?: string;
  format?: MetricFormat | null;
}

export interface MarkdownOutputConfig {
  content: string;
  fieldMapping: Record<string, string>;
}

export interface CollectionOutputConfig {
  fieldMapping: Record<string, string>;
  layout: "grid" | "list";
  /** `baseType: metric` items' numeric display style (HEL-876) — same
   *  semantics/values as `MetricOutputConfig.format`, applied per-item via
   *  `CollectionRenderer`'s `MetricRenderer` reuse. */
  format?: MetricFormat | null;
}

export interface TimelineOutputConfig {
  fieldMapping: Record<string, string>;
  sort: "asc" | "desc";
}

export function isAggFn(value: string): value is AggFn {
  return (
    value === "count" || value === "sum" || value === "avg" || value === "min" || value === "max"
  );
}

/** Column options for a bound field-select, derived from capabilities-at-node
 *  (task 5.1/5.2) instead of a DataType's fields/computedFields. */
export function columnOptions(capabilities: NodeCapabilities | undefined): SelectOption[] {
  if (!capabilities) return [];
  return capabilities.columns.map((c: CapabilityColumn) => ({ value: c.name, label: c.name }));
}

export function aggColumnOptions(capabilities: NodeCapabilities | undefined): SelectOption[] {
  return [{ value: "", label: "— None —" }, ...columnOptions(capabilities)];
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeRecord(value: unknown): Record<string, string> {
  if (value && typeof value === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  return {};
}

export function readChartConfig(config: Record<string, unknown>): ChartOutputConfig {
  return {
    chartType: (safeString(config.chartType, "line") as ChartType) || "line",
    fieldMapping: safeRecord(config.fieldMapping),
    aggregation: (config.aggregation as ChartAggregation | null | undefined) ?? null,
    chartOptions: (config.chartOptions as ChartTypeOptionsMap | null | undefined) ?? null,
    annotation: (config.annotation as string | null | undefined) ?? null,
  };
}

export function readTableConfig(config: Record<string, unknown>): TableOutputConfig {
  return {
    fieldMapping: safeRecord(config.fieldMapping),
    columnOrder: Array.isArray(config.columnOrder) ? (config.columnOrder as string[]) : undefined,
  };
}

export function readMetricConfig(config: Record<string, unknown>): MetricOutputConfig {
  return {
    fieldMapping: safeRecord(config.fieldMapping),
    aggregation: (config.aggregation as MetricAggregation | null | undefined) ?? null,
    label: typeof config.label === "string" ? config.label : undefined,
    unit: typeof config.unit === "string" ? config.unit : undefined,
    format: isMetricFormat(config.format) ? config.format : null,
  };
}

export function readMarkdownConfig(config: Record<string, unknown>): MarkdownOutputConfig {
  return {
    content: safeString(config.content),
    fieldMapping: safeRecord(config.fieldMapping),
  };
}

export function readCollectionConfig(config: Record<string, unknown>): CollectionOutputConfig {
  return {
    fieldMapping: safeRecord(config.fieldMapping),
    layout: config.layout === "list" ? "list" : "grid",
    format: isMetricFormat(config.format) ? config.format : null,
  };
}

export function readTimelineConfig(config: Record<string, unknown>): TimelineOutputConfig {
  return {
    fieldMapping: safeRecord(config.fieldMapping),
    sort: config.sort === "desc" ? "desc" : "asc",
  };
}
