//
// Mirrors the backend `domain/panels/*Panel.scala` ADT and the wire
// `{ type, config }` shape emitted by `PanelResponse.fromDomain` /
// `PanelConfigCodec.encodeConfig`.
//
// HEL-909 (P1.6): the "bound trio" (metric/chart/table) plus
// collection/timeline panel kinds are retired. A placement now carries only
// `outputId` — everything the old bound configs carried (`fieldMapping`,
// `aggregation`, `chartOptions`, `columnWidths`/`density`/`columnOrder`,
// `timelineOptions`, `metricId`, `label`/`unit`) lives on the fetched Output
// itself (`GET /api/outputs/:id`, `outputConfigTypes.ts`), not on the
// placement record. Rendering an output panel requires fetching the Output
// separately (see `OutputPreviewPane.tsx` for the established fetch/render
// pattern) — an `OutputPanel` alone does not carry enough to render.
//
// Every consumer that needs subtype-specific data MUST narrow on
// `panel.type` (or use a helper from `panelNarrowing.ts`) before reading
// `panel.config`.

import type { ResourceMeta } from "../../../types/models";

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

export type PanelKind = "output" | "text" | "markdown" | "image" | "divider" | "form";

export type ImageFit = "contain" | "cover" | "fill";

export type DividerOrientation = "horizontal" | "vertical";

//
// Reused by `outputConfigTypes.ts` and any surviving aggregate-function
// consumer (pipeline `aggregate` step, `utils/aggregate.ts`). Kept here
// because it predates the Output config split and several files still
// import it from this module.

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

//
// Mirrors backend `domain/panels/ChartPanel.scala` (`ChartOptions` + per-type
// case classes) — kept here because `outputConfigTypes.ts` (Output-side
// chart config) still references these per-chart-type option shapes.

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

//
// Placement config for an output-kind panel. Mirrors backend
// `domain/panels/OutputPanel.scala`'s `OutputPanelConfig`.

export interface OutputPanelConfig {
  outputId: string;
}

export interface TextPanelConfig {
  content: string;
}

export interface MarkdownPanelConfig {
  content: string;
}

export interface ImagePanelConfig {
  imageUrl: string;
  imageFit: string;
  /** Optional static caption rendered as a strip beneath the image.
   *  Absent/blank hides it; send `null` to clear. HEL-318. */
  caption?: string | null;
}

export interface DividerPanelConfig {
  orientation: string;
  weight?: number | null;
  color?: string | null;
}

//
// Config for the `form`-kind panel (HEL-1083). Mirrors backend
// `domain/panels/FormPanel.scala`'s `FormPanelConfig`. A `form` panel writes
// rows into a `dataset`-kind data source rather than reading a materialized
// Output — it binds via `dataSourceId`, not `outputId`. `control` is a
// presentation vocabulary deliberately orthogonal to the dataset's own
// declared field type — a form field never re-declares its own data type.

export type FormFieldControl =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "checkbox"
  | "file"
  | "counter";

export interface FormFieldSpec {
  sourceField: string;
  control: FormFieldControl;
  label?: string;
  placeholder?: string;
  helpText?: string;
  /** Tighten-only: absent inherits the dataset declaration, `true` adds a
   *  form-level requirement. `false` is rejected by the backend as malformed. */
  required?: boolean;
  /** Prefill only — never changes what is stored for an omitted field. */
  initialValue?: unknown;
  /** Valid alongside `control: "number"` or `control: "counter"` (HEL-1088)
   *  — the counter's `+`/`-` increment size, defaulting to `1` when absent.
   *  Not valid for any other control. */
  step?: number;
  /** Required when `control` is `"select"`. */
  options?: unknown;
}

export interface FormSubmitSpec {
  /** Fixed to `"append"` — a form submit appends one row and never replaces
   *  the dataset's contents. */
  writeMode: "append";
  label?: string;
  resetOnSuccess?: boolean;
}

export interface FormPanelConfig {
  dataSourceId: string;
  fields: FormFieldSpec[];
  submit: FormSubmitSpec;
}

export type PanelConfig =
  | OutputPanelConfig
  | TextPanelConfig
  | MarkdownPanelConfig
  | ImagePanelConfig
  | DividerPanelConfig
  | FormPanelConfig;

//
// Common fields live on `PanelBase`; each variant adds `kind` + typed
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
  /** Decision-15 server-owned default grid placement (HEL-909) — present
   *  only on the `POST /api/panels` response for a newly placed `output`
   *  panel; absent everywhere else (layout otherwise lives on the
   *  dashboard's own `layout` field, not re-echoed per panel). */
  layout?: { x: number; y: number; w: number; h: number };
}

export interface OutputPanel extends PanelBase {
  type: "output";
  config: OutputPanelConfig;
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

export interface FormPanel extends PanelBase {
  type: "form";
  config: FormPanelConfig;
}

export type Panel = OutputPanel | TextPanel | MarkdownPanel | ImagePanel | DividerPanel | FormPanel;

// Legacy alias — `PanelType` was the discriminator string literal union under
// the pre-HEL-909 shape. Same set as `PanelKind`; kept as an alias so
// existing consumers need not rename their type-only imports.
export type PanelType = PanelKind;

//
// Used by `panelPayloads.ts` to build a typed `config` for create requests
// when the caller supplies no subtype-specific configuration.

export const emptyOutputConfig = (): OutputPanelConfig => ({
  outputId: "",
});

export const emptyTextConfig = (): TextPanelConfig => ({
  content: "",
});

export const emptyMarkdownConfig = (): MarkdownPanelConfig => ({
  content: "",
});

export const emptyImageConfig = (): ImagePanelConfig => ({
  imageUrl: "",
  imageFit: "contain",
});

export const emptyDividerConfig = (): DividerPanelConfig => ({
  orientation: "horizontal",
});

export const emptyFormConfig = (): FormPanelConfig => ({
  dataSourceId: "",
  fields: [],
  submit: { writeMode: "append" },
});

// HEL-1087 design.md D2/D5 — the wire shapes for `POST /api/panels/:id/submit`.

/** Request body — `values` is the only recognized key (backend `FormSubmitRequest`). */
export interface FormSubmitRequest {
  values: Record<string, unknown>;
}

/** One field-level validation failure on the wire (backend `FieldValidationError`). */
export interface FieldValidationError {
  field: string;
  reason: string;
}

export function emptyConfigForKind(kind: PanelKind): PanelConfig {
  switch (kind) {
    case "output":
      return emptyOutputConfig();
    case "text":
      return emptyTextConfig();
    case "markdown":
      return emptyMarkdownConfig();
    case "image":
      return emptyImageConfig();
    case "divider":
      return emptyDividerConfig();
    case "form":
      return emptyFormConfig();
  }
}

export interface PanelUpdateFields {
  title?: string;
  appearance?: PanelAppearance;
  type?: PanelKind;
}

export type MappedPanelData = Record<string, string>;

/** Batch update entry mirrors `PATCH /api/panels/batch` wire shape:
 *  `{ id, title?, appearance?, kind?, config? }` where `config` (when
 *  present) carries a typed patch determined by `kind`. */
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

export interface PanelPaginationState {
  currentPage: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  rows: Record<string, unknown>[];
  /** HEL-946 Bug C(2): `false` means the bound Output's node has never had a
   *  successful pipeline run since the Output was added — distinct from a
   *  genuine empty result (`materialized: true`, `rows` still empty).
   *  Defaults to `true` before the first fetch resolves, so nothing flashes
   *  a "run the pipeline" prompt while loading. */
  materialized: boolean;
}
