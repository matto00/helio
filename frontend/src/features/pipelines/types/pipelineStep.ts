// PipelineStep — discriminated union over `type` (CS2c-3a wire shape).
//
// Each subtype carries its own typed `config` shape — no JSON.parse /
// JSON.stringify at consumer sites. Use the `type` discriminator to narrow
// before accessing config fields. Extracted from `./models.ts` so the panel
// + pipeline-step ADTs each live in their own file.

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
export interface SplitTextConfig {
  field: string;
  mode: "paragraph" | "heading";
  headingLevel: number;
  indexField: string;
}
export interface ExtractHeadingsConfig {
  field: string;
  indexField: string;
  levelField: string;
}
export interface ChunkByTokenCountConfig {
  field: string;
  targetTokenCount: number;
  encoding: "o200k_base" | "cl100k_base";
  indexField: string;
  tokenCountField: string;
}
export interface DateBucketConfig {
  field: string;
  granularity: "day" | "week" | "month" | "quarter" | "year";
  outputColumn?: string | null;
}
export interface PivotConfig {
  index: string[];
  column: string;
  values: string;
  agg: "sum" | "count" | "avg" | "min" | "max" | "first";
}
export type WindowFunction = "row_number" | "rank" | "dense_rank" | "running_sum" | "lag" | "lead";
export interface WindowConfig {
  partitionBy: string[];
  orderBy: SortKey[];
  function: WindowFunction;
  field?: string | null;
  outputColumn: string;
  offset?: number | null;
}
export interface UnpivotConfig {
  idVars: string[];
  valueVars: string[];
  varName: string;
  valueName: string;
}
export interface DedupeConfig {
  keys: string[];
  keep: "first" | "last";
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
export interface SplitTextStep extends BasePipelineStep {
  type: "splittext";
  config: SplitTextConfig;
}
export interface ExtractHeadingsStep extends BasePipelineStep {
  type: "extractheadings";
  config: ExtractHeadingsConfig;
}
export interface ChunkByTokenCountStep extends BasePipelineStep {
  type: "chunkbytokencount";
  config: ChunkByTokenCountConfig;
}
export interface DateBucketStep extends BasePipelineStep {
  type: "datebucket";
  config: DateBucketConfig;
}
export interface PivotStep extends BasePipelineStep {
  type: "pivot";
  config: PivotConfig;
}
export interface WindowStep extends BasePipelineStep {
  type: "window";
  config: WindowConfig;
}
export interface UnpivotStep extends BasePipelineStep {
  type: "unpivot";
  config: UnpivotConfig;
}
export interface DedupeStep extends BasePipelineStep {
  type: "dedupe";
  config: DedupeConfig;
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
  | AggregateStep
  | SplitTextStep
  | ExtractHeadingsStep
  | ChunkByTokenCountStep
  | DateBucketStep
  | PivotStep
  | WindowStep
  | UnpivotStep
  | DedupeStep;

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
  | AggregateConfig
  | SplitTextConfig
  | ExtractHeadingsConfig
  | ChunkByTokenCountConfig
  | DateBucketConfig
  | PivotConfig
  | WindowConfig
  | UnpivotConfig
  | DedupeConfig;

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
export interface SplitTextAnalyzeStep extends BaseAnalyzeStep {
  type: "splittext";
  config: SplitTextConfig;
}
export interface ExtractHeadingsAnalyzeStep extends BaseAnalyzeStep {
  type: "extractheadings";
  config: ExtractHeadingsConfig;
}
export interface ChunkByTokenCountAnalyzeStep extends BaseAnalyzeStep {
  type: "chunkbytokencount";
  config: ChunkByTokenCountConfig;
}
export interface DateBucketAnalyzeStep extends BaseAnalyzeStep {
  type: "datebucket";
  config: DateBucketConfig;
}
export interface PivotAnalyzeStep extends BaseAnalyzeStep {
  type: "pivot";
  config: PivotConfig;
}
export interface WindowAnalyzeStep extends BaseAnalyzeStep {
  type: "window";
  config: WindowConfig;
}
export interface UnpivotAnalyzeStep extends BaseAnalyzeStep {
  type: "unpivot";
  config: UnpivotConfig;
}
export interface DedupeAnalyzeStep extends BaseAnalyzeStep {
  type: "dedupe";
  config: DedupeConfig;
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
  | AggregateAnalyzeStep
  | SplitTextAnalyzeStep
  | ExtractHeadingsAnalyzeStep
  | ChunkByTokenCountAnalyzeStep
  | DateBucketAnalyzeStep
  | PivotAnalyzeStep
  | WindowAnalyzeStep
  | UnpivotAnalyzeStep
  | DedupeAnalyzeStep;

export interface PipelineAnalyzeResponse {
  id: string;
  name: string;
  sourceDataSourceName: string;
  outputDataTypeName: string;
  outputDataTypeId: string;
  sourceSchema: SchemaField[];
  steps: AnalyzeStepResult[];
}

// ── Pipeline + run-status summary types ─────────────────────────────────────
// Extracted from `types/models.ts` in CS4 cycle 1.

export interface Pipeline {
  id: string;
  name: string;
  outputDataTypeId?: string;
}

export interface PipelineSummary {
  id: string;
  name: string;
  sourceDataSourceId: string;
  sourceDataSourceName: string;
  outputDataTypeName: string;
  outputDataTypeId?: string;
  lastRunStatus: "succeeded" | "failed" | null;
  lastRunAt: string | null;
  lastRunRowCount: number | null;
  ownerId?: string | null;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed";

export interface RunStatusResponse {
  runId: string;
  status: RunStatus;
  rows?: Record<string, unknown>[];
  error?: string;
}

export interface PipelineRunRecord {
  id: string;
  pipelineId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "dry_run";
  startedAt: string;
  completedAt: string | null;
  rowCount: number | null;
  errorLog: string | null;
  triggerSource: "manual" | "scheduled" | "external";
}

// ── Pipeline sharing types ────────────────────────────────────────────────────

export type GrantRole = "viewer" | "editor";

export interface PermissionGrant {
  granteeId: string | null;
  role: GrantRole;
  createdAt: string;
}
