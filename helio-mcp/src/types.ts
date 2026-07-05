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
