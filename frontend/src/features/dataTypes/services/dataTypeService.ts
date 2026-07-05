import type { ComputedField, DataType, DataTypeField } from "../types/dataType";
import type { PagedResult } from "../../../types/models";
import { httpClient } from "../../../services/httpClient";

/** Wire shape of a DataType: the backend serializes `sourceId: Option[String]`
 *  with spray-json, which omits the field entirely when it is `None` —
 *  pipeline-output types arrive without a `sourceId` key at all. */
type DataTypeWire = Omit<DataType, "sourceId"> & { sourceId?: string | null };

/** Normalize an absent `sourceId` to `null` so the store always satisfies the
 *  declared `sourceId: string | null` contract and `=== null` checks
 *  (e.g. `selectPipelineOutputDataTypes`) hold against real API responses. */
function normalizeDataType(wire: DataTypeWire): DataType {
  return { ...wire, sourceId: wire.sourceId ?? null };
}

export async function fetchDataTypes(): Promise<DataType[]> {
  const response = await httpClient.get<PagedResult<DataTypeWire>>("/api/types");
  return response.data.items.map(normalizeDataType);
}

export async function updateDataType(
  id: string,
  fields: DataTypeField[],
  computedFields?: ComputedField[],
  name?: string,
): Promise<DataType> {
  const response = await httpClient.patch<DataTypeWire>(`/api/types/${id}`, {
    ...(name !== undefined ? { name } : {}),
    fields,
    ...(computedFields !== undefined ? { computedFields } : {}),
  });
  return normalizeDataType(response.data);
}

export interface ValidateExpressionResult {
  valid: boolean;
  message?: string;
}

export async function validateExpression(
  typeId: string,
  expr: string,
): Promise<ValidateExpressionResult> {
  const response = await httpClient.get<ValidateExpressionResult>(
    `/api/types/${typeId}/validate-expression`,
    { params: { expr } },
  );
  return response.data;
}

export interface DataTypeRowsResponse {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export async function fetchDataTypeRows(id: string): Promise<DataTypeRowsResponse> {
  const response = await httpClient.get<DataTypeRowsResponse>(`/api/types/${id}/rows`);
  return response.data;
}

export async function deleteDataType(id: string): Promise<void> {
  await httpClient.delete(`/api/types/${id}`);
}
