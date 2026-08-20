// HEL-727 -- HTTP wrapper for `/api/tokens` (create/list/revoke, HEL-148).
// Kept separate from `settingsService.ts` (design.md decision): this is the
// only Settings sub-feature backed by a distinct top-level route prefix
// (`/api/tokens`, not `/api/preferences`/`/api/agent/memory`), the same
// reasoning that already put the MFA HTTP calls in `authService.ts` rather
// than here.

import { httpClient } from "../../../services/httpClient";
import type {
  ApiTokenResponse,
  CreateApiTokenRequest,
  CreateApiTokenResponse,
} from "../types/apiToken";

/** spray-json's default `Option` formatter omits `None` fields from the wire
 *  entirely rather than serializing `null` (documented codebase gotcha, see
 *  `settingsService.ts`'s `normalizePreferences`) -- `lastUsedAt`/`expiresAt`
 *  (both `Option[Instant]` on the backend) arrive with the key absent, not
 *  `null`, for a never-used / non-expiring token. Normalize here, at the
 *  service boundary, so `ApiTokensSection.tsx` never has to special-case
 *  `undefined` vs `null`. */
function normalizeApiToken(token: ApiTokenResponse): ApiTokenResponse {
  return {
    ...token,
    lastUsedAt: token.lastUsedAt ?? null,
    expiresAt: token.expiresAt ?? null,
  };
}

function normalizeCreateApiTokenResponse(response: CreateApiTokenResponse): CreateApiTokenResponse {
  return { ...response, expiresAt: response.expiresAt ?? null };
}

/** `GET /api/tokens` -- every PAT owned by the caller, metadata only (never
 *  the raw token or its hash). */
export async function listApiTokens(): Promise<ApiTokenResponse[]> {
  const response = await httpClient.get<ApiTokenResponse[]>("/api/tokens");
  return response.data.map(normalizeApiToken);
}

/** `POST /api/tokens` -- creates a named token. The response carries the raw
 *  token value -- the only place it ever appears on the wire -- for the
 *  caller's one-time reveal. */
export async function createApiToken(
  request: CreateApiTokenRequest,
): Promise<CreateApiTokenResponse> {
  const response = await httpClient.post<CreateApiTokenResponse>("/api/tokens", request);
  return normalizeCreateApiTokenResponse(response.data);
}

/** `DELETE /api/tokens/:id` -- revokes a token immediately. */
export async function revokeApiToken(id: string): Promise<void> {
  await httpClient.delete(`/api/tokens/${id}`);
}
