// HEL-824: `/api/connectors` (HEL-821 entity CRUD) — distinct from
// `features/sources/services/connectorService.ts`'s `GET /api/connector-types`
// metadata registry, same distinction the backend keeps between
// `ConnectorEntityRoutes` and `ConnectorRoutes`.

import { httpClient } from "../../../services/httpClient";
import type {
  Connector,
  CreateConnectorRequest,
  RotateConnectorCredentialRequest,
  UpdateConnectorRequest,
} from "../types/connector";

interface ConnectorsResponse {
  items: Connector[];
}

export async function fetchConnectors(): Promise<Connector[]> {
  const response = await httpClient.get<ConnectorsResponse>("/api/connectors");
  return response.data.items;
}

export async function createConnector(request: CreateConnectorRequest): Promise<Connector> {
  const response = await httpClient.post<Connector>("/api/connectors", request);
  return response.data;
}

export async function updateConnector(
  id: string,
  request: UpdateConnectorRequest,
): Promise<Connector> {
  const response = await httpClient.patch<Connector>(`/api/connectors/${id}`, request);
  return response.data;
}

export async function deleteConnector(id: string): Promise<void> {
  await httpClient.delete(`/api/connectors/${id}`);
}

export async function rotateConnectorCredential(
  id: string,
  request: RotateConnectorCredentialRequest,
): Promise<Connector> {
  const response = await httpClient.put<Connector>(`/api/connectors/${id}/credential`, request);
  return response.data;
}
