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
  CreateSourceResult,
  CsvPreview,
  DashboardProposal,
  DashboardResponse,
  DashboardSnapshot,
  DataSourceResponse,
  DataTypeResponse,
  DataTypeRowsResponse,
  Paged,
  PanelResponse,
  PipelineAnalyzeResponse,
  PipelineStepResponse,
  PipelineSummaryResponse,
  RestAuthInput,
  RowsPreview,
  RunResultResponse,
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

  listDataSources(limit = 200, offset = 0): Promise<Paged<DataSourceResponse>> {
    return this.http.get<Paged<DataSourceResponse>>("/api/data-sources", { limit, offset });
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

  listDataTypes(limit = 200, offset = 0): Promise<Paged<DataTypeResponse>> {
    return this.http.get<Paged<DataTypeResponse>>("/api/types", { limit, offset });
  }

  getDataTypeRows(dataTypeId: string): Promise<DataTypeRowsResponse> {
    return this.http.get<DataTypeRowsResponse>(`/api/types/${dataTypeId}/rows`);
  }

  listPipelines(): Promise<PipelineSummaryResponse[]> {
    return this.http.get<PipelineSummaryResponse[]>("/api/pipelines");
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

  // ── Write / composition (Phase 3) ────────────────────────────────────────

  /** Create a `static` data source (inline columns + rows). The backend
   *  auto-creates a source-companion DataType; a pipeline over this source
   *  then produces the panel-bindable output type. Returns the flat
   *  DataSourceResponse (static create is NOT the `{source,dataType}` wrapper
   *  shape the REST/SQL `/api/sources` endpoint returns). */
  createDataSource(input: {
    name: string;
    columns: StaticColumn[];
    rows: unknown[][];
  }): Promise<DataSourceResponse> {
    return this.http.post<DataSourceResponse>("/api/data-sources", {
      name: input.name,
      type: "static",
      columns: input.columns.map((c) => ({ name: c.name, type: c.type })),
      rows: input.rows,
    });
  }

  /** Create a `csv` data source from inline CSV text content (no filesystem
   *  access from the MCP process — the agent has content, not a path). Posts
   *  multipart form data to the same route the UI's file-upload flow uses.
   *  Like `static`, the backend auto-creates a source-companion DataType but
   *  this route only ever returns the flat `DataSourceResponse` (no `dataType`
   *  field) — inspect the companion via `list_source_objects`. */
  createCsvDataSource(input: { name: string; content: string }): Promise<DataSourceResponse> {
    const form = new FormData();
    form.set("name", input.name);
    form.set("file", new Blob([input.content], { type: "text/csv" }), `${input.name}.csv`);
    return this.http.postMultipart<DataSourceResponse>("/api/data-sources", form);
  }

  /** Create a `rest_api` data source. The backend attempts an initial fetch at
   *  creation time; on success it returns the auto-created companion DataType,
   *  on failure it returns `dataType: null` + `fetchError` (not an opaque
   *  failure) so the agent can diagnose and retry. Credentials (bearer token /
   *  api-key value) are redacted server-side before this response is built —
   *  never echoed back raw. */
  async createRestDataSource(input: {
    name: string;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    auth?: RestAuthInput;
  }): Promise<CreateSourceResult> {
    const raw = await this.http.post<RawCreateSourceResponse>("/api/sources", {
      name: input.name,
      type: "rest_api",
      config: {
        url: input.url,
        method: input.method,
        headers: input.headers,
        auth: input.auth,
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

  createPipeline(input: {
    name: string;
    sourceDataSourceId: string;
    outputDataTypeName: string;
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
    };
  }

  createDashboard(input: { name: string }): Promise<DashboardResponse> {
    return this.http.post<DashboardResponse>("/api/dashboards", input);
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

  // ── Delete ────────────────────────────────────────────────────────────────
  //
  // Every delete endpoint answers `204 No Content` (the backend's
  // `ServiceResponse.runNoContent`), so there is no body to return; each
  // wrapper resolves to a small `{ deleted: true, id }` acknowledgement so the
  // MCP tool result is not an empty string. Deletion is permanent — the backend
  // is owner-scoped (a non-owner gets 403, an unknown id 404, surfaced verbatim
  // by the tool's guarded handler). Cascades are FK-enforced in PostgreSQL.

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
}
