import type { DataType } from "../../dataTypes/types/dataType";
import type {
  DataSource,
  DataSourceKind,
  InferredField,
  SqlSourceConfig,
  StaticColumn,
} from "../types/dataSource";
import type { PagedResult } from "../../../types/models";
import { httpClient } from "../../../services/httpClient";

// Re-export so existing call sites that imported `SqlSourceConfig` from this
// module (back when the type lived here) keep compiling unchanged.
export type { SqlSourceConfig } from "../types/dataSource";

interface CreateSourceResponse {
  source: DataSource;
  dataType: DataType | null;
  fetchError: string | null;
}

// Wire shape for REST connector config in inference / create-source bodies.
// Backend `RestApiConfigPayload` allows `method` / `auth` / `headers` to be
// optional and adds a `jsonPath` extension used by the AddSourceModal flow.
export interface RestApiConfigBody {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  jsonPath?: string;
  auth?: object;
}

interface FieldOverride {
  name: string;
  displayName: string;
  dataType: string;
}

interface InferredSchemaResponse {
  fields: InferredField[];
}

export async function fetchSources(): Promise<DataSource[]> {
  const response = await httpClient.get<PagedResult<DataSource>>("/api/data-sources");
  return response.data.items;
}

export async function createRestSource(
  name: string,
  config: RestApiConfigBody,
  fieldOverrides?: FieldOverride[],
): Promise<CreateSourceResponse> {
  const response = await httpClient.post<CreateSourceResponse>("/api/sources", {
    name,
    type: "rest_api",
    config,
    fieldOverrides,
  });
  return response.data;
}

export async function createCsvSource(
  name: string,
  file: File,
  fieldOverrides?: FieldOverride[],
): Promise<DataSource> {
  const formData = new FormData();
  formData.append("name", name);
  formData.append("file", file);
  if (fieldOverrides && fieldOverrides.length > 0) {
    formData.append("fields", JSON.stringify(fieldOverrides));
  }
  const response = await httpClient.post<DataSource>("/api/data-sources", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function createStaticSource(
  name: string,
  columns: StaticColumn[],
  rows: unknown[][],
): Promise<DataSource> {
  const response = await httpClient.post<DataSource>("/api/data-sources", {
    name,
    type: "static",
    columns,
    rows,
  });
  return response.data;
}

// HEL-215: plain text / Markdown connector — file upload and URL-based
// ingestion, mirroring the CSV / REST create paths respectively.
export async function createTextSourceUpload(name: string, file: File): Promise<DataSource> {
  const formData = new FormData();
  formData.append("name", name);
  formData.append("type", "text");
  formData.append("file", file);
  const response = await httpClient.post<DataSource>("/api/data-sources", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function createTextSourceUrl(name: string, url: string): Promise<DataSource> {
  const response = await httpClient.post<DataSource>("/api/data-sources", {
    name,
    type: "text",
    config: { url },
  });
  return response.data;
}

export async function deleteSource(sourceId: string): Promise<void> {
  await httpClient.delete(`/api/data-sources/${sourceId}`);
}

export async function refreshSource(sourceId: string, kind: DataSourceKind): Promise<DataType> {
  const base = kind === "rest_api" || kind === "sql" ? "/api/sources" : "/api/data-sources";
  const response = await httpClient.post<DataType>(`${base}/${sourceId}/refresh`);
  return response.data;
}

export async function inferFromJson(config: RestApiConfigBody): Promise<InferredField[]> {
  const response = await httpClient.post<InferredSchemaResponse>("/api/sources/infer", config);
  return response.data.fields;
}

export async function inferFromCsv(file: File): Promise<InferredField[]> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await httpClient.post<InferredSchemaResponse>(
    "/api/data-sources/infer",
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
    },
  );
  return response.data.fields;
}

export async function inferSqlSource(config: SqlSourceConfig): Promise<InferredField[]> {
  const response = await httpClient.post<InferredSchemaResponse>("/api/sources/infer", {
    type: "sql",
    config,
  });
  return response.data.fields;
}

export async function createSqlSource(
  name: string,
  config: SqlSourceConfig,
): Promise<CreateSourceResponse> {
  const response = await httpClient.post<CreateSourceResponse>("/api/sources", {
    name,
    type: "sql",
    config,
  });
  return response.data;
}

export interface CsvPreviewResponse {
  headers: string[];
  rows: string[][];
}

export interface RestPreviewResponse {
  rows: Record<string, unknown>[];
}

export async function fetchCsvPreview(
  sourceId: string,
  limit?: number,
): Promise<CsvPreviewResponse> {
  const url = limit
    ? `/api/data-sources/${sourceId}/preview?limit=${limit}`
    : `/api/data-sources/${sourceId}/preview`;
  const response = await httpClient.get<CsvPreviewResponse>(url);
  return response.data;
}

export async function fetchRestPreview(sourceId: string): Promise<RestPreviewResponse> {
  const response = await httpClient.get<RestPreviewResponse>(`/api/sources/${sourceId}/preview`);
  return response.data;
}

export async function updateSource(sourceId: string, name: string): Promise<DataSource> {
  const response = await httpClient.patch<DataSource>(`/api/data-sources/${sourceId}`, { name });
  return response.data;
}
