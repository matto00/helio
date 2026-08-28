import type {
  AuthResponse,
  LoginResult,
  MfaBackupCodesResponse,
  MfaEnrollResponse,
  MfaStatusResponse,
  UpdateUserPreferenceRequest,
  User,
  UserPreferences,
} from "../types/user";
import { httpClient } from "../../../services/httpClient";

interface LoginPayload {
  email: string;
  password: string;
}

interface RegisterPayload {
  email: string;
  password: string;
  displayName?: string;
}

export async function loginRequest(payload: LoginPayload): Promise<LoginResult> {
  const response = await httpClient.post<LoginResult>("/api/auth/login", payload);
  return response.data;
}

export async function registerRequest(payload: RegisterPayload): Promise<AuthResponse> {
  const response = await httpClient.post<AuthResponse>("/api/auth/register", payload);
  return response.data;
}

export async function logoutRequest(): Promise<void> {
  // HEL-287: session identity is the `helio_session` cookie (httpClient sets
  // withCredentials: true), so no token needs to be passed/attached here.
  await httpClient.post("/api/auth/logout");
}

export async function getMeRequest(): Promise<User> {
  const response = await httpClient.get<User>("/api/auth/me");
  return response.data;
}

export async function updateUserPreferencesRequest(
  request: UpdateUserPreferenceRequest,
): Promise<UserPreferences> {
  const response = await httpClient.patch<{ preferences: UserPreferences }>(
    "/api/users/me/update",
    request,
  );
  return response.data.preferences;
}

export async function oauthCallbackRequest(code: string, state?: string): Promise<LoginResult> {
  const params: Record<string, string> = { code };
  if (state !== undefined) {
    params.state = state;
  }
  const response = await httpClient.get<LoginResult>("/api/auth/google/callback", { params });
  return response.data;
}

/** spray-json omits `Option`-typed fields entirely when `None` rather than
 *  serializing `null` (documented codebase gotcha, see `settingsService.ts`'s
 *  `normalizePreferences`) — `verifiedAt: Option[Instant]` on the backend
 *  arrives as an absent key, not `null`, when unset. Normalize at the service
 *  boundary so `MfaStatusResponse`'s declared `| null` type stays accurate. */
interface MfaStatusWire {
  enabled: boolean;
  verifiedAt?: string;
  backupCodesRemaining: number;
}

function normalizeMfaStatus(wire: MfaStatusWire): MfaStatusResponse {
  return {
    enabled: wire.enabled,
    verifiedAt: wire.verifiedAt ?? null,
    backupCodesRemaining: wire.backupCodesRemaining,
  };
}

/** `GET /api/auth/mfa` — the acting user's MFA enrollment state. */
export async function mfaStatusRequest(): Promise<MfaStatusResponse> {
  const response = await httpClient.get<MfaStatusWire>("/api/auth/mfa");
  return normalizeMfaStatus(response.data);
}

/** `POST /api/auth/mfa/enroll` — 409 if already enabled; otherwise a fresh,
 *  unconfirmed secret + otpauth URI for QR rendering. */
export async function mfaEnrollRequest(): Promise<MfaEnrollResponse> {
  const response = await httpClient.post<MfaEnrollResponse>("/api/auth/mfa/enroll");
  return response.data;
}

/** `POST /api/auth/mfa/enroll/confirm` — proves the authenticator app is set
 *  up; enables MFA and returns a fresh set of backup codes, plaintext, once. */
export async function mfaConfirmRequest(code: string): Promise<MfaBackupCodesResponse> {
  const response = await httpClient.post<MfaBackupCodesResponse>("/api/auth/mfa/enroll/confirm", {
    code,
  });
  return response.data;
}

/** `POST /api/auth/mfa/backup-codes/regenerate` — re-auth with a current
 *  TOTP/backup code; replaces the set. */
export async function mfaRegenerateRequest(code: string): Promise<MfaBackupCodesResponse> {
  const response = await httpClient.post<MfaBackupCodesResponse>(
    "/api/auth/mfa/backup-codes/regenerate",
    { code },
  );
  return response.data;
}

/** `POST /api/auth/mfa/disable` — re-auth with a current TOTP/backup code;
 *  deletes the enrollment and all backup codes. */
export async function mfaDisableRequest(code: string): Promise<void> {
  await httpClient.post("/api/auth/mfa/disable", { code });
}

/** `POST /api/auth/mfa/verify` (public — no session cookie exists yet) —
 *  exchanges a pending-login challenge plus a TOTP or backup code for a
 *  session, identical in shape to `loginRequest`'s success response. */
export async function mfaVerifyRequest(
  challengeToken: string,
  code: string,
): Promise<AuthResponse> {
  const response = await httpClient.post<AuthResponse>("/api/auth/mfa/verify", {
    challengeToken,
    code,
  });
  return response.data;
}
