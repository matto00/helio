import type {
  AuthResponse,
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

export async function loginRequest(payload: LoginPayload): Promise<AuthResponse> {
  const response = await httpClient.post<AuthResponse>("/api/auth/login", payload);
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

export async function oauthCallbackRequest(code: string, state?: string): Promise<AuthResponse> {
  const params: Record<string, string> = { code };
  if (state !== undefined) {
    params.state = state;
  }
  const response = await httpClient.get<AuthResponse>("/api/auth/google/callback", { params });
  return response.data;
}
