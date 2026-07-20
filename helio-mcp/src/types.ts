/**
 * TypeScript mirrors of the Helio backend response shapes this server reads.
 *
 * These track the Scala `*Response` case classes under
 * `backend/.../api/protocols/`. Only the envelopes we assert on are typed
 * strongly; free-form payloads whose shape is determined by a `type`
 * discriminator (panel `config`, DataType rows, pipeline-step `config`) are
 * left as `unknown` / `Record<string, unknown>` and passed through verbatim —
 * the server is a thin wrapper and does not reinterpret them.
 */

/** `PagedResult[T]` — items + pagination envelope (PaginationProtocol). */
export interface Paged<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface ResourceMeta {
  createdBy: string;
  createdAt: string;
  lastUpdated: string;
}

export interface DashboardLayoutItem {
  panelId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardLayout {
  lg: DashboardLayoutItem[];
  md: DashboardLayoutItem[];
  sm: DashboardLayoutItem[];
  xs: DashboardLayoutItem[];
}

export interface DashboardResponse {
  id: string;
  name: string;
  meta: ResourceMeta;
  appearance: { background: string; gridBackground: string };
  layout: DashboardLayout;
  ownerId: string;
}

/** One panel as serialized in a dashboard export snapshot. `config` is a typed
 *  payload whose shape is keyed by `type` (chart/metric/table/…); passed through. */
export interface SnapshotPanelEntry {
  snapshotId: string;
  title: string;
  type: string;
  appearance: Record<string, unknown>;
  config: unknown;
}

export interface DashboardSnapshot {
  version: number;
  dashboard: {
    name: string;
    appearance: Record<string, unknown>;
    layout: DashboardLayout;
  };
  panels: SnapshotPanelEntry[];
}

/** DataSource is a discriminated union on `type` (csv/rest_api/sql/static). */
export interface DataSourceResponse {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  config?: unknown;
}

export interface DataFieldResponse {
  name: string;
  displayName: string;
  dataType: string;
  nullable: boolean;
}

export interface ComputedFieldResponse {
  name: string;
  displayName: string;
  expression: string;
  dataType: string;
}

export interface DataTypeResponse {
  id: string;
  /** Omitted on the wire when null (spray-json drops `None`): a MISSING
   *  sourceId means a pipeline-output DataType (panel-bindable). Always read it
   *  as `sourceId ?? null`, never `=== null`. */
  sourceId?: string | null;
  name: string;
  fields: DataFieldResponse[];
  computedFields: ComputedFieldResponse[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/types/:id/rows` — latest pipeline-run snapshot. */
export interface DataTypeRowsResponse {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/** `GET /api/pipelines` / `GET /api/pipelines/:id` — summary (no steps). */
export interface PipelineSummaryResponse {
  id: string;
  name: string;
  sourceDataSourceId: string;
  sourceDataSourceName: string;
  outputDataTypeName: string;
  outputDataTypeId: string;
  lastRunStatus: string | null;
  lastRunAt: string | null;
  lastRunRowCount: number | null;
  ownerId?: string | null;
}

/** One step from `GET /api/pipelines/:id/steps`. `config` shape is keyed by
 *  `type` (rename/filter/join/…); passed through untouched. */
export interface PipelineStepResponse {
  id: string;
  type: string;
  position: number;
  config: unknown;
}

export interface SchemaField {
  name: string;
  type: string;
}

/** `GET /api/pipelines/:id/analyze` — steps with per-step input/output schema. */
export interface PipelineAnalyzeResponse {
  id: string;
  name: string;
  sourceDataSourceName: string;
  outputDataTypeName: string;
  outputDataTypeId: string;
  sourceSchema: SchemaField[];
  steps: Array<{
    id: string;
    position: number;
    type: string;
    config: unknown;
    inputSchema: SchemaField[];
    outputSchema: SchemaField[];
    validationError: string | null;
  }>;
}

/** A panel as returned by `POST /api/panels` / `PATCH /api/panels/:id`.
 *  `config` shape is keyed by `type`; passed through. */
export interface PanelResponse {
  id: string;
  dashboardId: string;
  title: string;
  type: string;
  meta: ResourceMeta;
  appearance: Record<string, unknown>;
  ownerId: string;
  config: unknown;
  dataAsOf: string | null;
}

/** `POST /api/pipelines/:id/run` — synchronous run result (rows already written). */
export interface RunResultResponse {
  rows: Record<string, unknown>[];
  rowCount: number;
  stepRowCounts?: Record<string, number>;
  sourceRowCount?: number;
}

/** Per-panel grid placement in a proposal (optional). */
export interface ProposalPanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One proposed panel. No ids — data panels reference an existing
 *  pipeline-output DataType by id. Matches dashboard-proposal.schema.json. */
/** Viz-level aggregation spec for a metric panel — overrides only the `value`
 *  slot; matches `MetricAggregation` in panel.schema.json. */
export interface MetricAggregationSpec {
  value: string;
  agg: "count" | "sum" | "avg" | "min" | "max";
}

/** Viz-level groupBy aggregation spec for a chart panel (bar/line only);
 *  matches `ChartAggregation` in panel.schema.json. */
export interface ChartAggregationSpec {
  groupBy: string;
  agg: "count" | "sum" | "avg" | "min" | "max";
  yField: string;
}

/** `content`/`url`/`orientation` seed the initial config of text/markdown,
 *  image, and divider panels (applied at create time). `chartType`/
 *  `xAxisLabel`/`yAxisLabel`/`seriesColors` apply as a best-effort follow-up
 *  appearance update for chart panels. `label`/`unit` are a literal
 *  metric-panel display override — distinct from `fieldMapping.label`/
 *  `fieldMapping.unit`, which bind to a data column. All HEL-293.
 *
 *  `config` (HEL-316) is a generic passthrough merged over the config derived
 *  from the flat fields above, then decoded by the same panel-create path as
 *  create_panel's `config` — the escape hatch for v1.5 surfaces with no flat
 *  field: collection `{baseType,layout}`, chart `{chartOptions}`, table
 *  `{density,columnOrder}`, text/markdown `{dataTypeId,fieldMapping}`
 *  (HEL-244 binding). A metric/chart/table/collection panel's flat
 *  `dataTypeId` always stays authoritative over `config`; a text/markdown
 *  panel's `config.dataTypeId` is a real binding attempt and is validated
 *  against the same pipeline-only rule (V41) as any other binding — a
 *  source-companion or non-owned DataType is rejected. */
export interface ProposalPanel {
  title: string;
  type: string;
  dataTypeId?: string;
  fieldMapping?: Record<string, string>;
  aggregation?: MetricAggregationSpec | ChartAggregationSpec;
  content?: string;
  url?: string;
  orientation?: string;
  chartType?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  seriesColors?: string[];
  label?: string;
  unit?: string;
  layout?: ProposalPanelLayout;
  config?: Record<string, unknown>;
}

/** A dashboard proposal — the shared Proposal → Review → Apply artifact. */
export interface DashboardProposal {
  dashboardName: string;
  panels: ProposalPanel[];
}

/** CSV/static source preview (`GET /api/data-sources/:id/preview`). */
export interface CsvPreview {
  headers: string[];
  rows: string[][];
}

/** REST/SQL source preview (`GET /api/sources/:id/preview`). */
export interface RowsPreview {
  rows: unknown[];
  evaluationErrors?: string[];
}

/** REST auth input for `create_rest_data_source` — mirrors the backend's
 *  `RestApiAuthPayload` discriminated union (see `RestApiConfigPayload.toDomain`
 *  in `DataSourceProtocol.scala`). */
export type RestAuthInput =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "api_key"; name: string; value: string; in: "header" | "query" };

/** `POST /api/sources` response (REST/SQL create) — mirrors the backend's
 *  `CreateSourceResponse`. On the wire, `dataType`/`fetchError` are Scala
 *  `Option`s and are OMITTED entirely when `None` (spray-json drops `None`
 *  fields); the `helioApi.ts` wrappers normalize a missing field to `null`
 *  before returning this shape, so callers can always rely on the field being
 *  present (never `undefined`). */
export interface CreateSourceResult {
  source: DataSourceResponse;
  dataType: DataTypeResponse | null;
  fetchError: string | null;
}
