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
  CsvPreview,
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
  RowsPreview,
  RunResultResponse,
} from "./types.js";

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

  createPanel(input: {
    dashboardId: string;
    title?: string;
    type?: string;
    config?: Record<string, unknown>;
  }): Promise<PanelResponse> {
    return this.http.post<PanelResponse>("/api/panels", input);
  }

  /** Bind a data panel (metric/chart/table) to a pipeline-output DataType.
   *  PATCHes `config: { dataTypeId, fieldMapping }`. The backend rejects a
   *  companion-DataType binding with 400 (V41 pipeline-only rule) — that error
   *  is surfaced to the caller, never worked around. */
  bindPanel(
    panelId: string,
    binding: { dataTypeId: string; fieldMapping: Record<string, string>; panelType?: string },
  ): Promise<PanelResponse> {
    const body: Record<string, unknown> = {
      config: { dataTypeId: binding.dataTypeId, fieldMapping: binding.fieldMapping },
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
}
