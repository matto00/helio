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
  /** HEL-907 evaluator-1 CR3 (V95): free-form grouping tag, HEL-366's
   *  existing convention extended to dashboards. Omitted on the wire when
   *  unset (spray-json drops `Option = None`) — read as `tag ?? null`. */
  tag?: string | null;
}

/** One panel as serialized in a dashboard export snapshot. `config` is a typed
 *  payload whose shape is keyed by `type` (chart/metric/table/…); passed through. */
export interface SnapshotPanelEntry {
  snapshotId: string;
  /** HEL-368: stable, non-remapped real panel id (additive; absent on
   *  exports captured before this field existed). Prefer this over
   *  `snapshotId` for programmatic identification. */
  id?: string;
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
export interface InferredFieldResponse {
  name: string;
  displayName: string;
  dataType: string;
  nullable: boolean;
}

/** `DataSource.inferredSchema` (HEL-904, moved from the retired `DataTypeProtocol`). */
export interface InferredSchemaResponse {
  fields: InferredFieldResponse[];
}

export interface DataSourceResponse {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  config?: unknown;
  /** HEL-366: optional free-form grouping tag, set only at create time. Omitted on the wire
   *  when null (spray-json drops `Option = None`) — read as `tag ?? null`. */
  tag?: string | null;
  /** HEL-907 design.md Decision 6: the source's own inferred schema (`DataSourceProtocol.scala`'s
   *  `inferredSchema: Option[InferredSchemaResponse]`). Omitted on the wire when `None` (spray-json
   *  drops `Option = None`) — read as `inferredSchema?.fields ?? []`. */
  inferredSchema?: InferredSchemaResponse;
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
  /** HEL-366: optional free-form grouping tag — for a source-companion DataType, mirrors its
   *  owning DataSource's tag; for a pipeline-output DataType, mirrors its producing Pipeline's
   *  tag. Omitted on the wire when null (spray-json drops `Option = None`) — read as
   *  `tag ?? null`. */
  tag?: string | null;
}

/** One column of an Output/node's shape, as reported by `get_output_capabilities`
 *  (HEL-907 task 3.7 -- replaces the retired `get_panel_capabilities`, which called a route
 *  HEL-904 deleted). */
export interface PanelCapabilityColumnResponse {
  name: string;
  dataType: string;
  nullable: boolean;
}

/** Capability report for one bindable Output kind (HEL-365, retargeted HEL-906 task 3.4).
 *  `eligibleColumns` is advisory (slot key -> column names that fit that slot's column-type
 *  rule), not a bind-time guarantee — the backend does not validate `fieldMapping` column fit
 *  today. `reason`/`message` are omitted on the wire (spray-json drops `Option = None`) unless
 *  `bindable` is `false`. */
export interface PanelCapabilityResponse {
  bindable: boolean;
  requiredSlots: string[];
  optionalSlots: string[];
  eligibleColumns: Record<string, string[]>;
  reason?: string;
  message?: string;
}

/** `GET /api/pipelines/:id/capabilities?stepId=` (HEL-906 task 3.4) -- the node-scoped
 *  successor to the retired `GET /api/types/:id/panel-capabilities`. `stepId` absent means the
 *  pipeline's raw source. */
export interface NodeCapabilitiesResponse {
  stepId?: string;
  columns: PanelCapabilityColumnResponse[];
  capabilities: Record<string, PanelCapabilityResponse>;
}

// ── Outputs (HEL-906/HEL-907) ────────────────────────────────────────────────

/** One column of an Output's persisted, derived schema (`{name, type}` shallow-union over its
 *  materialized rows) -- distinct from `PanelCapabilityColumnResponse` (per-node PROJECTED
 *  schema, `nullable` included, used by `get_output_capabilities`); this one is the Output's own
 *  stored `schema` field. */
export interface OutputSchemaFieldResponse {
  name: string;
  type: string;
}

/** `GET/POST /api/pipelines/:id/outputs`, `GET/PATCH/DELETE /api/outputs/:id`, `GET /api/outputs`
 *  (HEL-906). `config`/`schema` are typed by `kind` -- passed through verbatim, never
 *  reinterpreted here (same convention as panel `config`). */
export interface OutputResponse {
  id: string;
  pipelineId: string;
  nodeStepId?: string;
  ownerId: string;
  name: string;
  kind: string;
  config: unknown;
  schema: OutputSchemaFieldResponse[];
  createdAt: string;
  updatedAt: string;
  /** HEL-913 task 9.9/R12: WHICH root a root-bound Output (`nodeStepId` absent) attaches to.
   *  `nodeStepId`/`rootId` are mutually exclusive at the DB row level (V98's
   *  `(node_step_id IS NULL) <> (root_id IS NULL)` CHECK) -- exactly one is ever present.
   *  Reading `nodeStepId` as "absent means THE root" without also carrying this field is
   *  precisely the null-means-root encoding R12/R15 ban; see
   *  `scripts/check-node-root-encoding.mjs` (Scala) and its TypeScript sibling. */
  rootId?: string;
}

export interface OutputsResponse {
  items: OutputResponse[];
}

export interface CreateOutputRequest {
  nodeStepId?: string;
  kind: string;
  name: string;
  config?: Record<string, unknown>;
  /** HEL-913 task 9.5: names WHICH root a root-bound (`nodeStepId` absent) Output attaches to --
   *  without it under multi-root, the backend auto-resolves the pipeline's lowest-positioned
   *  root, never a caller-named one. Mutually exclusive with `nodeStepId` (both -> 400,
   *  mirrors the backend's own R13-style rule); ignored when `nodeStepId` is present (a
   *  step-bound Output's root is implicit). Unnecessary on a genuinely single-root pipeline. */
  rootId?: string;
}

/** `name`/`config` absent means "leave unchanged" -- `config`, when present, is merged into the
 *  stored config one level deep for `legend`/`tooltip`/`seriesColors`/`axisLabels` (HEL-877)
 *  rather than replacing it wholesale. */
export interface UpdateOutputRequest {
  name?: string;
  config?: Record<string, unknown>;
}

export interface OutputPanelPlacementResponse {
  panelId: string;
  dashboardId: string;
}

export interface DeleteOutputResponse {
  removedPanelIds: string[];
}

/** `GET /api/outputs/:id/assertion-status` (HEL-576, retargeted HEL-906 task 2.5). `invalid` is
 *  true when the Output's own node has at least one persisted error-severity failed assertion on
 *  the pipeline's latest non-dry run. */
export interface AssertionStatusResponse {
  outputId: string;
  invalid: boolean;
  failedRuleCount: number;
}

/** One entry of `POST /api/pipelines/:id/preview?outputId=`'s response (HEL-906 cycle 10) --
 *  present for every previewed Output, one arm (single-Output vs all-Outputs) selected by
 *  whether `outputId` was passed. `preview` reuses `RunResultResponse`'s shape verbatim. */
export interface OutputPreviewEntry {
  outputId: string;
  preview: RunResultResponse;
}

export interface PipelinePreviewResponse {
  outputs: OutputPreviewEntry[];
}

/** One root of a pipeline (HEL-913 R2/R8) — mirrors the backend's
 *  `PipelineProtocol.scala` `PipelineRootSummaryResponse` exactly (three fields,
 *  `jsonFormat3`), position-ordered in `PipelineSummaryResponse.roots`. */
export interface PipelineRootSummaryResponse {
  id: string;
  dataSourceId: string;
  dataSourceName: string;
}

/** `GET /api/pipelines` / `GET /api/pipelines/:id` — summary (no steps). Mirrors the backend's
 *  `PipelineProtocol.scala` `PipelineSummaryResponse` exactly (eight fields, `jsonFormat8`) --
 *  HEL-907 evaluator-final round-2 CR1: `outputDataTypeName`/`outputDataTypeId` REMOVED, since
 *  they haven't existed on this wire shape since HEL-904 (the field was silently `undefined`,
 *  dropped by `JSON.stringify`, never actually reaching an agent). If a caller needs the
 *  pipeline's produced Output id(s), list them via `list_outputs(pipelineId)`.
 *
 *  HEL-913 tasks 7.2a/9.1: the scalar `sourceDataSourceId`/`sourceDataSourceName` pair (the
 *  Stage-1 "lowest-positioned root" convenience fields) is REMOVED outright, replaced by
 *  `roots: PipelineRootSummaryResponse[]` -- a single-root pipeline still has exactly one
 *  entry; a caller that only ever cared about "the" source reads `roots[0]`, which states the
 *  single-root assumption explicitly rather than inheriting it from a field name (design.md
 *  R3: no reader may silently privilege position 0). */
export interface PipelineSummaryResponse {
  id: string;
  name: string;
  roots: PipelineRootSummaryResponse[];
  lastRunStatus: string | null;
  lastRunAt: string | null;
  lastRunRowCount: number | null;
  ownerId?: string | null;
  /** HEL-366: optional free-form grouping tag, set only at create time. Omitted on the wire
   *  when null (spray-json drops `Option = None`) — read as `tag ?? null`. */
  tag?: string | null;
}

/** `POST /api/pipelines`'s `roots[]` element AND `POST /api/pipelines/:id/roots`
 *  (`add_root`)'s request body -- the SAME shape for both (HEL-913 design.md R6, "one shape,
 *  not two"). Mirrors the backend's `CreatePipelineRootRequest` exactly. Exactly one of
 *  `sourceId`/`type` must be given; `csv` is deliberately NOT a supported inline `type` (no
 *  bytes channel exists in a JSON body for the upload path -- create the CSV source first via
 *  `create_csv_data_source` and pass its id via `sourceId`). */
export interface CreatePipelineRootRequest {
  /** Existing-source branch -- id of a caller-owned DataSource to reuse as-is. */
  sourceId?: string;
  /** Inline-source branch -- the new source's kind. */
  type?: "rest_api" | "sql" | "static";
  /** Inline-source branch -- the new source's display name. */
  name?: string;
  sqlConfig?: {
    dialect: string;
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    query: string;
  };
  restConfig?: {
    connectorId?: string;
    url?: string;
    endpoint?: string;
    method?: string;
    queryParams?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
    bodyContentType?: string;
    rootSelector?: string;
    parameters?: Record<string, string>;
  };
  staticConfig?: {
    columns: { name: string; type: string }[];
    rows: unknown[][];
  };
  /** Request-scoped id (never persisted) letting a `steps[]`/`outputs[]` entry in the SAME
   *  `POST /api/pipelines` call name this root via `rootClientId` -- unused by `add_root`. */
  clientId?: string;
}

/** `DELETE /api/pipelines/:id/roots/:rootId` (`remove_root`) response -- mirrors the backend's
 *  `RemovePipelineRootResponse` exactly. Both counts are computed BEFORE the delete, so they
 *  are never undercounted by a DB-level cascade. */
export interface RemovePipelineRootResponse {
  removedStepCount: number;
  removedOutputCount: number;
}

/** `GET`/`PUT /api/pipelines/:id/schedule` (HEL-415) — mirrors the backend's
 *  `PipelineScheduleResponse` (`jsonFormat10`) exactly: `nextRunAt`/
 *  `lastRunAt` are the only optional fields (spray-json drops `Option =
 *  None`); every other field, including `timezone`, is always present. */
export interface PipelineScheduleResponse {
  id: string;
  pipelineId: string;
  kind: string;
  expression: string;
  enabled: boolean;
  timezone: string;
  nextRunAt?: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** `PUT /api/pipelines/:id/schedule` body — mirrors the backend's
 *  `PutPipelineScheduleRequest(kind, expression, enabled: Option[Boolean],
 *  timezone)` (`jsonFormat4`). `timezone` is REQUIRED server-side; only
 *  `enabled` is optional (absent normalises to `true` server-side — see
 *  `buildSetPipelineScheduleBody` in `tools/scheduleTools.ts`). */
export interface PutPipelineScheduleRequest {
  kind: string;
  expression: string;
  timezone: string;
  enabled?: boolean;
}

/** One step from `GET /api/pipelines/:id/steps`. `config` shape is keyed by
 *  `type` (rename/filter/join/…); passed through untouched. */
export interface PipelineStepResponse {
  id: string;
  type: string;
  position: number;
  config: unknown;
}

/** One failing assertion rule's detail (HEL-576/HEL-581) — mirrors the
 *  backend's `AssertionFailureDetail`. `field`/`message` are Scala `Option`s
 *  and OMITTED on the wire when `None` (spray-json drops `Option = None`),
 *  so each is `?:` here. */
export interface AssertionFailureDetailResponse {
  kind: string;
  field?: string;
  severity: string;
  message?: string;
}

/** Per-run pass/fail-by-severity assertion summary (HEL-576/HEL-581) —
 *  mirrors the backend's `AssertionSummary`. Every field is REQUIRED on the
 *  wire (backed by a Scala default value, not an `Option`) — zero-valued
 *  (`passed: 0, warnFailed: 0, errorFailed: 0, failures: []`) for a run with
 *  no `assert` steps, never omitted. */
export interface AssertionSummaryResponse {
  passed: number;
  warnFailed: number;
  errorFailed: number;
  failures: AssertionFailureDetailResponse[];
}

/** `GET /api/pipelines/:id/run-history` entry (HEL-581) — mirrors the
 *  backend's `PipelineRunRecord`, sorted most-recent-first (`startedAt
 *  DESC`). `completedAt`/`rowCount`/`errorLog`/`triggeredByTokenId` are
 *  Scala `Option`s and OMITTED on the wire when `None`, so each is `?:`
 *  here; `assertions` is non-optional (backed by a default value, not an
 *  `Option`) and always present. */
export interface PipelineRunRecordResponse {
  id: string;
  pipelineId: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  rowCount?: number;
  errorLog?: string;
  triggerSource: string;
  triggeredByTokenId?: string;
  assertions: AssertionSummaryResponse;
}

/** `PATCH /api/pipeline-steps/:id` request body — mirrors the backend's
 *  `UpdatePipelineStepRequest`, MINUS its `type` field (design.md D2):
 *  `PipelineService.updateStep` always 400s on a `type` that differs from the
 *  step's existing kind ("delete and create a new one instead") and no-ops on
 *  a matching one, so there is no successful, meaningful MCP-layer use of it.
 *  `config`/`position` are each independently optional — an omitted field
 *  leaves it unchanged server-side; `config`, when provided, is decoded
 *  against the step's EXISTING kind. This interface is the already-parsed
 *  shape the tool builds a JSON body from; see `updateSchemas.ts`'s
 *  `buildUpdatePipelineStepBody`. */
export interface UpdatePipelineStepRequest {
  config?: Record<string, unknown>;
  position?: number;
}

export interface SchemaField {
  name: string;
  type: string;
}

/** `PipelineAnalyzeResponse.sourceSchemaDrift` (HEL-462) — absent when there is no baseline yet
 *  (the pipeline has never run successfully) or the current source schema matches the baseline
 *  exactly. Mirrors `PipelineAnalyzeProtocol.scala`'s `SourceSchemaDriftResponse`/
 *  `TypeChangedColumnResponse`. */
export interface TypeChangedColumnResponse {
  name: string;
  previousType: string;
  currentType: string;
}
export interface SourceSchemaDriftResponse {
  addedColumns: SchemaField[];
  removedColumns: SchemaField[];
  typeChangedColumns: TypeChangedColumnResponse[];
}

/** One pipeline root's own source schema, keyed by root id. Mirrors the backend's
 *  `RootSourceSchemaResponse` (HEL-913 task 7.2c). */
export interface RootSourceSchemaResponse {
  rootId: string;
  sourceDataSourceName: string;
  sourceSchema: SchemaField[];
}

/** `GET /api/pipelines/:id/analyze` — steps with per-step input/output schema. Mirrors the
 *  backend's `PipelineAnalyzeProtocol.scala` `PipelineAnalyzeResponse` (HEL-907 evaluator-final
 *  round-2 CR5: `outputDataTypeName`/`outputDataTypeId` REMOVED -- neither exists on that case
 *  class; `analyze_pipeline` passes the server JSON through verbatim, so this interface was
 *  purely a stale, unused type-level claim, never an agent-visible defect on its own).
 *  evaluator-final round-3 non-blocking note: `sourceSchemaDrift` was missing entirely -- the
 *  inverse defect (under- rather than over-specification) -- added here for symmetry with the
 *  real 6-field case class (`jsonFormat6`), omitted on the wire when `None` (spray-json drops
 *  `Option = None`), so read as optional here too.
 *  HEL-913 task 7.2c: the retired scalar `sourceDataSourceName`/`sourceSchema` pair is REPLACED
 *  outright by `sourceSchemas` (one entry per root, keyed by root id) -- the `pipeline-analyze-api`
 *  spec delta's own SHALL, unmet until this task (5.9 root-keyed the internal grounding only). */
export interface PipelineAnalyzeResponse {
  id: string;
  name: string;
  sourceSchemas: RootSourceSchemaResponse[];
  steps: Array<{
    id: string;
    position: number;
    type: string;
    config: unknown;
    inputSchema: SchemaField[];
    outputSchema: SchemaField[];
    validationError: string | null;
  }>;
  sourceSchemaDrift?: SourceSchemaDriftResponse;
}

/** `PATCH /api/panels/:id` request body — mirrors the backend's
 *  `UpdatePanelRequest` (`PanelProtocol.scala`). `title`/`type`/`config`/
 *  `appearance` are each independently optional: an omitted field leaves it
 *  unchanged server-side (`PanelServiceHelpers.resolvePatch`). `title`, when
 *  supplied, is trimmed and rejected (400) if blank. `type`, when supplied,
 *  must match the panel's stored `kind` — a mismatch is rejected (400, a
 *  panel's kind is immutable); a match is a harmless no-op. `appearance` is a
 *  genuine per-field partial merge (HEL-362) — absent keeps the stored value,
 *  explicit `null` clears it. `config`, when provided, is decoded server-side
 *  against the panel's EXISTING stored `type` (`PanelConfigCodec.
 *  applyConfigPatch`) as the SAME per-field partial-merge convention as
 *  `appearance` — NOT a wholesale replace like `UpdateDataTypeRequest`'s
 *  `fields`/`computedFields`. This interface is the already-parsed shape the
 *  tool builds a JSON body from; see `updateSchemas.ts`'s
 *  `buildUpdatePanelBody`. */
export interface UpdatePanelRequest {
  title?: string;
  type?: string;
  config?: Record<string, unknown>;
  appearance?: Record<string, unknown>;
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

/** `POST /api/pipelines/:id/run` — synchronous run result (rows already written).
 *
 *  HEL-861: `sourceTruncated`/`sourceAvailableRowCount`/`truncationNotice` surface the backend's
 *  1000-row run cap honestly — `sourceTruncated: true` means the run computed everything
 *  (including any filter/sort/aggregate) over only a partial read of the source, and
 *  `truncationNotice` is the server-composed sentence explaining exactly that, verbatim. */
export interface RunResultResponse {
  rows: Record<string, unknown>[];
  rowCount: number;
  stepRowCounts?: Record<string, number>;
  sourceRowCount?: number;
  sourceTruncated?: boolean;
  sourceAvailableRowCount?: number;
  truncationNotice?: string;
}

/** Per-panel grid placement in a proposal (optional). */
export interface ProposalPanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One proposed panel. No ids — an `output`-kind panel's `outputId`
 *  (kept under that name for wire stability, HEL-907) is really an Output
 *  id. Matches dashboard-proposal.schema.json.
 *
 *  HEL-904 retired the metric/chart/table/collection/timeline panel kinds
 *  outright — `type` is one of text/markdown/image/output/divider now.
 *  `aggregation`/`chartType`/`xAxisLabel`/`yAxisLabel`/
 *  `seriesColors`/`label`/`unit`/`sort` are LEGACY fields kept on the wire
 *  shape for schema stability only (`dashboard-proposal.schema.json`'s own
 *  field descriptions: "decoded but never applied") — none of them do
 *  anything anymore; the concepts they used to carry (fieldMapping,
 *  aggregation, per-kind viz options) now live on the Output itself, not on
 *  the placement. `fieldMapping` is likewise not meaningful for an
 *  `output`-kind panel (an Output's own `schema` is already the grounding
 *  source) or for text/markdown (which carry no data binding of any kind).
 *
 *  `config` (HEL-316) is a generic passthrough merged over the config
 *  derived from the flat fields above, then decoded by the same
 *  panel-create path place_outputs/create_content_panel uses. An
 *  `output`-kind panel's flat `outputId` always stays authoritative over
 *  `config`; a text/markdown panel's `config.outputId` is silently
 *  inert, NOT a real binding attempt (the data-bound "Source mode" those
 *  kinds used to support was removed outright by HEL-904 task 4.1). */
export interface MetricAggregationSpec {
  value: string;
  agg: "count" | "sum" | "avg" | "min" | "max";
}

/** Legacy, decoded-but-never-applied wire shape (see `ProposalPanel`'s own
 *  doc) — kept for schema stability only; the chart panel kind it targeted
 *  was retired by HEL-904. */
export interface ChartAggregationSpec {
  groupBy: string;
  agg: "count" | "sum" | "avg" | "min" | "max";
  yField: string;
}

export interface ProposalPanel {
  title: string;
  type: string;
  outputId?: string;
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
  /** Timeline event ordering (HEL-321) — derived into config.timelineOptions.sort. */
  sort?: "asc" | "desc";
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

/** `POST /api/sources` response (REST/SQL create) — mirrors the backend's
 *  `CreateSourceResponse` (`DataSourceProtocol.scala`). HEL-907 evaluator-final-1: this
 *  interface used to declare a `dataType` field the backend has not sent since HEL-904 (the
 *  real field is `inferredSchema: Option[InferredSchemaResponse]`, a SIBLING of `source`, not
 *  nested inside it) -- every create silently reported `dataType: null`, which callers could
 *  misread as "the initial fetch failed" when it was actually just a dead field that was
 *  ALWAYS null. On the wire, `inferredSchema`/`fetchError`/`rowCapNotice` are Scala `Option`s
 *  and are OMITTED entirely when `None` (spray-json drops `None` fields); the `helioApi.ts`
 *  wrappers normalize a missing field to `null` before returning this shape, so callers can
 *  always rely on each field being present (never `undefined`). */
export interface CreateSourceResult {
  source: DataSourceResponse;
  inferredSchema: InferredSchemaResponse | null;
  fetchError: string | null;
  /** HEL-861 design D6: a forward-looking advisory, populated when the connector's inference
   *  measured a true row total exceeding the run-time row cap -- that a future run over this
   *  source will be truncated. Not a report that creation itself applied a cap. `null` when the
   *  total is unknown (SQL) or under the cap. */
  rowCapNotice: string | null;
}

/** `GET /api/connector-types` (HEL-484) — one required config field descriptor.
 *  Name/label/secret-flag only, never a value. Mirrors the backend's
 *  `ConnectorFieldDescriptorResponse` (`ConnectorProtocol.scala`). */
export interface ConnectorFieldDescriptorResponse {
  name: string;
  label: string;
  secret: boolean;
}

/** `GET /api/connector-types` — one connector kind's capability metadata. Mirrors
 *  the backend's `ConnectorMetadataResponse`. All fields are required on the
 *  wire (no `Option`), so no missing-key normalization is needed here. */
export interface ConnectorMetadataResponse {
  kind: string;
  displayName: string;
  supportsIncremental: boolean;
  authKind: string;
  requiredFields: ConnectorFieldDescriptorResponse[];
}

/** HEL-828 design.md Decision 6: `GET /api/connectors` (real Connector INSTANCES, distinct
 *  from `ConnectorMetadataResponse`'s connector-KIND metadata above) — a dedicated,
 *  explicitly allow-listed projection mirroring the backend's `ConnectorSummary`
 *  (`ConnectorEntityProtocol.scala`). Exactly `id`/`name`/`kind`/`host` — no `config`/
 *  `defaultHeaders`/`authType` field on this type at all, so there is nothing for a
 *  serialization bug to leak even if the backend response shape ever changed. Never the
 *  credential in any form. */
export interface ConnectorSummary {
  id: string;
  name: string;
  kind: string;
  host: string;
}

/** HEL-886 design.md Decision 1: `POST /api/connectors`' response, mapped into the same
 *  allow-listed shape as `ConnectorSummary` -- id/name/kind/host ONLY, never `config` or a
 *  credential field in any form. Distinct type (not a reuse of `ConnectorSummary`) so a
 *  future divergence between "list" and "create" projections doesn't have to fight a shared
 *  name. */
export interface CreateConnectorResult {
  id: string;
  name: string;
  kind: string;
  host: string;
}

// ── Pipeline shape catalog (HEL-391/402) — mirrors
// `backend/.../api/protocols/PipelineShapeProtocol.scala` ──────────────────

/** Descriptive metadata for one `expand` param — never a validating JSON
 *  Schema; real validation happens server-side inside `expand`. Mirrors the
 *  backend's `ShapeParamDescriptor` (reused directly on the wire there). */
export interface ShapeParamDescriptorResponse {
  name: string;
  label: string;
  dataType: string;
  required: boolean;
  description: string;
}

/** Discriminated union mirroring the backend's `RowCountContract` wire format
 *  (`PipelineShapeProtocol.rowCountContractFormat`): `{"kind":"exactly-one"}`,
 *  `{"kind":"at-most-param","paramName":"..."}`, `{"kind":"unbounded"}`. */
export type RowCountContractResponse =
  | { kind: "exactly-one" }
  | { kind: "at-most-param"; paramName: string }
  | { kind: "unbounded" };

/** A shape's guaranteed output shape. There is no statically-declared field
 *  list (`OutputFieldContractResponse`/`fields` was removed as YAGNI in
 *  HEL-623 — zero producers, zero consumers). Mirrors the backend's
 *  `OutputContractResponse`. */
export interface OutputContractResponse {
  rowCount: RowCountContractResponse;
  description: string;
}

/** One `GET /api/pipeline-shapes` catalog entry. Mirrors the backend's
 *  `PipelineShapeCatalogEntryResponse`. */
export interface PipelineShapeCatalogEntryResponse {
  id: string;
  label: string;
  description: string;
  paramsSchema: ShapeParamDescriptorResponse[];
  outputContract: OutputContractResponse;
}

// ── Workspace tag-teardown (HEL-366) — mirrors
// `backend/.../api/protocols/WorkspaceProtocol.scala` ───────────────────────

/** One blocking conflict from `POST /api/workspace/teardown` — the tagged
 *  resource that would be (or was) blocked, and why. Mirrors the backend's
 *  `TeardownConflictResponse`. */
export interface TeardownConflictResponse {
  resourceKind: string;
  resourceId: string;
  resourceName: string;
  reason: string;
}

/** `POST /api/workspace/teardown` response. `dryRun`/`committed`/`blocked`
 *  are always present (not `Option` on the wire); counts mean "would be /
 *  were affected" for both a dry run and a real call. Mirrors the backend's
 *  `TeardownResponse`. */
export interface TeardownResponse {
  tag: string;
  dryRun: boolean;
  committed: boolean;
  blocked: boolean;
  conflicts: TeardownConflictResponse[];
  sourcesDeleted: number;
  pipelinesDeleted: number;
  /** HEL-907 evaluator-1 CR3: dashboards now participate in tag-scoped
   *  teardown too. Replaces the stale `typesDeleted` field this interface
   *  used to claim -- the backend's `TeardownResponse` (`WorkspaceProtocol
   *  .scala`) has carried no such field since HEL-904 task 3.2 removed the
   *  `data_type` teardown branch outright; this TS mirror had drifted and
   *  was claiming a field the wire never sends (found via the CR1 grep
   *  sweep, not the original report). */
  dashboardsDeleted: number;
}

/** One entry in `POST /api/pipeline-shapes/:id/expand`'s response array —
 *  a `{kind, config}` step create-payload, 1:1 with `add_pipeline_step`'s
 *  `{type, config}` shape (`kind` here, matching the domain field name
 *  directly). Mirrors the backend's `ShapeStepExpansionResponse`. */
export interface ShapeStepExpansionResponse {
  kind: string;
  config: Record<string, unknown>;
}

/** `POST /api/pipeline-shapes/:id/expand`'s real wire envelope (HEL-934) --
 *  NOT a bare `ShapeStepExpansionResponse[]` (the pre-HEL-934 shape this
 *  file's own `expandPipelineShape` return type used to claim, a live bug:
 *  every real response is this envelope, so any caller that iterated the
 *  response directly as an array would throw at runtime the first time a
 *  shape expanded to any steps -- see HEL-907 task 3.12). `outputs` is
 *  always absent/`null` today (no shape's `expand` populates it yet) but
 *  the envelope itself is not, so this type carries it as optional for
 *  forward compatibility rather than silently dropping it. */
export interface ExpandPipelineShapeResponse {
  steps: ShapeStepExpansionResponse[];
  outputs?: unknown[];
}

// HEL-907 task 3.9: the Metric (semantic layer) CRUD types (`MetricFormat`/`MetricResponse`/`CreateMetricRequest`/`UpdateMetricRequest`)
// are REMOVED outright, along with `MetricRoutes` on the backend (deleted by HEL-904 -- `POST/PATCH/DELETE /api/metrics`
// have had no route to call since) and the retired `create_metric`/`update_metric`/`delete_metric`/`list_metrics`/`get_metric` tools.

// ── Pipeline proposal (HEL-379/381/383/385) — mirrors
// `backend/.../api/protocols/PipelineProposalProtocol.scala` /
// `PipelineAnalyzeProposalProtocol.scala` ────────────────────────────────────

/** `source` on the wire (design.md D1): EXACTLY one `config` key, selected by
 *  `type` — NOT the Scala-internal `csvConfig`/`restConfig`/`sqlConfig`/
 *  `staticConfig` four-`Option`-field shape (that split is collapsed to/from
 *  this single key by the backend's hand-written `RootJsonFormat` and has no
 *  wire presence). Either `sourceId` (existing-source branch) or `type`/
 *  `name`/`config` (inline branch) is supplied — the schema does not enforce
 *  mutual exclusivity; `propose_pipeline`'s warnings (D4) flag both-set or
 *  neither-set client-side before an apply-time 400. */
export interface PipelineProposalSource {
  sourceId?: string;
  type?: "csv" | "rest_api" | "sql" | "static";
  name?: string;
  config?: Record<string, unknown>;
}

/** One step of a pipeline proposal (HEL-907 task 1.1/3.10) — mirrors the
 *  backend's `CreatePipelineTransactionalStepRequest` (P1.3/HEL-906's
 *  single-call transactional shape) verbatim. `clientId` is request-scoped
 *  only, never persisted — it lets a LATER step's `parentStepId`, or an
 *  output's `nodeStepClientId`, target this step within the same proposal. */
export interface PipelineProposalStep {
  clientId: string;
  type: string;
  config: unknown;
  parentStepId?: string | null;
  enabled?: boolean | null;
  /** HEL-913 task 9.1/R13: names WHICH `roots[]` element (by its own `clientId`) a PARENTLESS
   *  step's trunk extends -- mutually exclusive with `parentStepId` (both -> 400); unnecessary
   *  with exactly one root. Mirrors the backend's `CreatePipelineTransactionalStepRequest
   *  .rootClientId` exactly. `propose_pipeline`/`apply_pipeline_proposal` stay single-root by
   *  design (this field is simply never needed there, not forbidden). */
  rootClientId?: string | null;
}

/** One Output of a pipeline proposal (HEL-907 task 1.1/3.10) — mirrors the
 *  backend's `CreatePipelineTransactionalOutputRequest` verbatim.
 *  `nodeStepClientId` resolves against `steps[].clientId` in the same
 *  proposal; absent means a root-bound Output. */
export interface PipelineProposalOutput {
  nodeStepClientId?: string | null;
  kind: "table" | "metric" | "chart" | "collection" | "timeline" | "markdown";
  name: string;
  config?: unknown;
  /** HEL-913 task 9.1/R13: names WHICH `roots[]` element (by its own `clientId`) a root-bound
   *  Output (`nodeStepClientId` absent) attaches to -- mutually exclusive with
   *  `nodeStepClientId`; unnecessary with exactly one root. Mirrors the backend's
   *  `CreatePipelineTransactionalOutputRequest.rootClientId` exactly. */
  rootClientId?: string | null;
}

/** A pipeline proposal — the shared Proposal → Review → Apply artifact for
 *  pipelines (mirrors `DashboardProposal`). Carries no ids: nothing is
 *  created until applied via `apply_pipeline_proposal`. `outputs` is
 *  OPTIONAL — a proposal may create a pipeline with zero Outputs, to be
 *  added later via `add_output`. HEL-907 task 1.1: retargeted from the old
 *  single `outputDataTypeName` DataType contract onto Outputs. */
export interface PipelineProposal {
  pipelineName: string;
  source: PipelineProposalSource;
  steps: PipelineProposalStep[];
  outputs?: PipelineProposalOutput[];
}

/** `POST /api/pipelines/analyze-proposal` response (HEL-381) — the projected
 *  source/step schema for a not-yet-created proposal, dry (no writes, no ids
 *  minted). `steps` reuses `PipelineAnalyzeResponse["steps"]`'s exact inline
 *  per-step shape verbatim (design.md D5) — both are produced by the same
 *  backend `analyzeStepResponseFormat`, so no second, divergent type.
 *  HEL-907 task 1.1: `outputDataTypeName` dropped outright (no alias) — it
 *  was a pure echo of `PipelineProposal`'s now-removed same-named field. */
export interface PipelineAnalyzeProposalResponse {
  sourceName: string;
  sourceSchema: SchemaField[];
  steps: PipelineAnalyzeResponse["steps"];
}

/** One applied Output, reported back by `apply_pipeline_proposal` (HEL-907
 *  task 1.1) — mirrors the backend's `ProposalOutputSummary`. */
export interface ProposalOutputSummary {
  id: string;
  name: string;
  kind: string;
  nodeStepId?: string | null;
}

/** `POST /api/pipelines/apply-proposal` response (HEL-383, retargeted
 *  HEL-907 task 1.1) — every id created by the atomic apply, plus the
 *  synchronous run result. `source` is present only for the inline-source
 *  branch (mirrors the backend's `Option`, omitted on the wire when absent —
 *  read as `source ?? undefined`, i.e. simply check truthiness); the
 *  existing-sourceId branch has nothing new to report and omits it.
 *  `outputs` replaces the old single `outputDataTypeId: string` — a
 *  proposal can create zero, one, or many Outputs now. */
export interface PipelineProposalApplyResponse {
  source?: DataSourceResponse;
  pipeline: PipelineSummaryResponse;
  outputs: ProposalOutputSummary[];
  run: RunResultResponse;
}

// ── Combined (pipeline + dashboard) proposal (HEL-387) — mirrors
// `backend/.../api/protocols/CombinedProposalProtocol.scala` ────────────────

/** A combined proposal — the shared Proposal → Review → Apply artifact for
 *  `POST /api/proposals/apply`. `dashboard`'s panels may bind to `pipeline`'s
 *  not-yet-created output DataType via the reserved `"$pipelineOutput"`
 *  sentinel in the panel's `outputId` (or, for a non-data panel,
 *  `config.outputId`) — the exact same slot `DashboardProposal` already
 *  uses for a real DataType id. Reuses `PipelineProposal`/`DashboardProposal`
 *  verbatim (design.md D1) — no new panel-level shape. */
export interface CombinedProposal {
  pipeline: PipelineProposal;
  dashboard: DashboardProposal;
}

/** `POST /api/proposals/apply` response (HEL-387) — nests each sub-service's
 *  own existing response shape verbatim (design.md D5), not a new flat
 *  shape: `pipeline` matches `PipelineProposalApplyResponse` exactly;
 *  `dashboard` matches `apply_proposal`'s own `{ dashboard, panels }`
 *  response exactly. */
export interface CombinedProposalApplyResponse {
  pipeline: PipelineProposalApplyResponse;
  dashboard: { dashboard: DashboardResponse; panels: PanelResponse[] };
}

// ── Patch set (HEL-403/406/408, consumed here by HEL-411's refinement tools)
// — mirrors `backend/.../api/protocols/PatchSetProtocol.scala` /
// `schemas/patch-sets/patch-set.schema.json` ───────────────────────────────────────────

/** Identifies the resource an `Edit` applies to. `id` is required for
 *  update/delete, absent for create (the resource does not yet exist). */
export interface EditTarget {
  kind: "panel" | "dashboard" | "dataSource" | "dataType" | "pipeline" | "pipelineStep";
  id?: string;
}

/** One targeted edit. `patch`'s real shape reuses the existing per-resource
 *  PATCH/create request shape matching `target.kind` (the same type the
 *  matching PATCH/create endpoint already decodes) — never a new shape
 *  invented for the patch-set wire format. Absent for `op: "delete"`. */
export interface Edit {
  target: EditTarget;
  op: "update" | "delete" | "create";
  patch?: Record<string, unknown>;
}

/** An ordered list of targeted edits — the shared Propose → Review → Apply
 *  artifact `propose_patch_set`/`apply_patch_set` (HEL-411) hand off between
 *  themselves, unmodified. */
export interface PatchSet {
  summary?: string;
  edits: Edit[];
}

/** One edit's outcome from `POST /api/patch-sets/apply`. */
export interface EditOutcome {
  index: number;
  status: "applied" | "rolledBack" | "recreated" | "unrecoverable";
  newId?: string | null;
  priorState?: Record<string, unknown> | null;
  resultingState?: Record<string, unknown> | null;
}

/** `POST /api/patch-sets/apply` response (HEL-406) — `failure` is present
 *  only when a mid-set edit failed and triggered a rollback. `applicationId`
 *  (HEL-413) is present exactly when `failure` is absent AND the
 *  application was successfully journaled — pass it to `undo_patch_set` to
 *  restore this apply's pre-apply state. */
export interface PatchSetApplyResponse {
  edits: EditOutcome[];
  failure?: string | null;
  applicationId?: string | null;
}

/** One edit's undo outcome from `POST /api/patch-sets/:id/undo` (HEL-413). */
export interface EditUndoOutcome {
  index: number;
  status: "restored" | "recreated" | "failed" | "notAttempted";
  newId?: string | null;
  resultingState?: Record<string, unknown> | null;
}

/** `POST /api/patch-sets/:id/undo` response (HEL-413) — restores every
 *  journaled edit in the named application to its pre-apply state, or none
 *  of them (a conflict or structurally-unrecoverable delete edit rejects
 *  the whole call before this type is ever returned). */
export interface PatchSetUndoResponse {
  edits: EditUndoOutcome[];
}

/** `POST /api/refinements` response (HEL-411) — mirrors the backend's
 *  `RefinementResponse`. `patchSet` is already proven valid
 *  (`PatchSetPreviewService.preview`) and unapplied; `conversationId` is
 *  passed back to continue refining the same target across turns. */
export interface RefinementResult {
  patchSet: PatchSet;
  conversationId: string;
}

// ── Agent preferences + memory (HEL-472/478/521, 420-A/B/C) — mirrors
// `backend/.../api/protocols/AgentPreferencesProtocol.scala` /
// `AgentMemoryProtocol.scala` ─────────────────────────────────────────────

/** `GET /api/preferences` response — mirrors the backend's
 *  `AgentPreferencesResponse`. Every field except `extras` is `Option` on the
 *  Scala side and OMITTED on the wire when unset (spray-json drops
 *  `Option = None`), so each is `?:` here; `extras` is always present, an
 *  empty object `{}` when nothing has been stored there. */
export interface AgentPreferencesResponse {
  defaultSeriesColors?: string[];
  defaultPanelStyle?: Record<string, unknown>;
  namingConventions?: Record<string, unknown>;
  extras: Record<string, unknown>;
}

/** `GET`/`POST /api/agent/memory` entry — mirrors the backend's
 *  `AgentMemoryEntryResponse`. `lastUsedAt` is omitted on the wire (not
 *  `null`) for a never-used entry — spray-json drops `Option = None`. */
export interface AgentMemoryEntryResponse {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
  lastUsedAt?: string;
}
