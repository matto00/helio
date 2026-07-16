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

export type PanelKind = "metric" | "chart" | "table" | "text" | "markdown" | "image" | "divider";

export type ImageFit = "contain" | "cover" | "fill";

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

export interface ChartPanelConfig {
  dataTypeId: string;
  fieldMapping: Record<string, string>;
  aggregation?: ChartAggregation | null;
}

export interface TablePanelConfig {
  dataTypeId: string;
  fieldMapping: Record<string, string>;
  /** Per-column drag-resized pixel widths, keyed by column key. Absent/empty
   *  falls back to `DataGrid`'s default/derived widths. HEL-253. */
  columnWidths?: Record<string, number>;
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

export type PanelConfig =
  | MetricPanelConfig
  | ChartPanelConfig
  | TablePanelConfig
  | TextPanelConfig
  | MarkdownPanelConfig
  | ImagePanelConfig
  | DividerPanelConfig;

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

export type Panel =
  | MetricPanel
  | ChartPanel
  | TablePanel
  | TextPanel
  | MarkdownPanel
  | ImagePanel
  | DividerPanel;

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
  }
}

// ── Panel creation initial type-specific config ─────────────────────────────
// Extracted from `types/models.ts` in CS4 cycle 1.
//
// Optional config fields collected in step 3 of the panel creation modal
// for panel types that benefit from initial configuration.

export type MetricTypeConfig = { type: "metric"; valueLabel?: string; unit?: string };
export type ChartTypeConfig = { type: "chart"; chartType?: "line" | "bar" | "pie" };
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
