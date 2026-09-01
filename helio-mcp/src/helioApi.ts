/**
 * Typed wrappers over the Helio REST endpoints the read tools + context
 * serializer need. One function per capability; each is a thin call to an
 * existing endpoint (no business logic — see helio-mcp/README.md "Design").
 *
 * A few capabilities the Phase-2 brief named as single endpoints do not exist
 * as such on `main`; those are COMPOSED here from the endpoints that do exist,
 * and the composition is documented at each call site:
 *   - `getDashboard`      — no `GET /api/dashboards/:id` and no
 *                           `/:id/panels`; compose the list record with the
 *                           `/:id/export` snapshot (which carries the panels).
 *   - `getPipeline`       — `GET /api/pipelines/:id` returns a summary with no
 *                           steps; compose it with `/:id/steps`.
 *   - `listSourceObjects` — no `GET /api/data-sources/:id/sources`; surface the
 *                           real per-source inspection endpoint (`/preview`),
 *                           selecting CSV vs REST/SQL preview by source type
 *                           exactly as the frontend's usePanelData does.
 */

import { HelioApiError, type HelioHttpClient } from "./httpClient.js";
import type {
  AgentMemoryEntryResponse,
  AgentPreferencesResponse,
  BoundPanelResponse,
  CombinedProposal,
  CombinedProposalApplyResponse,
  ConnectorMetadataResponse,
  ConnectorSummary,
  CreateMetricRequest,
  CreateSourceResult,
  CsvPreview,
  DashboardProposal,
  DashboardResponse,
  DashboardSnapshot,
  DataSourceResponse,
  DataTypeResponse,
  DataTypeRowsResponse,
  MetricResponse,
  Paged,
  PanelCapabilitiesResponse,
  PanelResponse,
  PatchSet,
  PatchSetApplyResponse,
  PatchSetUndoResponse,
  PipelineAnalyzeProposalResponse,
  PipelineAnalyzeResponse,
  PipelineProposal,
  PipelineProposalApplyResponse,
  PipelineRunRecordResponse,
  PipelineScheduleResponse,
  PipelineShapeCatalogEntryResponse,
  PipelineStepResponse,
  PipelineSummaryResponse,
  ProposalPanel,
  PutPipelineScheduleRequest,
  RefinementResult,
  RowsPreview,
  RunResultResponse,
  ShapeStepExpansionResponse,
  TeardownResponse,
  UpdateDataTypeRequest,
  UpdateMetricRequest,
  UpdatePanelRequest,
  UpdatePipelineStepRequest,
} from "./types.js";

/** Raw `POST /api/sources` wire shape, before the missing-Option → `null`
 *  normalization described on `CreateSourceResult`. Not exported — an
 *  implementation detail of `createRestDataSource`/`createSqlDataSource`. */
interface RawCreateSourceResponse {
  source: DataSourceResponse;
  dataType?: DataTypeResponse;
  fetchError?: string;
}

const CSV_LIKE_TYPES = new Set(["csv", "static"]);

/** Inline column spec for a static data source. */
export interface StaticColumn {
  name: string;
  type: string;
}

/** run_pipeline outcome. The run is synchronous on `main`: a 200 already means
 *  completion and rows are written to `outputDataTypeId` — nothing to poll. */
export interface RunOutcome {
  pipelineId: string;
  status: string;
  rowCount: number;
  sourceRowCount: number;
  outputDataTypeId: string;
  /** HEL-861: `true` when the run's source read (or a join/union/lookup secondary source read)
   *  was capped by the 1000-row run limit — ALWAYS `false`, never `undefined`, so a truncated run
   *  is never indistinguishable from a missing field. `guarded`/`jsonResult` stringify this object
   *  verbatim (no bespoke formatter), so this is exactly what an agent reads. */
  truncated: boolean;
  availableRowCount?: number;
  truncationNotice?: string;
}

/** Composed dashboard view: the list record plus its panels from the snapshot. */
export interface DashboardWithPanels extends DashboardResponse {
  panels: DashboardSnapshot["panels"];
}

/** Result of `upload_image`: the stored id, its served (Bearer-free) url, and
 *  the `helio://` markdown reference an agent drops into a markdown panel. */
export interface ImageUploadOutcome {
  id: string;
  url: string;
  markdownRef: string;
}

/** Complete default `ChartAppearance`, mirroring the backend's
 *  `ChartAppearance.Default` (`backend/.../domain/model.scala`) and the
 *  frontend's `DEFAULT_CHART_APPEARANCE`. The backend decodes `ChartAppearance`
 *  with spray-json `jsonFormat5` where only `chartType` is optional —
 *  `seriesColors`/`legend`/`tooltip`/`axisLabels` are REQUIRED. A bare
 *  `{ chartType }` therefore fails `entity(as[CreatePanelRequest])`
 *  deserialization (generic 400) before the service runs, so `createPanel`
 *  overlays the caller's partial chart fields onto this complete base (HEL-315
 *  design D2). */
const DEFAULT_CHART_APPEARANCE: Record<string, unknown> = {
  seriesColors: [
    "#5470c6",
    "#91cc75",
    "#fac858",
    "#ee6666",
    "#73c0de",
    "#3ba272",
    "#fc8452",
    "#9a60b4",
  ],
  legend: { show: true, position: "top" },
  tooltip: { enabled: true },
  axisLabels: {
    x: { show: true, label: "X Axis" },
    y: { show: true, label: "Y Axis" },
  },
  chartType: "line",
};

/** Overlay a caller's partial `chart` appearance onto the complete default so
 *  the payload always carries `ChartAppearance`'s required fields. Non-chart
 *  appearance keys (background/color/transparency) pass through untouched. */
function withCompleteChartAppearance(appearance: Record<string, unknown>): Record<string, unknown> {
  const chart = appearance.chart;
  if (chart && typeof chart === "object" && !Array.isArray(chart)) {
    return {
      ...appearance,
      chart: { ...DEFAULT_CHART_APPEARANCE, ...(chart as Record<string, unknown>) },
    };
  }
  return appearance;
}

/** Composed pipeline view: summary plus its ordered steps. */
export interface PipelineWithSteps extends PipelineSummaryResponse {
  steps: PipelineStepResponse[];
}

/** Result of `createPipelineFromShape` — mirrors `PipelineWithSteps`'s
 *  `{...summary, steps}` shape (design.md Planner Notes), the steps here being
 *  the ones actually created (each `add_pipeline_step`-equivalent call's own
 *  response), not the raw `expand` expansion payloads. */
export type PipelineFromShapeResult = PipelineWithSteps;

/** Source preview, tagged with which endpoint produced it. */
export interface SourceObjects {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  /** `"csv"` → headers+rows; `"rows"` → row objects. */
  previewKind: "csv" | "rows";
  preview: CsvPreview | RowsPreview;
}

export class HelioApi {
  constructor(private readonly http: HelioHttpClient) {}

  listDashboards(limit = 200, offset = 0): Promise<Paged<DashboardResponse>> {
    return this.http.get<Paged<DashboardResponse>>("/api/dashboards", { limit, offset });
  }

  /** Compose: list-find (id/name/appearance/layout/owner) + export (panels). */
  async getDashboard(dashboardId: string): Promise<DashboardWithPanels> {
    const page = await this.listDashboards();
    const record = page.items.find((d) => d.id === dashboardId);
    if (!record) {
      throw new HelioApiError(
        404,
        `/api/dashboards/${dashboardId}`,
        `No dashboard with id ${dashboardId} is visible to this token.`,
      );
    }
    const snapshot = await this.http.get<DashboardSnapshot>(
      `/api/dashboards/${dashboardId}/export`,
    );
    return { ...record, panels: snapshot.panels };
  }

  /** `tag` (HEL-366), when given, restricts results to the caller's resources whose `tag`
   *  exactly matches — an owner-scoped exact-match filter, not a search. */
  listDataSources(limit = 200, offset = 0, tag?: string): Promise<Paged<DataSourceResponse>> {
    return this.http.get<Paged<DataSourceResponse>>("/api/data-sources", { limit, offset, tag });
  }

  /** No `/data-sources/:id/sources` endpoint exists — surface the source's
   *  preview instead, choosing the CSV vs REST/SQL endpoint by source type. */
  async listSourceObjects(sourceId: string): Promise<SourceObjects> {
    const page = await this.listDataSources();
    const source = page.items.find((s) => s.id === sourceId);
    if (!source) {
      throw new HelioApiError(
        404,
        `/api/data-sources/${sourceId}`,
        `No data source with id ${sourceId} is visible to this token.`,
      );
    }
    if (CSV_LIKE_TYPES.has(source.type)) {
      const preview = await this.http.get<CsvPreview>(`/api/data-sources/${sourceId}/preview`);
      return {
        sourceId,
        sourceName: source.name,
        sourceType: source.type,
        previewKind: "csv",
        preview,
      };
    }
    const preview = await this.http.get<RowsPreview>(`/api/sources/${sourceId}/preview`);
    return {
      sourceId,
      sourceName: source.name,
      sourceType: source.type,
      previewKind: "rows",
      preview,
    };
  }

  /** `tag` (HEL-366), when given, restricts results to the caller's resources whose `tag`
   *  exactly matches — an owner-scoped exact-match filter, not a search. */
  listDataTypes(limit = 200, offset = 0, tag?: string): Promise<Paged<DataTypeResponse>> {
    return this.http.get<Paged<DataTypeResponse>>("/api/types", { limit, offset, tag });
  }

  /** `limit`/`excludeContentFields` (HEL-372): forwarded as `?limit=`/`?excludeContentFields=`
   *  query params when given — mirrors `GET /api/types/:id/rows`'s optional params 1:1
   *  (`DataTypeRoutes.scala`). Omitting both preserves the prior unbounded/full-content
   *  behavior for any existing caller. */
  getDataTypeRows(
    dataTypeId: string,
    limit?: number,
    excludeContentFields?: boolean,
    maxStructuredColumns?: number,
  ): Promise<DataTypeRowsResponse> {
    return this.http.get<DataTypeRowsResponse>(`/api/types/${dataTypeId}/rows`, {
      limit,
      excludeContentFields:
        excludeContentFields === undefined ? undefined : String(excludeContentFields),
      maxStructuredColumns,
    });
  }

  /** Get the panel-binding "menu" for a DataType (HEL-365): which of the five
   *  data-bindable panel kinds (metric/chart/table/collection/timeline) are
   *  structurally bindable, each one's required/optional fieldMapping slots
   *  and eligible columns per slot, and shape signals (columns+types, row
   *  count, single-row flag, pipeline-output vs. source-companion). Thin
   *  pass-through — no reshaping. */
  getPanelCapabilities(dataTypeId: string): Promise<PanelCapabilitiesResponse> {
    return this.http.get<PanelCapabilitiesResponse>(`/api/types/${dataTypeId}/panel-capabilities`);
  }

  /** `tag` (HEL-366), when given, restricts results to the caller's pipelines whose `tag`
   *  exactly matches — an owner-scoped exact-match filter, not a search. */
  listPipelines(tag?: string): Promise<PipelineSummaryResponse[]> {
    return this.http.get<PipelineSummaryResponse[]>("/api/pipelines", { tag });
  }

  /** Compose: summary (`/:id`) + ordered steps (`/:id/steps`). */
  async getPipeline(pipelineId: string): Promise<PipelineWithSteps> {
    const [summary, steps] = await Promise.all([
      this.http.get<PipelineSummaryResponse>(`/api/pipelines/${pipelineId}`),
      this.http.get<PipelineStepResponse[]>(`/api/pipelines/${pipelineId}/steps`),
    ]);
    return { ...summary, steps };
  }

  analyzePipeline(pipelineId: string): Promise<PipelineAnalyzeResponse> {
    return this.http.get<PipelineAnalyzeResponse>(`/api/pipelines/${pipelineId}/analyze`);
  }

  /** Persisted run history for a pipeline, most-recent-first (`startedAt
   *  DESC`), each entry carrying its own `assertions` summary (HEL-576/
   *  HEL-581, `GET /api/pipelines/:id/run-history`). Thin pass-through,
   *  mirrors `analyzePipeline`'s style — no reshaping. */
  getPipelineRunHistory(pipelineId: string): Promise<PipelineRunRecordResponse[]> {
    return this.http.get<PipelineRunRecordResponse[]>(`/api/pipelines/${pipelineId}/run-history`);
  }

  /** Dry-analyze a not-yet-created `PipelineProposal` (HEL-381,
   *  `POST /api/pipelines/analyze-proposal`) — projects the source/step
   *  schema without writing anything (no ids minted). Thin pass-through,
   *  mirrors `analyzePipeline`'s style. */
  analyzePipelineProposal(proposal: PipelineProposal): Promise<PipelineAnalyzeProposalResponse> {
    return this.http.post<PipelineAnalyzeProposalResponse>(
      "/api/pipelines/analyze-proposal",
      proposal,
    );
  }

  /** List every registered connector kind with its capability metadata (HEL-484) — what an agent
   *  can connect to and what each kind needs (`requiredFields`), before calling a `create_*`
   *  tool. No credential/secret values are ever included, only field descriptors. */
  listConnectors(): Promise<ConnectorMetadataResponse[]> {
    return this.http.get<ConnectorMetadataResponse[]>("/api/connector-types");
  }

  /** HEL-828 design.md Decision 6: List the caller's real Connector INSTANCES
   *  (`GET /api/connectors`) — distinct from `listConnectors()` above, which lists connector
   *  KIND metadata. Maps the backend's `{items: ConnectorMeta[]}` wire shape into the slim,
   *  explicitly allow-listed `ConnectorSummary` — never the full `ConnectorMeta` shape (which
   *  carries `config`, structurally capable of holding a credential-shaped
   *  `defaultHeaders.Authorization` value even though it never carries the raw credential
   *  itself). Named/mapped by field, never by spreading `ConnectorMeta` and omitting keys. */
  listConnectorInstances(): Promise<ConnectorSummary[]> {
    return this.http
      .get<{
        items: Array<{ id: string; name: string; kind: string; baseUrl: string }>;
      }>("/api/connectors")
      .then((res) =>
        res.items.map((c) => ({ id: c.id, name: c.name, kind: c.kind, host: c.baseUrl })),
      );
  }

  /** List every registered smart pipeline shape with its catalog metadata (HEL-391/402) —
   *  id/label/description/paramsSchema/outputContract, sorted by id. `outputContract.rowCount`/
   *  `description` carry the real signal. Thin pass-through, no reshaping. */
  listPipelineShapes(): Promise<PipelineShapeCatalogEntryResponse[]> {
    return this.http.get<PipelineShapeCatalogEntryResponse[]>("/api/pipeline-shapes");
  }

  /** List metrics — the caller-owned reusable measures defined over
   *  pipeline-output DataTypes (HEL-446/HEL-493). Thin pass-through to the
   *  paginated `GET /api/metrics`. */
  listMetrics(limit = 200, offset = 0): Promise<Paged<MetricResponse>> {
    return this.http.get<Paged<MetricResponse>>("/api/metrics", { limit, offset });
  }

  /** Get one metric by id (`GET /api/metrics/:id`). A non-caller-owned or
   *  unknown id 404s, surfaced verbatim by the tool's `guarded` handler. */
  getMetric(metricId: string): Promise<MetricResponse> {
    return this.http.get<MetricResponse>(`/api/metrics/${metricId}`);
  }

  // ── Agent preferences + memory (HEL-521, 420-C) ─────────────────────────

  /** Get the authenticated token owner's agent-authoring preferences
   *  (`GET /api/preferences`, HEL-472 / 420-A). Thin pass-through, no
   *  reshaping — consumed by `buildWorkspaceContext`'s `agentContext`. */
  getAgentPreferences(): Promise<AgentPreferencesResponse> {
    return this.http.get<AgentPreferencesResponse>("/api/preferences");
  }

  /** List the authenticated token owner's stored agent-memory entries
   *  (`GET /api/agent/memory`, HEL-478 / 420-B), newest-`createdAt`-first.
   *  Thin pass-through, no reshaping — `buildWorkspaceContext` re-sorts and
   *  caps this itself (design.md Decision 6); this method never writes
   *  (never calls `touch`). */
  listAgentMemory(): Promise<AgentMemoryEntryResponse[]> {
    return this.http.get<AgentMemoryEntryResponse[]>("/api/agent/memory");
  }

  // ── Write / composition (Phase 3) ────────────────────────────────────────

  /** Create a `static` data source (inline columns + rows). The backend
   *  auto-creates a source-companion DataType; a pipeline over this source
   *  then produces the panel-bindable output type. Returns the flat
   *  DataSourceResponse (static create is NOT the `{source,dataType}` wrapper
   *  shape the REST/SQL `/api/sources` endpoint returns). `tag` (HEL-366,
   *  optional) is a free-form grouping key propagated to the auto-created
   *  companion DataType as well — see `teardown_resources`. */
  createDataSource(input: {
    name: string;
    columns: StaticColumn[];
    rows: unknown[][];
    tag?: string;
  }): Promise<DataSourceResponse> {
    return this.http.post<DataSourceResponse>("/api/data-sources", {
      name: input.name,
      type: "static",
      columns: input.columns.map((c) => ({ name: c.name, type: c.type })),
      rows: input.rows,
      tag: input.tag,
    });
  }

  /** Create a `csv` data source, from EITHER inline CSV text content (no
   *  filesystem access from the MCP process — the agent has content, not a
   *  path) OR an HTTPS `sourceUrl` the backend fetches and re-fetches on
   *  refresh/schedule (HEL-862). Mutual exclusion between the two is enforced
   *  by the caller (`registerWriteTools`'s tool handler) BEFORE this method
   *  is ever called — a single HTTP request is either multipart or JSON and
   *  can never carry both, so there is no state here in which both are
   *  present.
   *
   *  `content` posts `multipart/form-data` to the same route the UI's
   *  file-upload flow uses, byte-for-byte unchanged from before HEL-862.
   *  `sourceUrl` posts a JSON `{name, type: "csv", config: {url}, tag?}` body
   *  to the same `/api/data-sources` endpoint, hitting the backend's new
   *  `csv`-via-URL JSON branch (mirrors `createDataSource`'s JSON POST).
   *
   *  Like `static`, the backend auto-creates a source-companion DataType but
   *  this route only ever returns the flat `DataSourceResponse` (no `dataType`
   *  field) — inspect the companion via `list_source_objects`. `tag`
   *  (HEL-366, optional) is a free-form grouping key propagated to the
   *  auto-created companion DataType as well — see `teardown_resources`. */
  createCsvDataSource(input: {
    name: string;
    content?: string;
    sourceUrl?: string;
    tag?: string;
  }): Promise<DataSourceResponse> {
    if (input.sourceUrl !== undefined) {
      return this.http.post<DataSourceResponse>("/api/data-sources", {
        name: input.name,
        type: "csv",
        config: { url: input.sourceUrl },
        tag: input.tag,
      });
    }
    const form = new FormData();
    form.set("name", input.name);
    form.set("file", new Blob([input.content ?? ""], { type: "text/csv" }), `${input.name}.csv`);
    if (input.tag) form.set("tag", input.tag);
    return this.http.postMultipart<DataSourceResponse>("/api/data-sources", form);
  }

  /** Create a `rest_api` data source against an existing Connector (HEL-828 design.md
   *  Decision 4/6 -- no `url`/`auth` field exists on this input at all, so an agent cannot
   *  supply a credential inline even if instructed to; the Connector's configured auth is
   *  resolved server-side, never passed through this call). The backend attempts an initial
   *  fetch at creation time; on success it returns the auto-created companion DataType, on
   *  failure it returns `dataType: null` + `fetchError` (not an opaque failure) so the agent
   *  can diagnose and retry. */
  async createRestDataSource(input: {
    name: string;
    connectorId: string;
    endpoint?: string;
    method?: string;
    queryParams?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
    bodyContentType?: string;
    rootSelector?: string;
  }): Promise<CreateSourceResult> {
    const raw = await this.http.post<RawCreateSourceResponse>("/api/sources", {
      name: input.name,
      type: "rest_api",
      config: {
        connectorId: input.connectorId,
        endpoint: input.endpoint,
        method: input.method,
        queryParams: input.queryParams,
        headers: input.headers,
        body: input.body,
        bodyContentType: input.bodyContentType,
        rootSelector: input.rootSelector,
      },
    });
    return {
      source: raw.source,
      dataType: raw.dataType ?? null,
      fetchError: raw.fetchError ?? null,
    };
  }

  /** Create a `sql` data source. Same create → initial-query → companion-
   *  DataType-or-fetchError contract as `createRestDataSource`. The backend
   *  rejects DDL/DML query keywords and redacts the password server-side —
   *  neither is re-implemented here. */
  async createSqlDataSource(input: {
    name: string;
    dialect: string;
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    query: string;
  }): Promise<CreateSourceResult> {
    const raw = await this.http.post<RawCreateSourceResponse>("/api/sources", {
      name: input.name,
      type: "sql",
      config: {
        dialect: input.dialect,
        host: input.host,
        port: input.port,
        database: input.database,
        user: input.user,
        password: input.password,
        query: input.query,
      },
    });
    return {
      source: raw.source,
      dataType: raw.dataType ?? null,
      fetchError: raw.fetchError ?? null,
    };
  }

  /** `tag` (HEL-366, optional) is a free-form grouping key propagated to the newly-created
   *  output DataType as well (the only site that ever inserts that row) — see
   *  `teardown_resources`. */
  createPipeline(input: {
    name: string;
    sourceDataSourceId: string;
    outputDataTypeName: string;
    tag?: string;
  }): Promise<PipelineSummaryResponse> {
    return this.http.post<PipelineSummaryResponse>("/api/pipelines", input);
  }

  /** Append a step. `config` shape is keyed by `type` (e.g. limit → {count}). */
  addPipelineStep(
    pipelineId: string,
    step: { type: string; config: Record<string, unknown> },
  ): Promise<PipelineStepResponse> {
    return this.http.post<PipelineStepResponse>(`/api/pipelines/${pipelineId}/steps`, step);
  }

  /** Expand a shape's params into an ordered list of step create-payloads (HEL-402, the first
   *  HTTP caller of `PipelineShape.expand`). Pure — no persistence. A 404 (unknown shapeId) or 422
   *  (the shape's own params-validation failure, message verbatim) surfaces as a `HelioApiError`
   *  via the shared `describeError`/`guarded` path — never swallowed. */
  expandPipelineShape(
    shapeId: string,
    params: Record<string, unknown>,
  ): Promise<ShapeStepExpansionResponse[]> {
    return this.http.post<ShapeStepExpansionResponse[]>(`/api/pipeline-shapes/${shapeId}/expand`, {
      params,
    });
  }

  /** Instantiate a shape into a new pipeline (design.md Decision 2 — validate before writing).
   *  Calls `expandPipelineShape` FIRST; if it fails (unknown shape id / invalid params) this
   *  rejects with that error and creates NOTHING (no orphan empty pipeline). Only once `expand`
   *  succeeds does it create the pipeline, then add each returned `{kind, config}` expansion as a
   *  step, in order, via the same call `addPipelineStep` uses. Does NOT run the pipeline —
   *  `runPipeline` stays a separate, explicit call. Returns `{...summary, steps}`, mirroring
   *  `getPipeline`'s `PipelineWithSteps`. */
  async createPipelineFromShape(input: {
    name: string;
    sourceDataSourceId: string;
    outputDataTypeName: string;
    shapeId: string;
    params: Record<string, unknown>;
    tag?: string;
  }): Promise<PipelineFromShapeResult> {
    const expansions = await this.expandPipelineShape(input.shapeId, input.params);
    const summary = await this.createPipeline({
      name: input.name,
      sourceDataSourceId: input.sourceDataSourceId,
      outputDataTypeName: input.outputDataTypeName,
      tag: input.tag,
    });
    const steps: PipelineStepResponse[] = [];
    for (const expansion of expansions) {
      steps.push(
        await this.addPipelineStep(summary.id, { type: expansion.kind, config: expansion.config }),
      );
    }
    return { ...summary, steps };
  }

  /** Run a pipeline to completion. Synchronous on `main`: the POST returns only
   *  after the in-process engine finishes and writes rows to the output
   *  DataType — no polling, no race. Re-reads the summary for the output type
   *  id + persisted status so the result chains directly into bind_panel. */
  async runPipeline(pipelineId: string, dry = false): Promise<RunOutcome> {
    const result = await this.http.post<RunResultResponse>(
      `/api/pipelines/${pipelineId}/run`,
      undefined,
      dry ? { dry: "true" } : undefined,
    );
    const summary = await this.http.get<PipelineSummaryResponse>(`/api/pipelines/${pipelineId}`);
    return {
      pipelineId,
      status: summary.lastRunStatus ?? "succeeded",
      rowCount: result.rowCount,
      sourceRowCount: result.sourceRowCount ?? 0,
      outputDataTypeId: summary.outputDataTypeId,
      // HEL-861: default to `false`, never `undefined` — see RunOutcome's doc comment.
      truncated: result.sourceTruncated ?? false,
      availableRowCount: result.sourceAvailableRowCount,
      truncationNotice: result.truncationNotice,
    };
  }

  /** Create a dashboard, or — when `ifExists: "return"` (HEL-363) — return an
   *  existing same-owner, case-insensitive/trimmed name match instead of
   *  creating a duplicate (200), so a rebuild script can target a stable
   *  dashboard without first listing + scanning for a name match. Omitting
   *  `ifExists` behaves exactly as before (always creates, 201). */
  createDashboard(input: { name: string; ifExists?: "return" }): Promise<DashboardResponse> {
    return this.http.post<DashboardResponse>("/api/dashboards", input);
  }

  /** Atomically replace ALL of an existing dashboard's panels with the
   *  supplied set (HEL-363, `PUT /api/dashboards/:id/contents`). Validates
   *  every panel (structure + V41 pipeline-only binding, RLS-owner-scoped)
   *  BEFORE any write — on any invalid panel, NOTHING is deleted or created
   *  and the backend's 400 names the offending panel. On success, the
   *  dashboard's old panels are gone and the new set exists; the live
   *  dashboard is never observably empty mid-rebuild. Returns the rebuilt
   *  dashboard + panels, same shape as apply_proposal. */
  replaceDashboardContents(
    dashboardId: string,
    panels: ProposalPanel[],
  ): Promise<{ dashboard: DashboardResponse; panels: PanelResponse[] }> {
    return this.http.put<{ dashboard: DashboardResponse; panels: PanelResponse[] }>(
      `/api/dashboards/${dashboardId}/contents`,
      { panels },
    );
  }

  /** Create a panel. `type` ∈
   *  metric/chart/table/text/markdown/image/collection/timeline (the MCP no
   *  longer offers `divider`; the backend wire still accepts it on other
   *  paths). `config` is the subtype's create-time config (e.g. collection
   *  `{ baseType, layout }`, chart `{ chartOptions }`, table
   *  `{ density, columnOrder }`, timeline `{ timelineOptions: { sort } }`,
   *  text/markdown `{ content }`).
   *
   *  `appearance` (HEL-305 create channel) is an optional passthrough with the
   *  same wire shape as `update_panel_appearance`. When it carries a `chart`
   *  object the caller's partial chart fields (notably `chartType`) are overlaid
   *  onto the COMPLETE default `ChartAppearance` — a bare `{ chart: { chartType }}`
   *  fails the backend's non-optional `ChartAppearance` deserialization (design
   *  D2). */
  createPanel(input: {
    dashboardId: string;
    title?: string;
    type?: string;
    config?: Record<string, unknown>;
    appearance?: Record<string, unknown>;
  }): Promise<PanelResponse> {
    const body: Record<string, unknown> = {
      dashboardId: input.dashboardId,
      title: input.title,
      type: input.type,
      config: input.config,
    };
    if (input.appearance) body.appearance = withCompleteChartAppearance(input.appearance);
    return this.http.post<PanelResponse>("/api/panels", body);
  }

  /** Create N panels on ONE dashboard in a single call (HEL-370,
   *  `POST /api/panels/batch`) — collapses a per-story image+markdown (or a
   *  batch of pre-created data panels) fan-out that would otherwise be N
   *  separate `createPanel` round-trips into one atomic, all-or-nothing
   *  server-side transaction. Each item is the same shape `createPanel`
   *  accepts minus `dashboardId` (supplied once at the envelope level); each
   *  item's `appearance` (if given) is completed the same way `createPanel`'s
   *  is. Returns every created panel, with ids, in the same order supplied. */
  createPanels(input: {
    dashboardId: string;
    panels: Array<{
      title?: string;
      type?: string;
      config?: Record<string, unknown>;
      appearance?: Record<string, unknown>;
    }>;
  }): Promise<{ panels: PanelResponse[] }> {
    const body = {
      dashboardId: input.dashboardId,
      panels: input.panels.map((panel) => ({
        title: panel.title,
        type: panel.type,
        config: panel.config,
        appearance: panel.appearance ? withCompleteChartAppearance(panel.appearance) : undefined,
      })),
    };
    return this.http.post<{ panels: PanelResponse[] }>("/api/panels/batch", body);
  }

  /** Upload an image (HEL-246). Posts a single `file` multipart part to
   *  `POST /api/uploads/image` — the same shape `create_csv_data_source` uses —
   *  and returns the stored `id`, its served `url` (`/api/uploads/image/<id>`),
   *  and the `helio://uploads/image/<id>` markdown reference. `content` is
   *  base64 by default (images are binary); pass `encoding: "utf8"` for text
   *  content. The backend's 413 (oversize) is surfaced verbatim by the tool. */
  async uploadImage(input: {
    content: string;
    filename: string;
    mime?: string;
    encoding?: "base64" | "utf8";
  }): Promise<ImageUploadOutcome> {
    const bytes = Buffer.from(input.content, input.encoding ?? "base64");
    const form = new FormData();
    form.set(
      "file",
      new Blob([bytes], { type: input.mime ?? "application/octet-stream" }),
      input.filename,
    );
    const result = await this.http.postMultipart<{ id: string; url: string }>(
      "/api/uploads/image",
      form,
    );
    return { ...result, markdownRef: `helio://uploads/image/${result.id}` };
  }

  /** Bind a panel (metric/chart/table/text/markdown/collection/timeline) to a
   *  pipeline-output DataType. PATCHes `config: { dataTypeId, fieldMapping }`;
   *  the PATCH is a per-field merge, so a collection's create-time
   *  `baseType`/`layout` (or a timeline's `timelineOptions.sort`) survive this
   *  bind (design D3). `fieldMapping` is optional — a table binds with no
   *  mapping (columns are a vestigial slot; visible columns come from
   *  `config.columnOrder`, HEL-255). The backend rejects a companion-DataType
   *  binding with 400 (V41 pipeline-only rule) — that error is surfaced to
   *  the caller, never worked around. */
  bindPanel(
    panelId: string,
    binding: { dataTypeId: string; fieldMapping?: Record<string, string>; panelType?: string },
  ): Promise<PanelResponse> {
    const body: Record<string, unknown> = {
      config: { dataTypeId: binding.dataTypeId, fieldMapping: binding.fieldMapping ?? {} },
    };
    if (binding.panelType) body.type = binding.panelType;
    return this.http.patch<PanelResponse>(`/api/panels/${panelId}`, body);
  }

  updatePanelAppearance(
    panelId: string,
    appearance: Record<string, unknown>,
  ): Promise<PanelResponse> {
    return this.http.patch<PanelResponse>(`/api/panels/${panelId}`, { appearance });
  }

  /** `PATCH /api/panels/:id` (HEL-627) — the general edit-in-place sibling of
   *  `updatePanelAppearance`, covering `title`/`type`/`config`/`appearance`.
   *  `patch` is the already-built wire body (`write.ts`'s
   *  `buildUpdatePanelBody` does the omit-vs-absent encoding before calling
   *  this method), so this method itself is a pure pass-through, same as
   *  every other method on this class. */
  updatePanel(panelId: string, patch: UpdatePanelRequest): Promise<PanelResponse> {
    return this.http.patch<PanelResponse>(`/api/panels/${panelId}`, patch);
  }

  /** Create one bound panel in a single call (HEL-364, `POST /api/panels/bound`) — collapses the
   *  6-call chain `createDataSource`/`createPipeline` → `addPipelineStep`* → `runPipeline` →
   *  `createPanel` → `bindPanel` → `updatePanelAppearance` into one server-side, single-HTTP-request
   *  op. NO client-side composition here (contrast with `createPipelineFromShape`, which makes 1 +
   *  N + 1 calls itself) — this is a genuinely single `POST`. The backend validates the panel/
   *  DataType binding BEFORE creating anything (an unsatisfiable `fieldMapping` or a non-data-
   *  bindable `panel.type` 400s with nothing created), runs the pipeline synchronously, and returns
   *  the bound panel with rows already present. On any post-validation failure the backend cleans up
   *  everything it created for THIS call (never a reused `sourceDataSourceId`) and the error message
   *  names the failed stage (`source`/`pipeline`/`steps`/`run`/`panel`) — surfaced verbatim, never
   *  retried or swallowed. Exactly one of `source` (inline `{name,columns,rows}` — same shape as
   *  `createDataSource`) or `sourceDataSourceId` (an existing, caller-owned DataSource) must be
   *  given. `panel.appearance` (if given) is completed the same way `createPanel`'s is. */
  createBoundPanel(input: {
    dashboardId: string;
    source?: { name: string; columns: StaticColumn[]; rows: unknown[][] };
    sourceDataSourceId?: string;
    pipeline: {
      name?: string;
      outputDataTypeName: string;
      steps: { type: string; config: Record<string, unknown> }[];
    };
    panel: {
      type: string;
      title: string;
      config?: Record<string, unknown>;
      appearance?: Record<string, unknown>;
    };
    fieldMapping?: Record<string, string>;
  }): Promise<BoundPanelResponse> {
    const body: Record<string, unknown> = {
      dashboardId: input.dashboardId,
      pipeline: input.pipeline,
      panel: {
        type: input.panel.type,
        title: input.panel.title,
        config: input.panel.config,
        appearance: input.panel.appearance
          ? withCompleteChartAppearance(input.panel.appearance)
          : undefined,
      },
    };
    if (input.source) body.source = input.source;
    if (input.sourceDataSourceId) body.sourceDataSourceId = input.sourceDataSourceId;
    if (input.fieldMapping) body.fieldMapping = input.fieldMapping;
    return this.http.post<BoundPanelResponse>("/api/panels/bound", body);
  }

  /** Apply a reviewed proposal (HEL-225). Server validates + creates the
   *  dashboard + panels atomically via the existing services (RLS + V41). */
  applyProposal(
    proposal: DashboardProposal,
  ): Promise<{ dashboard: DashboardResponse; panels: PanelResponse[] }> {
    return this.http.post<{ dashboard: DashboardResponse; panels: PanelResponse[] }>(
      "/api/dashboards/apply-proposal",
      proposal,
    );
  }

  /** `POST /api/refinements` (HEL-411) — grounds Claude in a target dashboard/pipeline's live
   *  state and returns a validated `PatchSet`; writes NOTHING (mirrors `updatePanel`, HEL-627 — a
   *  thin pass-through, no client-side composition). `conversationId` (design.md D3), when given,
   *  continues that SAME conversation across turns; omitted starts a fresh one. */
  proposePatchSet(input: {
    target: { kind: "dashboard" | "pipeline"; id: string };
    message: string;
    conversationId?: string;
  }): Promise<RefinementResult> {
    return this.http.post<RefinementResult>("/api/refinements", input);
  }

  /** Apply an accepted `PatchSet` atomically (HEL-406, `POST /api/patch-sets/apply`) — the SAME
   *  reviewed-artifact write path `applyProposal` uses for dashboards, reused verbatim here so a
   *  refinement applies through the one atomic, reviewable primitive instead of N raw per-resource
   *  PATCH calls. Thin pass-through, mirrors `applyProposal`'s style — no client-side
   *  re-validation or retry. */
  applyPatchSet(patchSet: PatchSet): Promise<PatchSetApplyResponse> {
    return this.http.post<PatchSetApplyResponse>("/api/patch-sets/apply", patchSet);
  }

  /** Undo a previously-applied, journaled patch set (HEL-413, `POST /api/patch-sets/:id/undo`) —
   *  restores every edit in the named application to its pre-apply state via the SAME per-resource
   *  services `applyPatchSet` uses, or restores none of them (a conflict or a
   *  structurally-unrecoverable delete edit rejects the whole call with an error, surfaced via
   *  `HelioApiError` like any other non-2xx response). Thin pass-through, mirrors
   *  `applyPatchSet`'s style — no client-side re-validation or retry. */
  undoPatchSet(applicationId: string): Promise<PatchSetUndoResponse> {
    return this.http.post<PatchSetUndoResponse>(`/api/patch-sets/${applicationId}/undo`);
  }

  /** Apply a reviewed `PipelineProposal` atomically (HEL-383,
   *  `POST /api/pipelines/apply-proposal`) — the same reviewed-artifact write
   *  path `applyProposal` uses for dashboards. Every guardrail (SQL
   *  read-only, inline-source name/config presence, mutual-exclusivity,
   *  source-fetch failure) is enforced server-side and surfaced as an
   *  ordinary non-2xx response; thin pass-through, mirrors `applyProposal`'s
   *  style — no client-side re-validation or retry. */
  applyPipelineProposal(proposal: PipelineProposal): Promise<PipelineProposalApplyResponse> {
    return this.http.post<PipelineProposalApplyResponse>("/api/pipelines/apply-proposal", proposal);
  }

  /** Apply a combined pipeline+dashboard proposal atomically (HEL-387,
   *  `POST /api/proposals/apply`) — the server applies `pipeline` via
   *  `applyPipelineProposal`'s own atomic path, resolves any `"$pipelineOutput"`
   *  sentinel in `dashboard`'s panels to the pipeline's real output DataType
   *  id, then applies `dashboard` via `applyProposal`'s own atomic path,
   *  rolling back the pipeline (and its inline source, if any) if the
   *  dashboard phase fails. Thin pass-through, mirrors `applyProposal`'s
   *  style — no client-side re-validation or retry; the sentinel-position
   *  guardrail is enforced server-side only. */
  applyCombinedProposal(combined: CombinedProposal): Promise<CombinedProposalApplyResponse> {
    return this.http.post<CombinedProposalApplyResponse>("/api/proposals/apply", combined);
  }

  /** Bulk-delete every data source, pipeline, and DataType owned by the caller that carries
   *  `tag` (HEL-366, `POST /api/workspace/teardown`). Refuses the WHOLE call (200, `blocked:
   *  true`, nothing deleted) if any tagged resource has a dependent outside this same tag batch
   *  — untagged, OR tagged into a different, live batch — that an ordinary single-resource
   *  delete's cascade would otherwise reach (a tagged DataSource with an out-of-batch dependent
   *  Pipeline; a tagged output DataType with an out-of-batch producing Pipeline; a tagged
   *  DataType still bound to a panel or still linked to an out-of-batch source). The response's
   *  `conflicts` names each blocked resource and why. All-or-nothing: on success every resource
   *  tagged `tag` is deleted; on a block, NOTHING is deleted, not even the unblocked portion.
   *  Idempotent — a repeat call with the same tag after success reports all-zero counts. Pass
   *  `dryRun: true` to compute and return the identical plan (same counts/conflicts shape)
   *  without deleting anything — ALWAYS call with `dryRun: true` first to verify scope before a
   *  real teardown, since deletion is permanent. */
  teardownResources(input: { tag: string; dryRun?: boolean }): Promise<TeardownResponse> {
    return this.http.post<TeardownResponse>("/api/workspace/teardown", input);
  }

  // ── Edit-in-place (HEL-328) ──────────────────────────────────────────────
  // Each PATCHes an existing, unmodified backend endpoint (no backend changes
  // in this ticket). Following `updateMetric`'s convention: the `patch`
  // argument on the two multi-field methods is the ALREADY-BUILT wire body —
  // `write.ts`'s body-builders (`updateSchemas.ts`) do the omit-vs-absent
  // encoding before calling these methods, so each method itself is a pure
  // pass-through, same as every other method on this class.

  /** `PATCH /api/data-sources/:id`. Rename-only (design.md D1) — the
   *  backend's `UpdateDataSourceRequest` has no other mutable field. */
  updateDataSource(dataSourceId: string, name: string): Promise<DataSourceResponse> {
    return this.http.patch<DataSourceResponse>(`/api/data-sources/${dataSourceId}`, { name });
  }

  /** `PATCH /api/types/:id`. `patch` is the already-built wire body (see
   *  section note above) — `name`/`fields`/`computedFields` each independently
   *  patchable; `fields`/`computedFields`, when present, replace the existing
   *  array wholesale server-side (no per-item merge). */
  updateDataType(dataTypeId: string, patch: UpdateDataTypeRequest): Promise<DataTypeResponse> {
    return this.http.patch<DataTypeResponse>(`/api/types/${dataTypeId}`, patch);
  }

  /** `PATCH /api/pipelines/:id`. Rename-only (design.md D1) — the backend's
   *  `UpdatePipelineRequest` has exactly one, required field. */
  updatePipeline(pipelineId: string, name: string): Promise<PipelineSummaryResponse> {
    return this.http.patch<PipelineSummaryResponse>(`/api/pipelines/${pipelineId}`, { name });
  }

  /** `PATCH /api/dashboards/:id`, name-only (design.md D7) — mirrors
   *  `updateDataSource`/`updatePipeline`'s inline-body convention. `layout`
   *  has its own dedicated tools (`update_dashboard_layout`,
   *  `auto_layout_dashboard`); dashboard `appearance` is unexposed over MCP
   *  entirely today (a separate gap, not this method's concern). */
  updateDashboard(dashboardId: string, name: string): Promise<DashboardResponse> {
    return this.http.patch<DashboardResponse>(`/api/dashboards/${dashboardId}`, { name });
  }

  /** `GET /api/pipelines/:id/schedule` (HEL-415). A pipeline with no
   *  schedule 404s server-side (`PipelineScheduleService`) — surfaced
   *  verbatim by the tool's `guarded` handler, never converted into an
   *  absent/empty success value here. */
  getPipelineSchedule(pipelineId: string): Promise<PipelineScheduleResponse> {
    return this.http.get<PipelineScheduleResponse>(`/api/pipelines/${pipelineId}/schedule`);
  }

  /** `PUT /api/pipelines/:id/schedule` (HEL-415) — a genuine upsert: the
   *  backend reuses the existing schedule's id/createdAt when one already
   *  exists, so calling this twice for the same pipeline PUTs to the same
   *  path rather than forking into a create-vs-update case. `body` is the
   *  ALREADY-BUILT wire body (`buildSetPipelineScheduleBody` in
   *  `tools/scheduleTools.ts` does the omit-vs-absent `enabled` encoding
   *  before calling this method), matching this class's established
   *  already-built-patch convention (`updateDataType`/`updateMetric`). */
  setPipelineSchedule(
    pipelineId: string,
    body: PutPipelineScheduleRequest,
  ): Promise<PipelineScheduleResponse> {
    return this.http.put<PipelineScheduleResponse>(`/api/pipelines/${pipelineId}/schedule`, body);
  }

  /** `DELETE /api/pipelines/:id/schedule` (HEL-415). The route is
   *  `ServiceResponse.runNoContent` — an empty 204 body — so, exactly like
   *  `deleteDashboard`/`deletePipeline`, a synthesised acknowledgement is
   *  returned rather than `void`: `guarded()`'s `JSON.stringify(value, null,
   *  2)` yields `undefined` (not a string at all) for an actual `undefined` return,
   *  which would be a broken tool result. Deliberately `{ pipelineId }`, NOT
   *  `{ id }` (design.md D11): the caller addresses the schedule by its
   *  PIPELINE id and never sees the schedule's own id, so echoing it back
   *  under the `id` key would misrepresent whose id it is. */
  async deletePipelineSchedule(pipelineId: string): Promise<{ deleted: true; pipelineId: string }> {
    await this.http.delete(`/api/pipelines/${pipelineId}/schedule`);
    return { deleted: true, pipelineId };
  }

  /** `PATCH /api/pipeline-steps/:id`. `patch` is the already-built wire body
   *  (see section note above) — `config`/`position` each independently
   *  patchable; NEVER carries a `type` key (design.md D2 — the backend always
   *  400s on a mismatched type and no-ops on a matching one, so it is
   *  deliberately not exposed by this tool at all). `config`, when provided,
   *  is decoded server-side against the step's EXISTING kind. */
  updatePipelineStep(
    stepId: string,
    patch: UpdatePipelineStepRequest,
  ): Promise<PipelineStepResponse> {
    return this.http.patch<PipelineStepResponse>(`/api/pipeline-steps/${stepId}`, patch);
  }

  // ── Metrics (semantic layer, HEL-446/HEL-493/HEL-541) ───────────────────

  /** Create a metric (`POST /api/metrics`) — a named, reusable measure
   *  (`aggregation` over `measureField`) over a caller-owned, pipeline-output
   *  DataType (V41). The backend validates `dataTypeId`/`measureField`/
   *  `allowedDimensions` against the DataType's actual shape; that rejection
   *  is surfaced verbatim, never worked around here. */
  createMetric(input: CreateMetricRequest): Promise<MetricResponse> {
    return this.http.post<MetricResponse>("/api/metrics", input);
  }

  /** Update a metric (`PATCH /api/metrics/:id`). `patch` is the ALREADY-BUILT
   *  wire body (design.md Decision 2's absent-vs-null convention: a key is
   *  present only when the caller supplied that argument) — the tool layer
   *  (`write.ts`'s body-builder) does the omit-vs-null encoding before
   *  calling this method, so this method itself is a pure pass-through, same
   *  as every other method on this class. */
  updateMetric(metricId: string, patch: UpdateMetricRequest): Promise<MetricResponse> {
    return this.http.patch<MetricResponse>(`/api/metrics/${metricId}`, patch);
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  //
  // Most delete endpoints answer `204 No Content` (the backend's
  // `ServiceResponse.runNoContent`), so there is no body to return; each
  // wrapper resolves to a small `{ deleted: true, id }` acknowledgement so the
  // MCP tool result is not an empty string. EXCEPTION (HEL-906 task 3.2):
  // `DELETE /api/pipeline-steps/:id` now answers `200 OK` with a
  // `{ removedTailStepCount }` splice-on-delete report instead — this wrapper
  // still discards that body (never reads status or response data beyond
  // "the request succeeded"), so the change is not observed here, but the
  // stale "every delete endpoint answers 204" claim would have been wrong to
  // leave in place. Deletion is permanent — the backend is owner-scoped (a
  // non-owner gets 403, an unknown id 404, surfaced verbatim by the tool's
  // guarded handler). Cascades are FK-enforced in PostgreSQL.

  /** `DELETE /api/dashboards/:id`. Owner-only. Cascades to the dashboard's
   *  panels (and per-user zoom prefs). Does not touch data sources/types. */
  async deleteDashboard(dashboardId: string): Promise<{ deleted: true; id: string }> {
    await this.http.delete(`/api/dashboards/${dashboardId}`);
    return { deleted: true, id: dashboardId };
  }

  /** `DELETE /api/data-sources/:id`. Cascades to any pipeline built on this
   *  source (and, transitively, that pipeline's steps/runs/output DataType);
   *  the source's companion DataType has its `sourceId` set null, not deleted. */
  async deleteDataSource(dataSourceId: string): Promise<{ deleted: true; id: string }> {
    await this.http.delete(`/api/data-sources/${dataSourceId}`);
    return { deleted: true, id: dataSourceId };
  }

  /** `DELETE /api/types/:id`. Cascades to any pipeline whose output is this
   *  DataType (and that pipeline's steps/runs); panels bound to it are unbound
   *  (`type_id` set null), not deleted. */
  async deleteDataType(dataTypeId: string): Promise<{ deleted: true; id: string }> {
    await this.http.delete(`/api/types/${dataTypeId}`);
    return { deleted: true, id: dataTypeId };
  }

  /** `DELETE /api/panels/:id`. Removes a single panel from its dashboard. */
  async deletePanel(panelId: string): Promise<{ deleted: true; id: string }> {
    await this.http.delete(`/api/panels/${panelId}`);
    return { deleted: true, id: panelId };
  }

  /** `DELETE /api/pipelines/:id`. Owner-only. Cascades to the pipeline's steps
   *  and run history. The output DataType is NOT deleted by deleting the
   *  pipeline (delete it separately with delete_data_type if desired). */
  async deletePipeline(pipelineId: string): Promise<{ deleted: true; id: string }> {
    await this.http.delete(`/api/pipelines/${pipelineId}`);
    return { deleted: true, id: pipelineId };
  }

  /** `DELETE /api/metrics/:id`. Owner-only. Does not touch the underlying
   *  DataType. Any panel bound to this metric has its metric reference
   *  cleared (`ON DELETE SET NULL`, V76) rather than being deleted. */
  async deleteMetric(metricId: string): Promise<{ deleted: true; id: string }> {
    await this.http.delete(`/api/metrics/${metricId}`);
    return { deleted: true, id: metricId };
  }

  /** `DELETE /api/pipeline-steps/:stepId`. Note the flat top-level path — a
   *  step is addressed by its own id, NOT nested under its pipeline. Removes a
   *  single transform step; re-run the pipeline to reflect the change. */
  async deletePipelineStep(stepId: string): Promise<{ deleted: true; id: string }> {
    await this.http.delete(`/api/pipeline-steps/${stepId}`);
    return { deleted: true, id: stepId };
  }

  /** Set a dashboard's responsive grid layout. PATCHes /api/dashboards/:id with
   *  a DashboardLayoutPayload. Takes flat `{panelId,x,y,w,h}` items and applies
   *  them to all four breakpoints (lg/md/sm/xs) — a desktop-first placement that
   *  the backend requires be fully specified. */
  updateDashboardLayout(
    dashboardId: string,
    items: { panelId: string; x: number; y: number; w: number; h: number }[],
  ): Promise<DashboardResponse> {
    const layout = { lg: items, md: items, sm: items, xs: items };
    return this.http.patch<DashboardResponse>(`/api/dashboards/${dashboardId}`, { layout });
  }

  /** Pack `{panelId, w, h}` sizes into non-overlapping `{x,y,w,h}` positions
   *  and persist them (HEL-367, `POST /api/dashboards/:id/auto-layout`) —
   *  replaces the need for a caller to compute panel positions itself (the
   *  server flows sizes left-to-right, wraps overflowing rows, widens ragged
   *  shelf edges, and clamps out-of-bounds sizes per panel kind). Input order
   *  is visual order; `cols` defaults to 12. Panels omitted from `items` keep
   *  their current saved position; a `panelId` not on the dashboard causes
   *  the backend to reject the whole request with 400 (surfaced verbatim by
   *  the tool's guarded handler, not swallowed here). Same "apply to all four
   *  breakpoints" convention as `updateDashboardLayout`. */
  autoLayoutDashboard(
    dashboardId: string,
    items: { panelId: string; w: number; h: number }[],
    cols?: number,
  ): Promise<DashboardResponse> {
    return this.http.post<DashboardResponse>(`/api/dashboards/${dashboardId}/auto-layout`, {
      items,
      cols,
    });
  }
}
