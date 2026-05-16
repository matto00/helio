export interface ResourceMeta {
  createdBy: string;
  createdAt: string;
  lastUpdated: string;
}

export interface DashboardAppearance {
  background: string;
  gridBackground: string;
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

export interface DataTypeField {
  name: string;
  displayName: string;
  dataType: string;
  nullable: boolean;
}

export interface ComputedField {
  name: string;
  displayName: string;
  expression: string;
  dataType: string;
}

export interface DataType {
  id: string;
  name: string;
  sourceId: string | null;
  version: number;
  fields: DataTypeField[];
  computedFields: ComputedField[];
  createdAt: string;
  updatedAt: string;
}

// ── DataSource (discriminated-union ADT, CS2c-2) ─────────────────────────────
//
// The backend exposes 4 source kinds, each with its own typed config. The
// wire shape carries a `type` discriminator and a per-subtype `config`
// payload (StaticSource has no config field).

export type DataSourceKind = "csv" | "rest_api" | "sql" | "static";

export interface CsvSourceConfig {
  path: string;
}

export type RestApiMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface RestApiAuth {
  type: "none" | "bearer" | "api_key";
  token?: string;
  name?: string;
  value?: string;
  in?: "header" | "query";
}

export interface RestApiSourceConfig {
  url: string;
  method?: RestApiMethod;
  auth?: RestApiAuth;
  headers?: Record<string, string>;
}

export interface SqlSourceConfig {
  dialect: "postgresql" | "mysql";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  query: string;
}

interface DataSourceBase {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CsvSource extends DataSourceBase {
  type: "csv";
  config: CsvSourceConfig;
}

export interface RestSource extends DataSourceBase {
  type: "rest_api";
  config: RestApiSourceConfig;
}

export interface SqlSource extends DataSourceBase {
  type: "sql";
  config: SqlSourceConfig;
}

export interface StaticSource extends DataSourceBase {
  type: "static";
}

export type DataSource = CsvSource | RestSource | SqlSource | StaticSource;

// ── Type-narrowing helpers ───────────────────────────────────────────────────
// Used by 3+ consumers (DataSourceList, SourceDetailPanel, refresh dispatcher)
// so we lift them out of the call sites.

export const isCsvSource = (s: DataSource): s is CsvSource => s.type === "csv";
export const isRestSource = (s: DataSource): s is RestSource => s.type === "rest_api";
export const isSqlSource = (s: DataSource): s is SqlSource => s.type === "sql";
export const isStaticSource = (s: DataSource): s is StaticSource => s.type === "static";

export interface InferredField {
  name: string;
  displayName: string;
  dataType: string;
  nullable: boolean;
}

export type StaticColumnType = "string" | "integer" | "float" | "boolean";

export interface StaticColumn {
  name: string;
  type: StaticColumnType;
}

export interface StaticSourcePayload {
  name: string;
  type: "static";
  columns: StaticColumn[];
  rows: unknown[][];
}

export interface Dashboard {
  id: string;
  name: string;
  meta: ResourceMeta;
  appearance: DashboardAppearance;
  layout: DashboardLayout;
}

export type PanelType = "metric" | "chart" | "text" | "table" | "markdown" | "image" | "divider";

export type ImageFit = "contain" | "cover" | "fill";

export type DividerOrientation = "horizontal" | "vertical";

// ── Panel creation initial type-specific config ──────────────────────────────

/** Optional config fields collected in step 3 of the panel creation modal
 *  for panel types that benefit from initial configuration. */
export type MetricTypeConfig = { type: "metric"; valueLabel?: string; unit?: string };
export type ChartTypeConfig = { type: "chart"; chartType?: "line" | "bar" | "pie" };
export type ImageTypeConfig = { type: "image"; imageUrl?: string };
export type DividerTypeConfig = { type: "divider"; dividerOrientation?: DividerOrientation };

export type TypeConfig = MetricTypeConfig | ChartTypeConfig | ImageTypeConfig | DividerTypeConfig;

export interface PanelUpdateFields {
  title?: string;
  appearance?: PanelAppearance;
  type?: PanelType;
}

export interface Panel {
  id: string;
  dashboardId: string;
  title: string;
  type: PanelType;
  meta: ResourceMeta;
  appearance: PanelAppearance;
  typeId: string | null;
  fieldMapping: Record<string, string> | null;
  refreshInterval: number | null;
  content: string | null;
  imageUrl: string | null;
  imageFit: ImageFit | null;
  dividerOrientation: DividerOrientation | null;
  dividerWeight: number | null;
  dividerColor: string | null;
}

export type MappedPanelData = Record<string, string>;

export interface DuplicateDashboardResponse {
  dashboard: Dashboard;
  panels: Panel[];
}

export interface DashboardSnapshotPanelEntry {
  snapshotId: string;
  title: string;
  type: string;
  appearance: {
    background?: string;
    color?: string;
    transparency?: number;
  };
  typeId?: string | null;
  fieldMapping?: Record<string, string> | null;
  content?: string | null;
}

export interface DashboardSnapshotDashboardEntry {
  name: string;
  appearance: {
    background?: string;
    gridBackground?: string;
  };
  layout: DashboardLayout;
}

export interface DashboardSnapshot {
  version: number;
  dashboard: DashboardSnapshotDashboardEntry;
  panels: DashboardSnapshotPanelEntry[];
}

export interface UserPreferences {
  accentColor: string | null;
  zoomLevels: Record<string, number>;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  preferences?: UserPreferences;
}

export interface PipelineSummary {
  id: string;
  name: string;
  sourceDataSourceName: string;
  outputDataTypeName: string;
  outputDataTypeId?: string;
  lastRunStatus: "succeeded" | "failed" | null;
  lastRunAt: string | null;
  lastRunRowCount: number | null;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: User;
}

// ── Update API types ─────────────────────────────────────────────────────────

export interface DashboardUpdatePayload {
  name?: string;
  appearance?: DashboardAppearance;
  layout?: DashboardLayout;
}

export interface UpdateDashboardBatchRequest {
  fields: string[];
  dashboard: DashboardUpdatePayload;
}

export interface PanelBatchItem {
  id: string;
  title?: string;
  appearance?: PanelAppearance;
  type?: string;
}

export interface UpdatePanelsBatchRequest {
  fields: string[];
  panels: PanelBatchItem[];
}

export interface UpdatePanelsBatchResponse {
  panels: Panel[];
}

export interface UserPreferencePayload {
  zoomLevel?: number;
  accentColor?: string;
  dashboardId?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  outputDataTypeId?: string;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed";

export interface RunStatusResponse {
  runId: string;
  status: RunStatus;
  rows?: Record<string, unknown>[];
  error?: string;
}

export interface UpdateUserPreferenceRequest {
  fields: string[];
  user: UserPreferencePayload;
}

// ── Panel query pagination types ─────────────────────────────────────────────

export interface PanelPaginationState {
  currentPage: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  rows: Record<string, unknown>[];
}

export interface PipelineRunRecord {
  id: string;
  pipelineId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "dry_run";
  startedAt: string;
  completedAt: string | null;
  rowCount: number | null;
  errorLog: string | null;
}

// ── PipelineStep — discriminated union over `type` (CS2c-3a wire shape) ────
//
// Each subtype carries its own typed `config` shape — no JSON.parse /
// JSON.stringify at consumer sites. Use the `type` discriminator to narrow
// before accessing config fields.

export interface RenameConfig {
  renames: Record<string, string>;
}
export interface FilterCondition {
  field: string;
  operator: string;
  value?: string | null;
}
export interface FilterConfig {
  combinator: string;
  conditions: FilterCondition[];
}
export interface JoinConfig {
  rightDataSourceId: string;
  joinKey: string;
  joinType: string;
}
export interface ComputeConfig {
  column: string;
  expression: string;
  type?: string | null;
}
export interface GroupByConfig {
  groupBy: string[];
  aggColumn: string;
  aggFunction: string;
}
export interface CastConfig {
  casts: Record<string, string>;
}
export interface SelectConfig {
  fields: string[];
}
export interface LimitConfig {
  count: number;
}
export interface SortKey {
  field: string;
  direction: string;
}
export interface SortConfig {
  sortBy: SortKey[];
}
export interface AggregateField {
  name: string;
  type: string;
}
export interface Aggregation {
  alias: string;
  fn: string;
  field: string;
}
export interface AggregateConfig {
  groupBy: AggregateField[];
  aggregations: Aggregation[];
}

interface BasePipelineStep {
  id: string;
  pipelineId: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface RenameStep extends BasePipelineStep {
  type: "rename";
  config: RenameConfig;
}
export interface FilterStep extends BasePipelineStep {
  type: "filter";
  config: FilterConfig;
}
export interface JoinStep extends BasePipelineStep {
  type: "join";
  config: JoinConfig;
}
export interface ComputeStep extends BasePipelineStep {
  type: "compute";
  config: ComputeConfig;
}
export interface GroupByStep extends BasePipelineStep {
  type: "groupby";
  config: GroupByConfig;
}
export interface CastStep extends BasePipelineStep {
  type: "cast";
  config: CastConfig;
}
export interface SelectStep extends BasePipelineStep {
  type: "select";
  config: SelectConfig;
}
export interface LimitStep extends BasePipelineStep {
  type: "limit";
  config: LimitConfig;
}
export interface SortStep extends BasePipelineStep {
  type: "sort";
  config: SortConfig;
}
export interface AggregateStep extends BasePipelineStep {
  type: "aggregate";
  config: AggregateConfig;
}

export type PipelineStep =
  | RenameStep
  | FilterStep
  | JoinStep
  | ComputeStep
  | GroupByStep
  | CastStep
  | SelectStep
  | LimitStep
  | SortStep
  | AggregateStep;

export type PipelineStepConfig =
  | RenameConfig
  | FilterConfig
  | JoinConfig
  | ComputeConfig
  | GroupByConfig
  | CastConfig
  | SelectConfig
  | LimitConfig
  | SortConfig
  | AggregateConfig;

export type PipelineStepKind = PipelineStep["type"];

// ── Pipeline analyze types ────────────────────────────────────────────────────

export interface SchemaField {
  name: string;
  type: string;
}

interface BaseAnalyzeStep {
  id: string;
  position: number;
  inputSchema: SchemaField[];
  outputSchema: SchemaField[];
  validationError?: string;
}

export interface RenameAnalyzeStep extends BaseAnalyzeStep {
  type: "rename";
  config: RenameConfig;
}
export interface FilterAnalyzeStep extends BaseAnalyzeStep {
  type: "filter";
  config: FilterConfig;
}
export interface JoinAnalyzeStep extends BaseAnalyzeStep {
  type: "join";
  config: JoinConfig;
}
export interface ComputeAnalyzeStep extends BaseAnalyzeStep {
  type: "compute";
  config: ComputeConfig;
}
export interface GroupByAnalyzeStep extends BaseAnalyzeStep {
  type: "groupby";
  config: GroupByConfig;
}
export interface CastAnalyzeStep extends BaseAnalyzeStep {
  type: "cast";
  config: CastConfig;
}
export interface SelectAnalyzeStep extends BaseAnalyzeStep {
  type: "select";
  config: SelectConfig;
}
export interface LimitAnalyzeStep extends BaseAnalyzeStep {
  type: "limit";
  config: LimitConfig;
}
export interface SortAnalyzeStep extends BaseAnalyzeStep {
  type: "sort";
  config: SortConfig;
}
export interface AggregateAnalyzeStep extends BaseAnalyzeStep {
  type: "aggregate";
  config: AggregateConfig;
}

export type AnalyzeStepResult =
  | RenameAnalyzeStep
  | FilterAnalyzeStep
  | JoinAnalyzeStep
  | ComputeAnalyzeStep
  | GroupByAnalyzeStep
  | CastAnalyzeStep
  | SelectAnalyzeStep
  | LimitAnalyzeStep
  | SortAnalyzeStep
  | AggregateAnalyzeStep;

export interface PipelineAnalyzeResponse {
  id: string;
  name: string;
  sourceDataSourceName: string;
  outputDataTypeName: string;
  outputDataTypeId: string;
  sourceSchema: SchemaField[];
  steps: AnalyzeStepResult[];
}
