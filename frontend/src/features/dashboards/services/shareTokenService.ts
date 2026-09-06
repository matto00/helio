// HEL-590 -- HTTP wrapper for `/api/dashboards/:id/share-tokens` (create/list/revoke).

import { httpClient } from "../../../services/httpClient";
import type {
  CreateShareTokenRequest,
  CreateShareTokenResponse,
  ShareTokenResponse,
} from "../types/shareToken";

/** spray-json's default `Option` formatter omits `None` fields entirely rather than serializing
 *  `null` (documented codebase gotcha, see `apiTokenService.ts`'s `normalizeApiToken`) --
 *  `expiresAt`/`revokedAt` arrive with the key absent, not `null`, when unset. Normalize here so
 *  `DashboardShareDialog.tsx` never has to special-case `undefined` vs `null`. */
function normalizeShareToken(token: ShareTokenResponse): ShareTokenResponse {
  return {
    ...token,
    expiresAt: token.expiresAt ?? null,
    revokedAt: token.revokedAt ?? null,
  };
}

function normalizeCreateShareTokenResponse(
  response: CreateShareTokenResponse,
): CreateShareTokenResponse {
  return { ...response, expiresAt: response.expiresAt ?? null };
}

/** `GET /api/dashboards/:id/share-tokens` -- every share token minted for this dashboard,
 *  metadata only (never the raw secret). The backend wraps the list in `{ items: [...] }`
 *  (`ShareTokensResponse`, mirroring `PermissionsResponse`'s shape), not a bare array. */
export async function listShareTokens(dashboardId: string): Promise<ShareTokenResponse[]> {
  const response = await httpClient.get<{ items: ShareTokenResponse[] }>(
    `/api/dashboards/${dashboardId}/share-tokens`,
  );
  return response.data.items.map(normalizeShareToken);
}

/** `POST /api/dashboards/:id/share-tokens` -- mints a token, optionally with an expiry. The
 *  response carries the raw token value -- the only place it ever appears on the wire -- for the
 *  caller's one-time reveal. */
export async function createShareToken(
  dashboardId: string,
  request: CreateShareTokenRequest,
): Promise<CreateShareTokenResponse> {
  const response = await httpClient.post<CreateShareTokenResponse>(
    `/api/dashboards/${dashboardId}/share-tokens`,
    request,
  );
  return normalizeCreateShareTokenResponse(response.data);
}

/** `DELETE /api/dashboards/:id/share-tokens/:tokenId` -- revokes a token immediately. */
export async function revokeShareToken(dashboardId: string, tokenId: string): Promise<void> {
  await httpClient.delete(`/api/dashboards/${dashboardId}/share-tokens/${tokenId}`);
}
