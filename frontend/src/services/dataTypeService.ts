import type { ComputedField, DataType, DataTypeField } from "../types/models";
import { httpClient } from "./httpClient";

interface DataTypesResponse {
  items: DataType[];
}

export async function fetchDataTypes(): Promise<DataType[]> {
  const response = await httpClient.get<DataTypesResponse>("/api/types");
  return response.data.items;
}

export async function updateDataType(
  id: string,
  fields: DataTypeField[],
  computedFields?: ComputedField[],
): Promise<DataType> {
  const response = await httpClient.patch<DataType>(`/api/types/${id}`, {
    fields,
    ...(computedFields !== undefined ? { computedFields } : {}),
  });
  return response.data;
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
