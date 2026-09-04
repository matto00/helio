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
// HEL-911 (design.md Decisions 1/1a): the discriminated secondary input shared by
// join/union/lookup, replacing each op's flat second-source id field
// (rightDataSourceId/otherDataSourceId/referenceDataSourceId). No legacy shape --
// a config still carrying the flat field is rejected by the backend, not silently
// upgraded.
export type SecondaryInput =
  | { kind: "source"; dataSourceId: string }
  | { kind: "lane"; stepId: string };

export interface JoinConfig {
  secondaryInput: SecondaryInput;
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
export type FillNullStrategy = "constant" | "forwardFill" | "mean" | "median" | "mode";
export interface FillNullConfig {
  columns: string[];
  strategy: FillNullStrategy;
  value?: string | null;
}
export type StringOpsOperation = "trim" | "upper" | "lower" | "split" | "extractRegex" | "concat";
export interface StringOpsConfig {
  operation: StringOpsOperation;
  field: string;
  outputColumn: string;
  pattern?: string | null;
  separator?: string | null;
  index?: number | null;
  fields?: string[] | null;
}
export type UnionMode = "byPosition" | "byName";
export interface UnionConfig {
  secondaryInput: SecondaryInput;
  mode: UnionMode;
}
export interface LookupConfig {
  secondaryInput: SecondaryInput;
  sourceKey: string;
  lookupKey: string;
  columns: string[];
}
export interface AssertRule {
  kind: string;
  field?: string | null;
  params: Record<string, unknown>;
  severity: string;
}
export interface AssertConfig {
  rules: AssertRule[];
}

interface BasePipelineStep {
  id: string;
  pipelineId: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  // HEL-412: the backend always serializes `enabled` (never omitted), but
  // this field stays `Option`-shaped on the wire type per the codebase's
  // spray-json Option-omission precedent — normalized to a real boolean
  // (`enabled ?? true`) at the service boundary in `pipelineService.ts`.
  enabled?: boolean;
  // HEL-908 task 3.4: mirrors the backend `PipelineStepProtocol.parentStepId`
  // (HEL-904/HEL-906) — `None`/absent for the pipeline's root step, otherwise
  // the id of the step this one is chained under. A step reached through its
  // parent's position-0 child is a TRUNK continuation; any other child is a
  // TAIL root (design.md decision 1). Never omitted by the backend for a
  // persisted step, but stays optional here since a freshly created
  // (not-yet-persisted) local `Step` may not have one yet.
  parentStepId?: string | null;
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
export interface FillNullStep extends BasePipelineStep {
  type: "fillnull";
  config: FillNullConfig;
}
export interface StringOpsStep extends BasePipelineStep {
  type: "stringops";
  config: StringOpsConfig;
}
export interface UnionStep extends BasePipelineStep {
  type: "union";
  config: UnionConfig;
}
export interface LookupStep extends BasePipelineStep {
  type: "lookup";
  config: LookupConfig;
}
export interface AssertStep extends BasePipelineStep {
  type: "assert";
  config: AssertConfig;
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
  | DedupeStep
  | FillNullStep
  | StringOpsStep
  | UnionStep
  | LookupStep
  | AssertStep;

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
  | DedupeConfig
  | FillNullConfig
  | StringOpsConfig
  | UnionConfig
  | LookupConfig
  | AssertConfig;

export type PipelineStepKind = PipelineStep["type"];

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
export interface FillNullAnalyzeStep extends BaseAnalyzeStep {
  type: "fillnull";
  config: FillNullConfig;
}
export interface StringOpsAnalyzeStep extends BaseAnalyzeStep {
  type: "stringops";
  config: StringOpsConfig;
}
export interface UnionAnalyzeStep extends BaseAnalyzeStep {
  type: "union";
  config: UnionConfig;
}
export interface LookupAnalyzeStep extends BaseAnalyzeStep {
  type: "lookup";
  config: LookupConfig;
}
export interface AssertAnalyzeStep extends BaseAnalyzeStep {
  type: "assert";
  config: AssertConfig;
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
  | DedupeAnalyzeStep
  | FillNullAnalyzeStep
  | StringOpsAnalyzeStep
  | UnionAnalyzeStep
  | LookupAnalyzeStep
  | AssertAnalyzeStep;

// HEL-910 final sweep: `outputDataTypeName`/`outputDataTypeId` removed from
// `PipelineAnalyzeResponse`, `Pipeline`, and `PipelineSummary` -- the
// backend's real wire shapes (`PipelineAnalyzeProtocol.scala`,
// `PipelineProtocol.scala`) have never carried these fields, and nothing in
// this codebase read them off any of these types (the only reader,
// `selectPipelineNameByOutputTypeId`, was itself dead -- zero non-test
// consumers -- and was removed alongside these fields; see HEL-910
// evaluation-1.md CR1).
// HEL-969: mirrors the backend's per-root analyze response shape -- one
// entry per pipeline root, replacing the single scalar name/schema pair
// HEL-913 retired when it moved a pipeline's source from a scalar to a
// `roots[]` array (`PipelineAnalyzeProtocol.scala`).
//
// A per-root display name is deliberately OMITTED here, not renamed. The
// analyze wire response still sends one, spelled with a `source`-prefix
// that this ticket's AC3 bars from appearing anywhere under `frontend/src`
// (a mechanical grep, comments included) -- and unlike the `PipelineSummary`
// scalars HEL-913 retired, this one field was never touched by that
// migration, so it is still genuinely present on the wire. That leaves no
// name this type could give the field that is both AC3-compliant and
// truthful about what is sent, so the field is left off entirely rather
// than given a name (e.g. matching the sibling `PipelineRootSummaryResponse
// .dataSourceName` convention) that the wire does not actually use --
// exactly the silently-wrong-type defect class this ticket exists to close.
// Extra JSON keys are unremarkable in TypeScript, so this is a safe, honest
// gap, not a lossy one: nothing in this codebase reads this field today
// (grep-confirmed zero consumers). Aligning the backend's two per-root
// response shapes onto one spelling is tracked separately as HEL-975; the
// next person who needs this value should look there, not re-guess a name.
export interface RootSourceSchema {
  rootId: string;
  sourceSchema: SchemaField[];
}

export interface PipelineAnalyzeResponse {
  id: string;
  name: string;
  sourceSchemas: RootSourceSchema[];
  steps: AnalyzeStepResult[];
}

// Extracted from `types/models.ts` in CS4 cycle 1.

export interface Pipeline {
  id: string;
  name: string;
}

// HEL-969: mirrors the backend's `PipelineRootSummaryResponse` -- a pipeline
// binds to one or more sources via `roots[]`, not the pair of removed
// scalar id/name fields HEL-913 retired.
export interface PipelineRoot {
  id: string;
  dataSourceId: string;
  dataSourceName: string;
}

export interface PipelineSummary {
  id: string;
  name: string;
  roots: PipelineRoot[];
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

// HEL-576: `AssertionSummary` is always present on `PipelineRunRecord`,
// zero-valued (not absent/undefined) for a run with no `assert` steps —
// mirrors the backend's `AssertionSummary` default-valued convention so
// consumers never need to null-check it.
export interface AssertionFailureDetail {
  kind: string;
  field: string | null;
  severity: "warn" | "error";
  message: string | null;
}

export interface AssertionSummary {
  passed: number;
  warnFailed: number;
  errorFailed: number;
  failures: AssertionFailureDetail[];
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
  assertions: AssertionSummary;
}

export type GrantRole = "viewer" | "editor";

export interface PermissionGrant {
  granteeId: string | null;
  role: GrantRole;
  createdAt: string;
}
