// ── Panel discriminated union (CS2c-3c wire shape) ──────────────────────────
//
// Mirrors the backend `domain/panels/*Panel.scala` ADT and the wire
// `{ type, config }` shape emitted by `PanelResponse.fromDomain` /
// `PanelConfigCodec.encodeConfig`.
//
// Every consumer that needs subtype-specific data MUST narrow on `panel.type`
// (or use a helper from `panelNarrowing.ts`) before reading `panel.config`.
// The pre-CS2c-3c flat nullable fields (`typeId`, `fieldMapping`, `content`,
// `imageUrl`, `imageFit`, `dividerOrientation`, `dividerWeight`,
// `dividerColor`) no longer exist at the root.

import type { ResourceMeta } from "../../../types/models";

// ── Panel appearance + chart appearance shapes ──────────────────────────────
// Extracted from `types/models.ts` in CS4 cycle 1.

export interface ChartLegend {
  show: boolean;
  position: "top" | "bottom" | "left" | "right";
}

export interface ChartTooltip {
  enabled: boolean;
}

export interface ChartAxisLabel {
  show: boolean;
  label?: string;
}

export interface ChartAxisLabels {
  x: ChartAxisLabel;
  y: ChartAxisLabel;
}

export interface ChartAppearance {
  seriesColors: string[];
  legend: ChartLegend;
  tooltip: ChartTooltip;
  axisLabels: ChartAxisLabels;
  chartType?: "bar" | "line" | "pie" | "scatter";
}

export interface PanelAppearance {
  background: string;
  color: string;
  transparency: number;
  chart?: ChartAppearance;
}

export type PanelKind =
  | "metric"
  | "chart"
  | "table"
  | "text"
  | "markdown"
  | "image"
  | "divider"
  | "collection"
  | "timeline";

export type ImageFit = "contain" | "cover" | "fill";

export type CollectionLayout = "grid" | "list";

export type TableDensity = "condensed" | "normal" | "spacious";

export type DividerOrientation = "horizontal" | "vertical";

// ── Per-subtype config shapes ───────────────────────────────────────────────
//
// Field names mirror backend `domain/panels/<Subtype>PanelConfig`. The
// "bound trio" (metric/chart/table) all carry `dataTypeId` + `fieldMapping`;
// the backend emits `dataTypeId: ""` for unbound rows, so `isBound` checks
// must compare to a non-empty string rather than to `null`.

// ── Viz-level aggregation specs (HEL-292) ───────────────────────────────────
//
// Mirrors backend `domain/panels/{Metric,Chart}PanelConfig.aggregation` and
// `schemas/panel.schema.json` `$defs.MetricAggregation`/`ChartAggregation`.
// Reuses the pipeline `aggregate` step's function set — see
// `frontend/src/utils/aggregate.ts` and `AggregateStep.scala`.

export type AggFn = "count" | "sum" | "avg" | "min" | "max";

export interface MetricAggregation {
  value: string;
  agg: AggFn;
}

export interface ChartAggregation {
  groupBy: string;
  agg: AggFn;
  yField: string;
}

export interface MetricPanelConfig {
  dataTypeId: string;
  fieldMapping: Record<string, string>;
  aggregation?: MetricAggregation | null;
  /** Literal display label override — distinct from `fieldMapping.label`,
   *  which binds to a data column. HEL-293. */
  label?: string;
  /** Literal display unit override — distinct from `fieldMapping.unit`,
   *  which binds to a data column. HEL-293. */
  unit?: string;
}

// ── Per-chart-type display options (HEL-248) ────────────────────────────────
//
// Mirrors backend `domain/panels/ChartPanel.scala` (`ChartOptions` + per-type
// case classes) and `schemas/panel.schema.json` `$defs.ChartOptions`. Keyed
// per chart type so switching bar→pie→bar restores the original bar settings —
// nothing is destroyed on a type change. Every option maps to a real ECharts
// construct (see `ChartPanel.tsx`).

export interface LineChartOptions {
  /** series.smooth — smooth (spline) line interpolation. */
  smooth?: boolean;
  /** series.showSymbol — render point markers on the line. */
  showPoints?: boolean;
  /** series.areaStyle — fill the area beneath the line. */
  areaFill?: boolean;
}

export interface BarChartOptions {
  /** horizontal swaps the category/value axis roles. */
  orientation?: "vertical" | "horizontal";
  /** stacked → series.stack; normalized → stacked plus a client-side
   *  per-category percent transform with a 0–100% value axis. */
  stacking?: "none" | "stacked" | "normalized";
  /** series.barCategoryGap — spacing between category groups (0–100%). */
  barGapPct?: number;
}

export interface PieChartOptions {
  /** series.radius inner hole size, as a percentage (0 = full pie, 0–90). */
  donutHolePct?: number;
  /** series.label with a percentage formatter. */
  showPercentLabels?: boolean;
}

export interface ScatterChartOptions {
  /** Bound data-column key driving series.symbolSize (bubble sizing). */
  sizeField?: string;
  /** Bound data-column key grouping rows into one series per distinct value. */
  colorField?: string;
}

export interface ChartTypeOptionsMap {
  line?: LineChartOptions;
  bar?: BarChartOptions;
  pie?: PieChartOptions;
  scatter?: ScatterChartOptions;
}

export interface ChartPanelConfig {
  dataTypeId: string;
  fieldMapping: Record<string, string>;
  aggregation?: ChartAggregation | null;
  /** Per-chart-type display options. Absent falls back to prior rendering;
   *  entries under a non-active type are preserved across type switches. */
  chartOptions?: ChartTypeOptionsMap | null;
}

export interface TablePanelConfig {
  dataTypeId: string;
  fieldMapping: Record<string, string>;
  /** Per-column drag-resized pixel widths, keyed by column key. Absent/empty
   *  falls back to `DataGrid`'s default/derived widths. HEL-253. */
  columnWidths?: Record<string, number>;
  /** `DataGrid` row spacing. Absent falls back to normal. HEL-255. */
  density?: TableDensity;
  /** Ordered list of visible data-column keys. Absent/empty shows all columns
   *  in natural order; non-empty renders exactly those keys, in order,
   *  intersected with the keys present in the data. HEL-255. */
  columnOrder?: string[];
}

export interface TextPanelConfig {
  content: string;
  dataTypeId: string;
  fieldMapping: Record<string, string>;
}

export interface MarkdownPanelConfig {
  content: string;
  dataTypeId: string;
  fieldMapping: Record<string, string>;
}

export interface ImagePanelConfig {
  imageUrl: string;
  imageFit: string;
}

export interface DividerPanelConfig {
  orientation: string;
  weight?: number | null;
  color?: string | null;
}

// ── Collection panel (HEL-247) ──────────────────────────────────────────────
//
// Mirrors backend `domain/panels/CollectionPanel.scala` and
// `schemas/panel.schema.json` `$defs.CollectionConfig`. A Collection renders N
// homogeneous items of one `baseType`, bound to a multi-row DataType (one row =
// one item), with the shared `fieldMapping` applied to every item. Binding
// reuses `dataTypeId`/`fieldMapping` (the bound-trio shape); `baseType`,
// `layout`, and `itemOptions` are the collection-specific concerns.
//
// `itemOptions` is keyed per base type so a future base-type switch preserves
// the other type's options and adding a base type (image, markdown) is a
// code-only change — no schema-shape break (`baseType` widens its enum).

export interface CollectionMetricItemOptions {
  /** Literal label override applied to every metric item (HEL-243 literal-wins). */
  label?: string;
  /** Literal unit override applied to every metric item. */
  unit?: string;
}

export interface CollectionItemOptions {
  metric?: CollectionMetricItemOptions;
}

export interface CollectionPanelConfig {
  dataTypeId: string;
  /** Shared field mapping applied to every rendered item. */
  fieldMapping: Record<string, string>;
  /** Which base panel kind each item renders as. Ships with "metric" only. */
  baseType: string;
  /** Item layout. Absent/legacy falls back to "grid". */
  layout: CollectionLayout;
  /** Shared literal item overrides, keyed per base type. Options under a
   *  non-active base-type key are preserved across base-type switches. */
  itemOptions?: CollectionItemOptions | null;
}

// ── Timeline panel (HEL-317) ────────────────────────────────────────────────
//
// Mirrors backend `domain/panels/TimelinePanel.scala` and
// `schemas/panel.schema.json` `$defs.TimelineConfig`. A Timeline renders the
// bound DataType's rows as a vertical chronological event list — one row =
// one entry — using two field-mapping slots (`time`, `event`). Binding
// reuses `dataTypeId`/`fieldMapping` (the bound-trio shape); `timelineOptions`
// is the timeline-specific concern.

export type TimelineSort = "asc" | "desc";

export interface TimelineOptions {
  /** Chronological order. Absent/legacy falls back to "asc". */
  sort: TimelineSort;
}

export interface TimelinePanelConfig {
  dataTypeId: string;
  /** Binds the `time` (timestamp/order) and `event` (text) slots. */
  fieldMapping: Record<string, string>;
  timelineOptions: TimelineOptions;
}

export type PanelConfig =
  | MetricPanelConfig
  | ChartPanelConfig
  | TablePanelConfig
  | TextPanelConfig
  | MarkdownPanelConfig
  | ImagePanelConfig
  | DividerPanelConfig
  | CollectionPanelConfig
  | TimelinePanelConfig;

// ── Discriminated union ─────────────────────────────────────────────────────
//
// Common fields live on `PanelBase`; each variant adds `type` + typed
// `config`. `refreshInterval` is a frontend-only field that the backend
// silently ignores on PATCH (no schema or column exists for it); it is
// preserved here so the `usePanelPolling` hook keeps working until CS3
// removes it. It is `null` for any panel hydrated from the backend.

interface PanelBase {
  id: string;
  dashboardId: string;
  title: string;
  meta: ResourceMeta;
  appearance: PanelAppearance;
  ownerId?: string;
  /** Frontend-only polling interval; not persisted by the backend. */
  refreshInterval?: number | null;
  /** HEL-234: ISO-8601 timestamp of the most recent successful pipeline run
   *  that writes to this panel's bound DataType. Null/absent when unbound or
   *  when no pipeline has ever run successfully. */
  dataAsOf?: string | null;
}

export interface MetricPanel extends PanelBase {
  type: "metric";
  config: MetricPanelConfig;
}

export interface ChartPanel extends PanelBase {
  type: "chart";
  config: ChartPanelConfig;
}

export interface TablePanel extends PanelBase {
  type: "table";
  config: TablePanelConfig;
}

export interface TextPanel extends PanelBase {
  type: "text";
  config: TextPanelConfig;
}

export interface MarkdownPanel extends PanelBase {
  type: "markdown";
  config: MarkdownPanelConfig;
}

export interface ImagePanel extends PanelBase {
  type: "image";
  config: ImagePanelConfig;
}

export interface DividerPanel extends PanelBase {
  type: "divider";
  config: DividerPanelConfig;
}

export interface CollectionPanel extends PanelBase {
  type: "collection";
  config: CollectionPanelConfig;
}

export interface TimelinePanel extends PanelBase {
  type: "timeline";
  config: TimelinePanelConfig;
}

export type Panel =
  | MetricPanel
  | ChartPanel
  | TablePanel
  | TextPanel
  | MarkdownPanel
  | ImagePanel
  | DividerPanel
  | CollectionPanel
  | TimelinePanel;

// Legacy alias — `PanelType` was the discriminator string literal union under
// the pre-CS2c-3c flat shape. Same set as `PanelKind`; kept as an alias so
// existing consumers (e.g. `PanelContent` props, `PanelCreationModal`) need
// not rename.
export type PanelType = PanelKind;

// ── Default config factories ────────────────────────────────────────────────
//
// Used by `panelPayloads.ts` to build a typed `config` for create requests
// when the caller supplies no subtype-specific configuration.

export const emptyMetricConfig = (): MetricPanelConfig => ({
  dataTypeId: "",
  fieldMapping: {},
});

export const emptyChartConfig = (): ChartPanelConfig => ({
  dataTypeId: "",
  fieldMapping: {},
});

export const emptyTableConfig = (): TablePanelConfig => ({
  dataTypeId: "",
  fieldMapping: {},
  columnWidths: {},
});

export const emptyTextConfig = (): TextPanelConfig => ({
  content: "",
  dataTypeId: "",
  fieldMapping: {},
});

export const emptyMarkdownConfig = (): MarkdownPanelConfig => ({
  content: "",
  dataTypeId: "",
  fieldMapping: {},
});

export const emptyImageConfig = (): ImagePanelConfig => ({
  imageUrl: "",
  imageFit: "contain",
});

export const emptyDividerConfig = (): DividerPanelConfig => ({
  orientation: "horizontal",
});

export const emptyCollectionConfig = (): CollectionPanelConfig => ({
  dataTypeId: "",
  fieldMapping: {},
  baseType: "metric",
  layout: "grid",
});

export const emptyTimelineConfig = (): TimelinePanelConfig => ({
  dataTypeId: "",
  fieldMapping: {},
  timelineOptions: { sort: "asc" },
});

export function emptyConfigForKind(kind: PanelKind): PanelConfig {
  switch (kind) {
    case "metric":
      return emptyMetricConfig();
    case "chart":
      return emptyChartConfig();
    case "table":
      return emptyTableConfig();
    case "text":
      return emptyTextConfig();
    case "markdown":
      return emptyMarkdownConfig();
    case "image":
      return emptyImageConfig();
    case "divider":
      return emptyDividerConfig();
    case "collection":
      return emptyCollectionConfig();
    case "timeline":
      return emptyTimelineConfig();
  }
}

// ── Panel creation initial type-specific config ─────────────────────────────
// Extracted from `types/models.ts` in CS4 cycle 1.
//
// Optional config fields collected in step 3 of the panel creation modal
// for panel types that benefit from initial configuration.

export type MetricTypeConfig = { type: "metric"; valueLabel?: string; unit?: string };
export type ChartTypeConfig = { type: "chart"; chartType?: "line" | "bar" | "pie" | "scatter" };
export type ImageTypeConfig = { type: "image"; imageUrl?: string };

export type TypeConfig = MetricTypeConfig | ChartTypeConfig | ImageTypeConfig;

// ── Panel update + batch shapes ─────────────────────────────────────────────

export interface PanelUpdateFields {
  title?: string;
  appearance?: PanelAppearance;
  type?: PanelKind;
}

export type MappedPanelData = Record<string, string>;

/** Batch update entry mirrors `PATCH /api/panels/batch` wire shape:
 *  `{ id, title?, appearance?, type?, config? }` where `config` (when
 *  present) carries a typed patch determined by `type`. */
export interface PanelBatchItem {
  id: string;
  title?: string;
  appearance?: PanelAppearance;
  type?: string;
  config?: Record<string, unknown>;
}

export interface UpdatePanelsBatchRequest {
  fields: string[];
  panels: PanelBatchItem[];
}

export interface UpdatePanelsBatchResponse {
  panels: Panel[];
}

// ── Panel query pagination state ────────────────────────────────────────────

export interface PanelPaginationState {
  currentPage: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  rows: Record<string, unknown>[];
}
