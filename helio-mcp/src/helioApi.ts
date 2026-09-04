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
  CombinedProposal,
  CombinedProposalApplyResponse,
  ConnectorMetadataResponse,
  ConnectorSummary,
  CreateConnectorResult,
  CreateSourceResult,
  CsvPreview,
  DashboardProposal,
  DashboardResponse,
  DashboardSnapshot,
  DataSourceResponse,
  InferredSchemaResponse,
  Paged,
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
  ExpandPipelineShapeResponse,
  ShapeStepExpansionResponse,
  TeardownResponse,
  UpdateOutputRequest,
  UpdatePanelRequest,
  UpdatePipelineStepRequest,
  AssertionStatusResponse,
  CreateOutputRequest,
  DeleteOutputResponse,
  NodeCapabilitiesResponse,
  OutputPanelPlacementResponse,
  OutputResponse,
  OutputsResponse,
  PipelinePreviewResponse,
  PipelineProposalOutput,
  PipelineProposalStep,
  CreatePipelineRootRequest,
  PipelineRootSummaryResponse,
  RemovePipelineRootResponse,
} from "./types.js";

/** Raw `POST /api/sources` wire shape, before the missing-Option → `null`
 *  normalization described on `CreateSourceResult`. Not exported — an
 *  implementation detail of `createRestDataSource`/`createSqlDataSource`.
 *  HEL-907 evaluator-final-1: `dataType` (dead since HEL-904) replaced with the field the
 *  backend actually sends, `inferredSchema`; `rowCapNotice` added (was silently dropped too). */
interface RawCreateSourceResponse {
  source: DataSourceResponse;
  inferredSchema?: InferredSchemaResponse;
  fetchError?: string;
  rowCapNotice?: string;
}

const CSV_LIKE_TYPES = new Set(["csv", "static"]);

/** Inline column spec for a static data source. */
export interface StaticColumn {
  name: string;
  type: string;
}

/** run_pipeline outcome. The run is synchronous on `main`: a 200 already means completion and
 *  rows are written to the pipeline's Output(s) — nothing to poll. HEL-907 evaluator-final
 *  round-2 CR2: `outputDataTypeId` REMOVED — it hasn't existed on the wire since HEL-904 (this
 *  interface mapped it from `PipelineSummaryResponse.outputDataTypeId`, a field that field itself
 *  never had either — `JSON.stringify` silently dropped the resulting `undefined`, so no agent
 *  ever actually received it despite the tool description promising it). Call
 *  `list_outputs(pipelineId)` afterward for the produced Output id(s). */
export interface RunOutcome {
  pipelineId: string;
  status: string;
  rowCount: number;
  sourceRowCount: number;
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

  // HEL-907 evaluator-final non-blocking note 1: `listDataTypes` (GET /api/types) REMOVED --
  // zero call sites since cycle 10 (`/api/types` itself was deleted by HEL-904; this was a
  // dead client-side method calling a dead route, never caught because nothing exercised it).

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

  /** HEL-886 design.md Decision 1: Create a credential-less Connector (`authType: "none"`
   *  ONLY -- `create_connector`'s handler refuses any other `authType` before this method is
   *  ever called, see `write.ts`). `credential: ""` is a hardcoded LITERAL here -- never a
   *  parameter, never defaulted from `input`, and no code path can populate it -- so "no
   *  secret passes through a model context" is a structural property of this call site, not a
   *  validation rule that could be bypassed upstream. Maps the backend's Connector response by
   *  field into `CreateConnectorResult` (id/name/kind/host only), never by spreading --
   *  the backend's full row carries `config`/`ownerId`/timestamps this surface never exposes. */
  createConnector(input: {
    name: string;
    kind: string;
    baseUrl: string;
  }): Promise<CreateConnectorResult> {
    return this.http
      .post<{ id: string; name: string; kind: string; baseUrl: string }>("/api/connectors", {
        name: input.name,
        kind: input.kind,
        baseUrl: input.baseUrl,
        config: { authType: "none" },
        credential: "",
      })
      .then((c) => ({ id: c.id, name: c.name, kind: c.kind, host: c.baseUrl }));
  }

  /** List every registered smart pipeline shape with its catalog metadata (HEL-391/402) —
   *  id/label/description/paramsSchema/outputContract, sorted by id. `outputContract.rowCount`/
   *  `description` carry the real signal. Thin pass-through, no reshaping. */
  listPipelineShapes(): Promise<PipelineShapeCatalogEntryResponse[]> {
    return this.http.get<PipelineShapeCatalogEntryResponse[]>("/api/pipeline-shapes");
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

  /** Create a `static` data source (inline columns + rows). Returns the flat
   *  DataSourceResponse -- creates no pipeline and no Output; a pipeline over this source
   *  (create_pipeline, with an `outputs[]` entry) produces a panel-bindable Output. `tag`
   *  (HEL-366, optional) is a free-form grouping key -- see `teardown_resources`. */
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
   *  Returns the flat `DataSourceResponse` -- creates no pipeline and no Output; a pipeline
   *  over this source (create_pipeline, with an `outputs[]` entry) produces a panel-bindable
   *  Output. `tag` (HEL-366, optional) is a free-form grouping key -- see `teardown_resources`. */
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
   *  fetch at creation time; on success it returns the re-inferred `inferredSchema` (the ONLY
   *  wire-accurate signal of success/failure -- `dataType` doesn't exist on this response and
   *  never has, since HEL-904), on failure it returns `inferredSchema: null` + `fetchError`
   *  (not an opaque failure) so the agent can diagnose and retry. */
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
      inferredSchema: raw.inferredSchema ?? null,
      rowCapNotice: raw.rowCapNotice ?? null,
      fetchError: raw.fetchError ?? null,
    };
  }

  /** Create a `sql` data source. Same create → initial-query → inferredSchema-or-fetchError
   *  contract as `createRestDataSource`. The backend rejects DDL/DML query keywords and
   *  redacts the password server-side — neither is re-implemented here. */
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
      inferredSchema: raw.inferredSchema ?? null,
      rowCapNotice: raw.rowCapNotice ?? null,
      fetchError: raw.fetchError ?? null,
    };
  }

  /** `POST /api/pipelines` -- HEL-907 task 3.2 retargeted this onto the single-call
   *  transactional shape (HEL-906): `steps`/`outputs` are OPTIONAL (absent/empty preserves the
   *  simple `{name, roots}` create); non-empty builds the pipeline, its steps
   *  (resolving `parentStepId` against earlier `clientId`s in the SAME call), and its Outputs
   *  (resolving `nodeStepClientId` the same way) in ONE transaction. An implicit single output
   *  from the retired DataType/Metric model is no longer created at all -- pass `outputs` if any
   *  are wanted.
   *
   *  HEL-913 task 9.1: `roots` REPLACES the retired scalar `sourceDataSourceId` outright -- the
   *  backend hard-rejects (400) a body naming the old scalar field or omitting `roots` (design.md
   *  decision 11, "no deprecation"). `create_pipeline` itself stays single-root (one caller-
   *  resolved source, wrapped in a one-element `roots` array) -- multi-root pipeline creation is
   *  not this tool's scope; `add_root`/`remove_root` (below) are the multi-root entry points. */
  createPipeline(input: {
    name: string;
    roots: CreatePipelineRootRequest[];
    tag?: string;
    steps?: PipelineProposalStep[];
    outputs?: PipelineProposalOutput[];
  }): Promise<PipelineSummaryResponse> {
    return this.http.post<PipelineSummaryResponse>("/api/pipelines", input);
  }

  /** `POST /api/pipelines/:id/roots` (`add_root`, HEL-913 R6) -- appends a new root at the next
   *  available position. `req` is the SAME `CreatePipelineRootRequest` shape `roots[]` uses at
   *  create time -- an existing `sourceId` OR an inline source spec (`csv` not supported
   *  inline, same constraint as `create_pipeline`'s inline branch). */
  addPipelineRoot(
    pipelineId: string,
    req: CreatePipelineRootRequest,
  ): Promise<PipelineRootSummaryResponse> {
    return this.http.post<PipelineRootSummaryResponse>(`/api/pipelines/${pipelineId}/roots`, req);
  }

  /** `DELETE /api/pipelines/:id/roots/:rootId` (`remove_root`, HEL-913 R7) -- refuses to remove
   *  the pipeline's LAST root, and refuses when a surviving lane still references a node that
   *  would be deleted (both named 400s, nothing partially applied). On success, deletes every
   *  step descending from this root and reports the counts. */
  removePipelineRoot(pipelineId: string, rootId: string): Promise<RemovePipelineRootResponse> {
    return this.http.delete<RemovePipelineRootResponse>(
      `/api/pipelines/${pipelineId}/roots/${rootId}`,
    );
  }

  /** Append a step (`POST /api/pipelines/:id/steps`). `config` shape is keyed by `type` (e.g.
   *  limit → {count}). `parentStepId` (HEL-907 task 3.3), when present, splices the new step in
   *  directly after that EXISTING step id -- an alternative to `position` that can express
   *  placements `position` cannot, most notably branching a new tail off any existing node;
   *  absent extends the trunk (unchanged pre-existing default). */
  addPipelineStep(
    pipelineId: string,
    step: {
      type: string;
      config: Record<string, unknown>;
      parentStepId?: string;
      position?: number;
      enabled?: boolean;
      /** HEL-913 task 9.5: the alternative anchor to `parentStepId` -- names WHICH root a
       *  PARENTLESS step attaches to (extending THAT root's trunk). Mutually exclusive with
       *  `parentStepId` (both -> 400); unnecessary on a single-root pipeline. */
      rootId?: string;
      attachAsTail?: boolean;
    },
  ): Promise<PipelineStepResponse> {
    return this.http.post<PipelineStepResponse>(`/api/pipelines/${pipelineId}/steps`, step);
  }

  /** Expand a shape's params into an ordered list of step create-payloads (HEL-402, the first
   *  HTTP caller of `PipelineShape.expand`). Pure — no persistence. A 404 (unknown shapeId) or 422
   *  (the shape's own params-validation failure, message verbatim) surfaces as a `HelioApiError`
   *  via the shared `describeError`/`guarded` path — never swallowed.
   *
   *  HEL-934/HEL-907 task 3.12: the real wire response is `ExpandPipelineShapeResponse`
   *  (`{steps, outputs?}`), NOT a bare `ShapeStepExpansionResponse[]` -- this method used to claim
   *  the bare-array shape and return the raw HTTP body unchanged, which is a live bug: every
   *  caller that iterated the result directly as an array (e.g. `for (const step of expansions)`)
   *  would throw at runtime the first time a shape expanded to any steps at all, since the real
   *  body is `{steps: [...], outputs: null}`. Unwraps `.steps` here so the external contract
   *  (`Promise<ShapeStepExpansionResponse[]>`) stays exactly what every existing caller already
   *  expects -- the fix is entirely internal to this method. */
  async expandPipelineShape(
    shapeId: string,
    params: Record<string, unknown>,
  ): Promise<ShapeStepExpansionResponse[]> {
    const response = await this.http.post<ExpandPipelineShapeResponse>(
      `/api/pipeline-shapes/${shapeId}/expand`,
      { params },
    );
    return response.steps;
  }

  // HEL-907 task 3.4: createPipelineFromShape REMOVED outright -- its only caller
  // (create_pipeline_from_shape) is retired; replaced by addOutputsFromShapeHandler
  // (tools/pipelinesHandlers.ts), which expands a shape onto an EXISTING pipeline node instead
  // of always creating a brand-new pipeline, composing expandPipelineShape/addPipelineStep/
  // createOutput directly rather than through a dedicated helioApi method.

  /** Run a pipeline to completion. Synchronous on `main`: the POST returns only
   *  after the in-process engine finishes and writes rows to its Output(s) —
   *  no polling, no race. Re-reads the summary for persisted status so the
   *  result chains directly into place_outputs. */
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
   *  `ifExists` behaves exactly as before (always creates, 201). `tag`
   *  (HEL-907 evaluator-1 CR3, V95) is optional, free-form, set only at
   *  create time — mirrors DataSource/Pipeline's own `tag`, lets a
   *  workflow's dashboards be torn down together with `teardown_resources`
   *  instead of leaking (the exact bug this fixes — see
   *  `e2e/sleeper-rebuild.ts`'s own header comment for the incident). */
  createDashboard(input: {
    name: string;
    ifExists?: "return";
    tag?: string;
  }): Promise<DashboardResponse> {
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

  // HEL-907 task 3.6: createPanel/createPanels REMOVED outright -- their only callers
  // (create_panel/create_panels) are retired; replaced by placeOutputs/createContentPanel below.

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

  // HEL-907 task 3.6: bindPanel REMOVED outright -- its only caller (bind_panel) is retired;
  // an output-kind panel's real config shape (OutputPanelConfig) only ever carries `outputId`,
  // never `dataTypeId`/`fieldMapping` (those moved to the Output itself) -- this method's own
  // PATCH body would have been silently meaningless against the current model.

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

  // ── Placements (HEL-907 task 3.6) ───────────────────────────────────────

  /** Create N `output`-kind panels (placements) on ONE dashboard in a single call
   *  (`POST /api/panels/batch`, HEL-370) — replaces `create_panel`/`create_panels`/`bind_panel`/
   *  `create_bound_panel` for the data-bound case: a placement carries ONLY `config.outputId`
   *  (no fieldMapping/aggregation on the panel itself anymore -- that lives on the Output). */
  placeOutputs(
    dashboardId: string,
    items: Array<{ outputId: string; title?: string }>,
  ): Promise<{ panels: PanelResponse[] }> {
    const body = {
      dashboardId,
      panels: items.map((item) => ({
        title: item.title,
        type: "output",
        config: { outputId: item.outputId },
      })),
    };
    return this.http.post<{ panels: PanelResponse[] }>("/api/panels/batch", body);
  }

  /** Create ONE content panel (`text`/`markdown`/`image`/`divider` -- no data binding at all).
   *  `config` is the subtype's create-time config (text/markdown `{content}`; image
   *  `{imageUrl, imageFit?, caption?}`; divider `{orientation?, weight?, color?}`). `appearance`
   *  (HEL-305 create channel), when given, has its `chart` sub-object (if any) completed against
   *  the full default `ChartAppearance` the same way the retired `createPanel` always did -- a
   *  bare `{chart: {chartType}}` fails the backend's non-optional `ChartAppearance`
   *  deserialization otherwise. */
  createContentPanel(input: {
    dashboardId: string;
    title?: string;
    type: "text" | "markdown" | "image" | "divider";
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

  // HEL-907 task 3.6: createBoundPanel REMOVED outright -- its own backend route
  // (POST /api/panels/bound) no longer exists (retired during the Outputs remodel); every call
  // has 404'd since then, undetected because no test covered it. Its replacement is a genuine
  // client-side composition (create_pipeline with outputs[], then place_outputs), not a single
  // backend call -- there is no equivalent one-POST primitive in the new model.

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

  /** Bulk-delete every data source, pipeline, and dashboard owned by the caller that carries
   *  `tag` (HEL-366, extended to dashboards HEL-907 V95; `POST /api/workspace/teardown`). A
   *  pipeline's Outputs/placements and a dashboard's panels carry no tag of their own -- they
   *  cascade automatically with their owning resource. Refuses the WHOLE call (200, `blocked:
   *  true`, nothing deleted) if any tagged DATA SOURCE has a dependent pipeline outside this same
   *  tag batch — untagged, OR tagged into a different, live batch — that an ordinary
   *  single-resource delete's cascade would otherwise reach; dashboards and pipelines carry no
   *  analogous guard of their own. The response's `conflicts` names each blocked resource and
   *  why. All-or-nothing: on success every resource tagged `tag` is deleted; on a block, NOTHING
   *  is deleted, not even the unblocked portion. Idempotent — a repeat call with the same tag
   *  after success reports all-zero counts. Pass `dryRun: true` to compute and return the
   *  identical plan (same counts/conflicts shape) without deleting anything — ALWAYS call with
   *  `dryRun: true` first to verify scope before a real teardown, since deletion is permanent. */
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

  /** `PATCH /api/pipelines/:id`. Rename-only (design.md D1) — the backend's
   *  `UpdatePipelineRequest` has exactly one, required field. */
  updatePipeline(pipelineId: string, name: string): Promise<PipelineSummaryResponse> {
    return this.http.patch<PipelineSummaryResponse>(`/api/pipelines/${pipelineId}`, { name });
  }

  // ── Outputs (HEL-906/HEL-907 task 3.5) ──────────────────────────────────

  /** `POST /api/pipelines/:id/outputs`. `nodeStepId` absent means a root-bound Output --
   *  `req.rootId` (HEL-913, multi-root only) names WHICH root; omitted on a single-root
   *  pipeline (the backend auto-resolves the one root). */
  createOutput(pipelineId: string, req: CreateOutputRequest): Promise<OutputResponse> {
    return this.http.post<OutputResponse>(`/api/pipelines/${pipelineId}/outputs`, req);
  }

  /** `GET /api/pipelines/:id/outputs?nodeStepId=`. `nodeStepId` omitted lists every Output on
   *  the pipeline; passed, scopes to that one node. */
  listOutputsByPipeline(pipelineId: string, nodeStepId?: string): Promise<OutputsResponse> {
    return this.http.get<OutputsResponse>(`/api/pipelines/${pipelineId}/outputs`, { nodeStepId });
  }

  /** `GET /api/outputs?offset&limit` — lean, top-level, paginated list of every Output the
   *  caller OWNS (HEL-906 cycle 7, task 2.6, absorbs HEL-722). */
  listAllOutputs(limit = 200, offset = 0): Promise<Paged<OutputResponse>> {
    return this.http.get<Paged<OutputResponse>>("/api/outputs", { limit, offset });
  }

  /** `GET /api/outputs/:id`. Sharing-aware (owner/editor/viewer of the parent pipeline). */
  getOutput(outputId: string): Promise<OutputResponse> {
    return this.http.get<OutputResponse>(`/api/outputs/${outputId}`);
  }

  /** `PATCH /api/outputs/:id`. Owner-only; `config`, when present, merges one level deep for
   *  `legend`/`tooltip`/`seriesColors`/`axisLabels` rather than replacing wholesale (HEL-877). */
  updateOutput(outputId: string, patch: UpdateOutputRequest): Promise<OutputResponse> {
    return this.http.patch<OutputResponse>(`/api/outputs/${outputId}`, patch);
  }

  /** `DELETE /api/outputs/:id`. Owner-only; also deletes every placement Panel bound to this
   *  Output (V94 `panels.output_id ON DELETE CASCADE`, reported back explicitly here). */
  deleteOutput(outputId: string): Promise<DeleteOutputResponse> {
    return this.http.delete<DeleteOutputResponse>(`/api/outputs/${outputId}`);
  }

  /** `GET /api/outputs/:id/panels` — the placements report used before a destructive delete. */
  listOutputPanels(outputId: string): Promise<OutputPanelPlacementResponse[]> {
    return this.http.get<OutputPanelPlacementResponse[]>(`/api/outputs/${outputId}/panels`);
  }

  /** `GET /api/outputs/:id/assertion-status`. */
  getOutputAssertionStatus(outputId: string): Promise<AssertionStatusResponse> {
    return this.http.get<AssertionStatusResponse>(`/api/outputs/${outputId}/assertion-status`);
  }

  /** `GET /api/outputs/:id/rows?offset&limit` — paginated latest-run row snapshot
   *  (`get_output_rows`, replaces the retired `get_data_type_rows`). */
  getOutputRows(
    outputId: string,
    limit = 200,
    offset = 0,
  ): Promise<Paged<Record<string, unknown>>> {
    return this.http.get<Paged<Record<string, unknown>>>(`/api/outputs/${outputId}/rows`, {
      limit,
      offset,
    });
  }

  /** `POST /api/pipelines/:id/preview?outputId=`. `outputId` absent previews every Output on the
   *  pipeline; passed, scopes to that one. Both arms return the identical
   *  `{outputs: [{outputId, preview}]}` envelope — no branching logic needed here. */
  previewOutputs(pipelineId: string, outputId?: string): Promise<PipelinePreviewResponse> {
    return this.http.post<PipelinePreviewResponse>(
      `/api/pipelines/${pipelineId}/preview`,
      {},
      { outputId },
    );
  }

  /** `GET /api/pipelines/:id/capabilities?stepId=` (`get_output_capabilities`, replaces the
   *  retired `get_panel_capabilities`, which called a route HEL-904 deleted). `stepId` absent
   *  means the pipeline's raw source. */
  getOutputCapabilities(pipelineId: string, stepId?: string): Promise<NodeCapabilitiesResponse> {
    return this.http.get<NodeCapabilitiesResponse>(`/api/pipelines/${pipelineId}/capabilities`, {
      stepId,
    });
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
   *  already-built-patch convention (`updatePipelineStep`/`updatePanel`). */
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

  /** `DELETE /api/panels/:id`. Removes a single panel from its dashboard. */
  async deletePanel(panelId: string): Promise<{ deleted: true; id: string }> {
    await this.http.delete(`/api/panels/${panelId}`);
    return { deleted: true, id: panelId };
  }

  /** `DELETE /api/pipelines/:id`. Owner-only. Cascades to the pipeline's
   *  steps, run history, AND its Outputs (and their placements) -- unlike the
   *  retired DataType model, an Output has no independent lifecycle from its
   *  producing pipeline. */
  async deletePipeline(pipelineId: string): Promise<{ deleted: true; id: string }> {
    await this.http.delete(`/api/pipelines/${pipelineId}`);
    return { deleted: true, id: pipelineId };
  }

  /** `DELETE /api/pipeline-steps/:stepId`. Note the flat top-level path — a
   *  step is addressed by its own id, NOT nested under its pipeline. Removes a
   *  single transform step; re-run the pipeline to reflect the change.
   *
   *  HEL-934/HEL-907 task 3.12: this route answers `200 OK` with a real
   *  `{removedTailStepCount}` splice-on-delete report (HEL-906 task 3.2 --
   *  deleting a mid-tree step also removes every descendant step under the
   *  HEL-904 tree model), NOT an empty `204` like every other delete
   *  endpoint in this class. Previously discarded that body entirely
   *  (`await this.http.delete(...)`, never reading the response) -- an
   *  agent deleting one step in the middle of a branch had no way to learn
   *  it silently took N descendant steps with it. Surfaced explicitly now. */
  async deletePipelineStep(
    stepId: string,
  ): Promise<{ deleted: true; id: string; removedTailStepCount: number }> {
    const response = await this.http.delete<{ removedTailStepCount: number }>(
      `/api/pipeline-steps/${stepId}`,
    );
    return { deleted: true, id: stepId, removedTailStepCount: response.removedTailStepCount };
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
