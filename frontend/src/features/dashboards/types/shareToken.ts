// HEL-590 -- wire types for `/api/dashboards/:id/share-tokens` (create/list/revoke).
// Mirrors the backend's `ShareTokenResponse`/`CreateShareTokenResponse` (schemas/dashboards/).

export interface ShareTokenResponse {
  id: string;
  dashboardId: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateShareTokenRequest {
  expiresAt?: string;
}

export interface CreateShareTokenResponse {
  id: string;
  dashboardId: string;
  token: string;
  expiresAt: string | null;
  createdAt: string;
}
