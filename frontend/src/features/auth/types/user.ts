import type { DashboardTabsWire } from "../../dashboards/tabs/tabTypes";

// Auth domain types — extracted from `types/models.ts` as part of CS4 cycle 1
// to colocate types with their feature folder.

import type { Density, Motion, TypeStyle } from "../../../theme/appearancePrefs";

export interface UserPreferences {
  accentColor: string | null;
  zoomLevels: Record<string, number>;
  /** HEL-1574: context-list width in px (200..400). Absent until the user first sets it. */
  contextListWidth?: number;
  /** HEL-1574: context list collapsed to rail-only. Absent until the user first sets it. */
  contextListCollapsed?: boolean;
  /** HEL-1572: absent until the user first sets it (the client then uses Sans + mono). */
  typeStyle?: TypeStyle;
  /** HEL-1572: absent until the user first sets it (the client then uses Comfortable). */
  density?: Density;
  /** HEL-1572: absent = follow the OS reduce-motion setting. */
  motion?: Motion;
  /** HEL-1575: the saved open-tab set. Absent until the user first opens a tab; the server omits unset
   *  `lastViewedAt`/`ownWriteAt`/`activeId`, so every one of those may be missing (normalise on read). */
  dashboardTabs?: DashboardTabsWire;
}

/** Body of `PATCH /api/users/me/preferences`: any non-empty subset. */
export interface ShellPreferencesPatch {
  contextListWidth?: number;
  contextListCollapsed?: boolean;
}

/** HEL-1572: the appearance keys of the same endpoint. `motion: null` clears the saved choice (follow the OS). */
export interface AppearancePreferencesPatch {
  typeStyle?: TypeStyle;
  density?: Density;
  motion?: Motion | null;
}

/** The whole `PATCH /api/users/me/preferences` body. */
export type PreferencesPatch = ShellPreferencesPatch & AppearancePreferencesPatch;

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
