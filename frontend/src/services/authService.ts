import type { AuthResponse, UpdateUserPreferenceRequest, User } from "../types/models";
import { httpClient } from "./httpClient";

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

export async function logoutRequest(token: string): Promise<void> {
  await httpClient.post("/api/auth/logout", {}, { headers: { Authorization: `Bearer ${token}` } });
}

export async function getMeRequest(): Promise<User> {
  const response = await httpClient.get<User>("/api/auth/me");
  return response.data;
}

export async function updateUserPreferencesRequest(
  request: UpdateUserPreferenceRequest,
): Promise<void> {
  await httpClient.patch("/api/users/me/update", request);
}

export async function oauthCallbackRequest(code: string, state?: string): Promise<AuthResponse> {
  const params: Record<string, string> = { code };
  if (state !== undefined) {
    params.state = state;
  }
  const response = await httpClient.get<AuthResponse>("/api/auth/google/callback", { params });
  return response.data;
}
