// Auth domain types — extracted from `types/models.ts` as part of CS4 cycle 1
// to colocate types with their feature folder.

export interface UserPreferences {
  accentColor: string | null;
  zoomLevels: Record<string, number>;
}

// HEL-703: gates chat/assistant access — `free` (default) is denied every assistant endpoint,
// `beta` is capped per UTC day, `owner` is unlimited. Rides every existing user payload
// (register/login/OAuth/GET /api/auth/me) via the backend's UserResponse.
export type UserTier = "free" | "beta" | "owner";

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  preferences?: UserPreferences;
  tier: UserTier;
}

// HEL-287 CodeQL #8: the session token is delivered via an HttpOnly
// `Set-Cookie` header, never in this response body.
export interface AuthResponse {
  expiresAt: string;
  user: User;
}

export interface UserPreferencePayload {
  zoomLevel?: number;
  accentColor?: string;
  dashboardId?: string;
}

export interface UpdateUserPreferenceRequest {
  fields: string[];
  user: UserPreferencePayload;
}

/** Returned by `POST /api/auth/login` / `GET /api/auth/google/callback` in
 *  place of `AuthResponse` when the account has MFA enabled (design.md D3/D5)
 *  — no session cookie is set and no user object is returned. */
export interface MfaRequiredResponse {
  mfaRequired: true;
  challengeToken: string;
}

/** Either primary-auth path can now return this union once MFA can gate
 *  session establishment (HEL-702). */
export type LoginResult = AuthResponse | MfaRequiredResponse;

/** `GET /api/auth/mfa`. */
export interface MfaStatusResponse {
  enabled: boolean;
  verifiedAt: string | null;
  backupCodesRemaining: number;
}

/** `POST /api/auth/mfa/enroll` — a fresh, unconfirmed secret + otpauth URI. */
export interface MfaEnrollResponse {
  secret: string;
  otpauthUri: string;
}

/** `POST /api/auth/mfa/enroll/confirm` and `.../backup-codes/regenerate` —
 *  plaintext codes, returned exactly once. */
export interface MfaBackupCodesResponse {
  backupCodes: string[];
}
