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
  PipelineAnalyzeResponse,
  PipelineStepResponse,
  PipelineSummaryResponse,
  RowsPreview,
} from "./types.js";

const CSV_LIKE_TYPES = new Set(["csv", "static"]);

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
}
