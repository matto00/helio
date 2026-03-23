import type { DataType } from "../types/models";
import { httpClient } from "./httpClient";

interface DataTypesResponse {
  items: DataType[];
}

export async function fetchDataTypes(): Promise<DataType[]> {
  const response = await httpClient.get<DataTypesResponse>("/api/datatypes");
  return response.data.items;
}
