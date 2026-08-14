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

/** `GET /api/types/:id/rows` — latest pipeline-run snapshot. */
export interface DataTypeRowsResponse {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/** `PATCH /api/types/:id` request body — mirrors the backend's
 *  `UpdateDataTypeRequest`. `name`/`fields`/`computedFields` are each
 *  independently optional: an omitted field leaves it unchanged server-side.
 *  When `fields` or `computedFields` IS provided, `DataTypeService.applyUpdate`
 *  replaces the existing array WHOLESALE (`request.X.map(...).getOrElse(existing.X)`
 *  — no per-item merge), unlike this file's other partial-PATCH shapes
 *  (`UpdateMetricRequest`, panel appearance). Item shape mirrors the backend's
 *  `DataFieldPayload`/`ComputedFieldPayload` exactly — structurally identical
 *  to `DataFieldResponse`/`ComputedFieldResponse`, reused here rather than
 *  duplicated. This interface is the already-parsed shape the tool builds a
 *  JSON body from; see `updateSchemas.ts`'s `buildUpdateDataTypeBody`. */
export interface UpdateDataTypeRequest {
  name?: string;
  fields?: DataFieldResponse[];
  computedFields?: ComputedFieldResponse[];
}

/** One column of a DataType's shape, as reported by `get_panel_capabilities`. */
export interface PanelCapabilityColumnResponse {
  name: string;
  dataType: string;
  nullable: boolean;
}

/** Capability report for one bindable panel kind (HEL-365). `eligibleColumns`
 *  is advisory (slot key -> column names that fit that slot's column-type
 *  rule), not a bind-time guarantee — the backend does not validate
 *  `fieldMapping` column fit today. `reason`/`message` are omitted on the
 *  wire (spray-json drops `Option = None`) unless `bindable` is `false`. */
export interface PanelCapabilityResponse {
  bindable: boolean;
  requiredSlots: string[];
  optionalSlots: string[];
  eligibleColumns: Record<string, string[]>;
  reason?: string;
  message?: string;
}

/** `GET /api/types/:id/panel-capabilities` — for an owner-scoped DataType,
 *  which of the five data-bindable panel kinds (metric/chart/table/
 *  collection/timeline) are structurally bindable, plus shape signals. */
export interface PanelCapabilitiesResponse {
  dataTypeId: string;
  isPipelineOutput: boolean;
  columns: PanelCapabilityColumnResponse[];
  rowCount: number;
  singleRow: boolean;
  capabilities: Record<string, PanelCapabilityResponse>;
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
  /** HEL-366: optional free-form grouping tag, set only at create time. Omitted on the wire
   *  when null (spray-json drops `Option = None`) — read as `tag ?? null`. */
  tag?: string | null;
}

/** One step from `GET /api/pipelines/:id/steps`. `config` shape is keyed by
 *  `type` (rename/filter/join/…); passed through untouched. */
export interface PipelineStepResponse {
  id: string;
  type: string;
  position: number;
  config: unknown;
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

/** `POST /api/panels/bound` (HEL-364) — every id created (or reused) by the
 *  compound source→pipeline→run→panel-bind call, plus the created,
 *  already-bound panel. Mirrors the backend's `BoundPanelResponse`. */
export interface BoundPanelResponse {
  sourceId: string;
  pipelineId: string;
  dataTypeId: string;
  panel: PanelResponse;
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
 *  `{density,columnOrder}`, timeline `{timelineOptions:{sort}}` (HEL-317),
 *  text/markdown `{dataTypeId,fieldMapping}` (HEL-244 binding). A
 *  metric/chart/table/collection/timeline panel's flat `dataTypeId` always
 *  stays authoritative over `config`; a text/markdown panel's
 *  `config.dataTypeId` is a real binding attempt and is validated against the
 *  same pipeline-only rule (V41) as any other binding — a source-companion or
 *  non-owned DataType is rejected. */
export interface ProposalPanel {
  title: string;
  type: string;
  dataTypeId?: string;
  /** HEL-549: additive to dataTypeId (which remains required) — binds a
   *  metric/chart/table panel to a defined metric via the same
   *  MetricPanelConfig/ChartPanelConfig/TablePanelConfig metricId slot
   *  create_panel uses. Unsupported on collection/timeline. */
  metricId?: string;
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

/** `GET /api/connectors` (HEL-484) — one required config field descriptor.
 *  Name/label/secret-flag only, never a value. Mirrors the backend's
 *  `ConnectorFieldDescriptorResponse` (`ConnectorProtocol.scala`). */
export interface ConnectorFieldDescriptorResponse {
  name: string;
  label: string;
  secret: boolean;
}

/** `GET /api/connectors` — one connector kind's capability metadata. Mirrors
 *  the backend's `ConnectorMetadataResponse`. All fields are required on the
 *  wire (no `Option`), so no missing-key normalization is needed here. */
export interface ConnectorMetadataResponse {
  kind: string;
  displayName: string;
  supportsIncremental: boolean;
  authKind: string;
  requiredFields: ConnectorFieldDescriptorResponse[];
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
  typesDeleted: number;
}

/** One entry in `POST /api/pipeline-shapes/:id/expand`'s response array —
 *  a `{kind, config}` step create-payload, 1:1 with `add_pipeline_step`'s
 *  `{type, config}` shape (`kind` here, matching the domain field name
 *  directly). Mirrors the backend's `ShapeStepExpansionResponse`. */
export interface ShapeStepExpansionResponse {
  kind: string;
  config: Record<string, unknown>;
}

// ── Metric (semantic layer) CRUD (HEL-493/HEL-541) — mirrors
// `backend/.../api/protocols/MetricProtocol.scala` ──────────────────────────

/** Display formatting hints for a metric's value — all optional, purely
 *  presentational. Mirrors the backend's `MetricFormat`; every field is a
 *  Scala `Option` and is OMITTED on the wire when `None` (spray-json drops
 *  `Option = None`), so each field here is `?:` per the existing `types.ts`
 *  convention. */
export interface MetricFormat {
  unit?: string;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}

/** `GET /api/metrics` / `GET /api/metrics/:id` / `POST /api/metrics` /
 *  `PATCH /api/metrics/:id` response — mirrors the backend's
 *  `MetricResponse`. A metric names a reusable measure (an `aggregation`
 *  applied to `measureField`) over a pipeline-output DataType (V41) — the
 *  semantic layer a panel should reference instead of re-deriving a measure
 *  inline. `description` is omitted on the wire when unset (spray-json drops
 *  `Option = None`). */
export interface MetricResponse {
  id: string;
  ownerId: string;
  dataTypeId: string;
  name: string;
  description?: string;
  measureField: string;
  aggregation: string;
  allowedDimensions: string[];
  format: MetricFormat;
  deprecated: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `POST /api/metrics` request body — mirrors the backend's
 *  `CreateMetricRequest`. `dataTypeId` must resolve to a caller-owned,
 *  pipeline-output DataType (V41); `format`, when omitted, defaults to an
 *  all-absent `MetricFormat` server-side. */
export interface CreateMetricRequest {
  dataTypeId: string;
  name: string;
  description?: string;
  measureField: string;
  aggregation: string;
  allowedDimensions: string[];
  format?: MetricFormat;
}

/** `PATCH /api/metrics/:id` request body — mirrors the backend's
 *  `UpdateMetricRequest`'s absent-vs-null convention (design.md Decision 2,
 *  same idiom as `MetricPanelConfig.Patch`/`Option[Option[X]]`): `name`/
 *  `measureField`/`aggregation`/`allowedDimensions`/`deprecated` are plain
 *  optional replace-if-present fields; `description`/`format` are
 *  nullable-optional — key ABSENT from the built JSON body means "leave
 *  unchanged", key present with value `null` means "clear". `dataTypeId` is
 *  intentionally not patchable (not in the ticket's field list). This
 *  interface itself is the already-parsed shape the tool builds a JSON body
 *  from; see `write.ts`'s body-builder for the absent-vs-null encoding. */
export interface UpdateMetricRequest {
  name?: string;
  description?: string | null;
  measureField?: string;
  aggregation?: string;
  allowedDimensions?: string[];
  format?: MetricFormat | null;
  deprecated?: boolean;
}

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

/** A pipeline proposal — the shared Proposal → Review → Apply artifact for
 *  pipelines (mirrors `DashboardProposal`). Carries no ids: nothing is
 *  created until applied via `apply_pipeline_proposal`. `steps` reuses the
 *  same `{type, config}` shape `add_pipeline_step`/`boundPipelineStepSchema`
 *  (`write.ts`) already use — no new step DTO. */
export interface PipelineProposal {
  pipelineName: string;
  source: PipelineProposalSource;
  outputDataTypeName: string;
  steps: Array<{ type: string; config: unknown }>;
}

/** `POST /api/pipelines/analyze-proposal` response (HEL-381) — the projected
 *  source/step schema for a not-yet-created proposal, dry (no writes, no ids
 *  minted). `steps` reuses `PipelineAnalyzeResponse["steps"]`'s exact inline
 *  per-step shape verbatim (design.md D5) — both are produced by the same
 *  backend `analyzeStepResponseFormat`, so no second, divergent type. */
export interface PipelineAnalyzeProposalResponse {
  sourceName: string;
  outputDataTypeName: string;
  sourceSchema: SchemaField[];
  steps: PipelineAnalyzeResponse["steps"];
}

/** `POST /api/pipelines/apply-proposal` response (HEL-383) — every id created
 *  by the atomic apply, plus the synchronous run result. `source` is present
 *  only for the inline-source branch (mirrors the backend's `Option`, omitted
 *  on the wire when absent — read as `source ?? undefined`, i.e. simply
 *  check truthiness); the existing-sourceId branch has nothing new to report
 *  and omits it. */
export interface PipelineProposalApplyResponse {
  source?: DataSourceResponse;
  pipeline: PipelineSummaryResponse;
  outputDataTypeId: string;
  run: RunResultResponse;
}

// ── Combined (pipeline + dashboard) proposal (HEL-387) — mirrors
// `backend/.../api/protocols/CombinedProposalProtocol.scala` ────────────────

/** A combined proposal — the shared Proposal → Review → Apply artifact for
 *  `POST /api/proposals/apply`. `dashboard`'s panels may bind to `pipeline`'s
 *  not-yet-created output DataType via the reserved `"$pipelineOutput"`
 *  sentinel in the panel's `dataTypeId` (or, for a non-data panel,
 *  `config.dataTypeId`) — the exact same slot `DashboardProposal` already
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
// `schemas/patch-set.schema.json` ───────────────────────────────────────────

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
 *  only when a mid-set edit failed and triggered a rollback. */
export interface PatchSetApplyResponse {
  edits: EditOutcome[];
  failure?: string | null;
}

/** `POST /api/refinements` response (HEL-411) — mirrors the backend's
 *  `RefinementResponse`. `patchSet` is already proven valid
 *  (`PatchSetPreviewService.preview`) and unapplied; `conversationId` is
 *  passed back to continue refining the same target across turns. */
export interface RefinementResult {
  patchSet: PatchSet;
  conversationId: string;
}
