import type { DataType, DataTypeField } from "../types/models";
import { httpClient } from "./httpClient";

interface DataTypesResponse {
  items: DataType[];
}

export async function fetchDataTypes(): Promise<DataType[]> {
  const response = await httpClient.get<DataTypesResponse>("/api/types");
  return response.data.items;
}

export async function updateDataType(id: string, fields: DataTypeField[]): Promise<DataType> {
  const response = await httpClient.patch<DataType>(`/api/types/${id}`, { fields });
  return response.data;
}
