import type { DataSource, DataType, InferredField } from "../types/models";
import { httpClient } from "./httpClient";

interface DataSourcesResponse {
  items: DataSource[];
}

interface CreateSourceResponse {
  source: DataSource;
  dataType: DataType | null;
  fetchError: string | null;
}

interface RestApiConfig {
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
  const response = await httpClient.get<DataSourcesResponse>("/api/data-sources");
  return response.data.items;
}

export async function createRestSource(
  name: string,
  config: RestApiConfig,
  fieldOverrides?: FieldOverride[],
): Promise<CreateSourceResponse> {
  const response = await httpClient.post<CreateSourceResponse>("/api/sources", {
    name,
    sourceType: "rest_api",
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

export async function deleteSource(sourceId: string): Promise<void> {
  await httpClient.delete(`/api/data-sources/${sourceId}`);
}

export async function refreshSource(sourceId: string, sourceType: string): Promise<DataType> {
  const base = sourceType === "rest_api" ? "/api/sources" : "/api/data-sources";
  const response = await httpClient.post<DataType>(`${base}/${sourceId}/refresh`);
  return response.data;
}

export async function inferFromJson(config: RestApiConfig): Promise<InferredField[]> {
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

export interface CsvPreviewResponse {
  headers: string[];
  rows: string[][];
}

export interface RestPreviewResponse {
  rows: Record<string, unknown>[];
}

export async function fetchCsvPreview(sourceId: string): Promise<CsvPreviewResponse> {
  const response = await httpClient.get<CsvPreviewResponse>(
    `/api/data-sources/${sourceId}/preview`,
  );
  return response.data;
}

export async function fetchRestPreview(sourceId: string): Promise<RestPreviewResponse> {
  const response = await httpClient.get<RestPreviewResponse>(`/api/sources/${sourceId}/preview`);
  return response.data;
}
