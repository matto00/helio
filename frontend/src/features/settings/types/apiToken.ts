// HEL-727 -- mirrors the backend's `ApiTokenResponse` / `CreateApiTokenRequest`
// / `CreateApiTokenResponse` (`ApiTokenProtocol.scala`, HEL-148) field-for-field
// for the fields this UI actually surfaces. `lastUsedAt`/`expiresAt` are
// `Option[Instant]` on the backend; `apiTokenService.ts` normalizes an absent
// (spray-json omits `None`) field to `null` at the service boundary so these
// declared `| null` types stay accurate to what callers actually receive
// (mirrors `settingsService.ts`'s `normalizePreferences` precedent).
//
// `scopedPipelineIds` (HEL-369, both request and response) is deliberately
// omitted here: this UI never sends or displays it (design.md non-goals --
// no pipeline-scoping UI). A token created from this UI is always unscoped.

export interface ApiTokenResponse {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

/** `POST /api/tokens` request body. Only `name` is required on the backend;
 *  this UI never sends `expiresInDays`/`scopedPipelineIds` (design.md
 *  non-goals), so neither is modeled here -- a token created from this UI is
 *  always non-expiring and unscoped, matching the backend's field defaults. */
export interface CreateApiTokenRequest {
  name: string;
}

/** The ONLY response shape that ever carries the raw token -- returned once,
 *  at creation. `settingsSlice.ts`'s `createApiTokenThunk.fulfilled` reducer
 *  is the only place this type's `token` field is read. */
export interface CreateApiTokenResponse {
  id: string;
  name: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
}
