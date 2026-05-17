export interface ResourceMeta {
  createdBy: string;
  createdAt: string;
  lastUpdated: string;
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

// DataSource discriminated-union ADT lives in `./dataSource.ts`; re-exported
// here so existing imports against `./models` keep working.
export type {
  CsvSource,
  CsvSourceConfig,
  DataSource,
  DataSourceKind,
  RestApiAuth,
  RestApiMethod,
  RestApiSourceConfig,
  RestSource,
  SqlSource,
  SqlSourceConfig,
  StaticSource,
} from "../features/sources/types/dataSource";
export {
  isCsvSource,
  isRestSource,
  isSqlSource,
  isStaticSource,
} from "../features/sources/types/dataSource";

// Panel discriminated union + per-subtype config types live in `./panel.ts`
// and are re-exported below for backwards-compatibility with imports written
// against `./models`.
export type {
  ChartPanel,
  ChartPanelConfig,
  DividerOrientation,
  DividerPanel,
  DividerPanelConfig,
  ImageFit,
  ImagePanel,
  ImagePanelConfig,
  MarkdownPanel,
  MarkdownPanelConfig,
  MetricPanel,
  MetricPanelConfig,
  Panel,
  PanelConfig,
  PanelKind,
  PanelType,
  TablePanel,
  TablePanelConfig,
  TextPanel,
  TextPanelConfig,
} from "../features/panels/types/panel";
import type { DividerOrientation, Panel, PanelKind } from "../features/panels/types/panel";

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
  type?: PanelKind;
}

export type MappedPanelData = Record<string, string>;

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

// ── Update API types ─────────────────────────────────────────────────────────

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

// PipelineStep + analyze types live in `./pipelineStep.ts`; re-exported here
// so existing imports against `./models` keep working.
export type {
  AggregateAnalyzeStep,
  AggregateConfig,
  AggregateField,
  AggregateStep,
  Aggregation,
  AnalyzeStepResult,
  CastAnalyzeStep,
  CastConfig,
  CastStep,
  ComputeAnalyzeStep,
  ComputeConfig,
  ComputeStep,
  FilterAnalyzeStep,
  FilterCondition,
  FilterConfig,
  FilterStep,
  GroupByAnalyzeStep,
  GroupByConfig,
  GroupByStep,
  JoinAnalyzeStep,
  JoinConfig,
  JoinStep,
  LimitAnalyzeStep,
  LimitConfig,
  LimitStep,
  PipelineAnalyzeResponse,
  PipelineStep,
  PipelineStepConfig,
  PipelineStepKind,
  RenameAnalyzeStep,
  RenameConfig,
  RenameStep,
  SchemaField,
  SelectAnalyzeStep,
  SelectConfig,
  SelectStep,
  SortAnalyzeStep,
  SortConfig,
  SortKey,
  SortStep,
} from "../features/pipelines/types/pipelineStep";
