import { httpClient } from "../../../services/httpClient";

// HEL-484: GET /api/connectors — the registry of connector kinds, driving
// SourceTypeToggle and (via helio-mcp) the agent's list_connectors tool.

export interface ConnectorFieldDescriptor {
  name: string;
  label: string;
  secret: boolean;
}

export interface ConnectorMetadata {
  kind: string;
  displayName: string;
  supportsIncremental: boolean;
  authKind: string;
  requiredFields: ConnectorFieldDescriptor[];
}

export async function listConnectors(): Promise<ConnectorMetadata[]> {
  const response = await httpClient.get<ConnectorMetadata[]>("/api/connectors");
  return response.data;
}
