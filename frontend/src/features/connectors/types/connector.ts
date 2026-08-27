// HEL-824: types for the Connectors CRUD UI. Mirrors the backend wire shape
// (`ConnectorMeta`/`CreateConnectorRequest`/`UpdateConnectorRequest`/
// `RotateConnectorCredentialRequest`, `backend/src/main/scala/com/helio/api/
// protocols/sources/ConnectorEntityProtocol.scala`) field-for-field.

/** Auth-type vocabulary mirrored from `RestApiAuth`'s existing union
 *  (`frontend/src/features/sources/ui/forms/RestApiForm.tsx`) — REST is the
 *  first and only kind at launch, but this type intentionally lives under
 *  `features/connectors/`, not re-exported from `features/sources/`, so a
 *  future SQL/S3/GCS/BigQuery/Sheets connector kind doesn't have to retrofit
 *  this module's shape. */
export type ConnectorAuthType = "none" | "bearer" | "api_key";

export type ApiKeyPlacement = "header" | "query";

export interface ConnectorConfig {
  authType: ConnectorAuthType;
  /** Header or query-param name the api_key credential is attached under. */
  apiKeyName?: string;
  apiKeyPlacement?: ApiKeyPlacement;
  /** Server-owned (HEL-822 design.md Decision 1a revised) — a synthesized
   *  Connector from the legacy bare-`url` dual-support create path. Never
   *  client-settable; present here only to read and badge it. */
  implicit?: boolean;
  [key: string]: unknown;
}

/** A saved, reusable, owner-scoped credentialed host — the wire shape for
 *  `ConnectorMeta`. Structurally incapable of carrying the credential value
 *  itself, same as its backend counterpart. */
export interface Connector {
  id: string;
  ownerId: string;
  name: string;
  kind: string;
  baseUrl: string;
  config: ConnectorConfig;
  createdAt: string;
  updatedAt: string;
  /** HEL-824 design.md Decision 1b — always present, computed server-side. */
  dependentCount: number;
}

export interface CreateConnectorRequest {
  name: string;
  kind: string;
  baseUrl: string;
  config?: ConnectorConfig;
  credential: string;
}

export interface UpdateConnectorRequest {
  name?: string;
  baseUrl?: string;
  config?: ConnectorConfig;
}

export interface RotateConnectorCredentialRequest {
  credential: string;
}
