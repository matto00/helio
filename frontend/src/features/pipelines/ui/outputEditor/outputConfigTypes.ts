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
import type { SortState } from "../../../../shared/ui/useSortedRows";

export interface ChartOutputConfig {
  chartType: ChartType;
  fieldMapping: Record<string, string>;
  aggregation?: ChartAggregation | null;
  chartOptions?: ChartTypeOptionsMap | null;
  annotation?: string | null;
}

/** HEL-451 design D1 — `columnFilters` is itself a small object (`quick` +
 *  `columns`), but it is stored as ONE flat sibling key on `TableOutputConfig`
 *  (never nested inside `columnSort` or a shared container), matching the
 *  ruling `columnSort` already established: it is replaced wholesale on every
 *  write, which is exactly the semantics wanted here — clearing a column's
 *  filter must not leave a stale key behind. */
export interface TableColumnFilters {
  /** Case-insensitive contains, matched across every visible column's
   *  rendered (`formatCell`) text. */
  quick?: string;
  /** Per-column case-insensitive contains, matched against that column's
   *  rendered text only. Multiple entries AND together. */
  columns?: Record<string, string>;
}

/** HEL-469 — a table-column-specific format vocabulary, deliberately
 *  SEPARATE from `MetricFormat` (design D2): the domains differ (a column
 *  can be a date; a metric can be a percent), but the two NAMES that
 *  overlap (`number`, `currency`) are reused verbatim so the surfaces do
 *  not drift into synonyms. Do NOT rename or re-point `MetricFormat`. */
export type TableColumnFormatType = "number" | "currency" | "date" | "text";

export function isTableColumnFormatType(value: unknown): value is TableColumnFormatType {
  return value === "number" || value === "currency" || value === "date" || value === "text";
}

/** One column's format spec. `decimals` (number) and `currency`/`decimals`
 *  (currency) are options only that format honours; `datePattern` only
 *  `date` honours — an option irrelevant to the chosen `type` is simply
 *  ignored by the formatter (design D3). */
export interface TableColumnFormatSpec {
  type: TableColumnFormatType;
  /** `number`/`currency` — fixed fraction digits; absent = locale default. */
  decimals?: number;
  /** `currency` — an explicit ISO 4217 code (design D2 divergence #1: never
   *  hardcoded, unlike `MetricRenderer.tsx:28`'s `"USD"`). Absent → `"USD"`. */
  currency?: string;
  /** `date` — one of `Intl.DateTimeFormatOptions.dateStyle`'s values.
   *  Absent → `"medium"`. */
  datePattern?: "short" | "medium" | "long" | "full";
}

/** Keyed by column name, one entry per formatted column. Columns with no
 *  entry render unformatted (`formatCell`), exactly as before this ticket. */
export type TableColumnFormats = Record<string, TableColumnFormatSpec>;

export interface TableOutputConfig {
  fieldMapping: Record<string, string>;
  columnOrder?: string[];
  /** HEL-448 — persisted `{ key, direction }`, same vocabulary as
   *  `useSortedRows`/`SortableTh` at runtime, no translation layer. Named
   *  `columnSort`, not `sort` — `TimelineOutputConfig.sort` below is a
   *  different type in this same file. This is a FLAT sibling of
   *  `columnOrder`, not a nested container, because `OutputService
   *  .mergeConfig` only deep-merges four hardcoded chart keys — any nested
   *  container here would be replaced wholesale on every unrelated patch.
   *  HEL-451 (columnFilters), HEL-465 (pinnedColumns) and HEL-469
   *  (columnFormats) should each land as their OWN flat sibling here too,
   *  never nested inside this field or a shared container. */
  columnSort?: SortState<string> | null;
  /** HEL-451 — see `TableColumnFilters` doc comment above for why this is a
   *  flat sibling rather than nested inside `columnSort`. */
  columnFilters?: TableColumnFilters | null;
  /** HEL-469 — same flat-sibling reasoning; keyed by column name, read
   *  tolerantly (`readColumnFormats`). A clear MUST write `{}`, never omit
   *  the key — `mergeConfig`'s shallow merge leaves an omitted key intact
   *  (design D3b), which is exactly wrong for clearing. */
  columnFormats?: TableColumnFormats;
  /** HEL-465 — a leading, contiguous run of `columnOrder`'s keys (design.md
   *  Decision 1); flat sibling for the same shallow-merge reason as every
   *  other field here. Clearing MUST write `[]`, never omit the key
   *  (design.md Decision 6). */
  pinnedColumns?: string[];
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

/** Tolerant read for `columnSort` (HEL-448 design D5): an object with a
 *  string `key` and a `direction` of EXACTLY `"asc"`/`"desc"`, else
 *  `undefined` — a key naming a column absent from the data needs no
 *  special handling here, `useSortedRows` already renders source order for
 *  it (design D2). */
function readColumnSort(value: unknown): SortState<string> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.key !== "string") return undefined;
  if (candidate.direction !== "asc" && candidate.direction !== "desc") return undefined;
  return { key: candidate.key, direction: candidate.direction };
}

/** Tolerant read for `columnFilters` (HEL-451 design D1): a non-object value
 *  yields `undefined`; a non-string `quick` is dropped; `columns` keeps only
 *  string-valued string keys, dropping anything else silently — mirrors
 *  `readColumnSort`'s tolerance for a config value that predates this field
 *  or was written by a future, looser version of it. */
function readColumnFilters(value: unknown): TableColumnFilters | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const out: TableColumnFilters = {};
  if (typeof candidate.quick === "string") out.quick = candidate.quick;
  if (candidate.columns && typeof candidate.columns === "object") {
    out.columns = safeRecord(candidate.columns);
  }
  return out;
}

/** Tolerant read for `columnFormats` (HEL-469 design task 1.3): a non-object
 *  value yields `undefined`; an entry whose `type` is not a recognised
 *  `TableColumnFormatType` is DROPPED (not the whole map); an entry naming a
 *  column absent from the current data is left in the map here and simply
 *  never applies at render (task 1.3 — ignored at render, not at read).
 *  Never throws. */
function readColumnFormats(value: unknown): TableColumnFormats | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const out: TableColumnFormats = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (!isTableColumnFormatType(candidate.type)) continue;
    const spec: TableColumnFormatSpec = { type: candidate.type };
    if (typeof candidate.decimals === "number") spec.decimals = candidate.decimals;
    if (typeof candidate.currency === "string") spec.currency = candidate.currency;
    if (
      candidate.datePattern === "short" ||
      candidate.datePattern === "medium" ||
      candidate.datePattern === "long" ||
      candidate.datePattern === "full"
    ) {
      spec.datePattern = candidate.datePattern;
    }
    out[key] = spec;
  }
  return out;
}

/** Tolerant read for `pinnedColumns` (HEL-465): a non-array value yields
 *  `undefined`; non-string entries are dropped, mirroring `columnOrder`'s own
 *  read above. */
function readPinnedColumns(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

export function readTableConfig(config: Record<string, unknown>): TableOutputConfig {
  return {
    fieldMapping: safeRecord(config.fieldMapping),
    columnOrder: Array.isArray(config.columnOrder) ? (config.columnOrder as string[]) : undefined,
    columnSort: readColumnSort(config.columnSort),
    columnFilters: readColumnFilters(config.columnFilters),
    columnFormats: readColumnFormats(config.columnFormats),
    pinnedColumns: readPinnedColumns(config.pinnedColumns),
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
