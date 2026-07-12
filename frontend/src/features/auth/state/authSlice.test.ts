import { configureStore } from "@reduxjs/toolkit";

import * as authService from "../services/authService";
import { applyAccentTokens } from "../../../theme/appearance";
import type { AuthResponse, User } from "../types/user";
import {
  authReducer,
  clearAuth,
  handleOAuthCallback,
  login,
  logout,
  rehydrateAuth,
  setAuth,
  updateUserPreferences,
} from "./authSlice";

jest.mock("../services/authService");
jest.mock("../../../theme/appearance");

const mockedAuthService = jest.mocked(authService);
const mockedApplyAccentTokens = jest.mocked(applyAccentTokens);

const testUser: User = {
  id: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
};

// HEL-287 CodeQL #8: AuthResponse no longer carries a token — the session
// identity is delivered via an HttpOnly `Set-Cookie` header, not this body.
const testAuthResponse: AuthResponse = {
  expiresAt: "2026-12-31T00:00:00Z",
  user: testUser,
};

function makeStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

describe("authSlice reducers", () => {
  it("setAuth sets user and status to authenticated", () => {
    const state = authReducer(undefined, setAuth({ user: testUser }));
    expect(state.currentUser).toEqual(testUser);
    expect(state.status).toBe("authenticated");
  });

  it("clearAuth clears user and sets status to unauthenticated", () => {
    const preloaded = authReducer(undefined, setAuth({ user: testUser }));
    const state = authReducer(preloaded, clearAuth());
    expect(state.currentUser).toBeNull();
    expect(state.status).toBe("unauthenticated");
  });
});

describe("rehydrateAuth thunk", () => {
  // HEL-287: identity is the httpOnly `helio_session` cookie (attaches
  // automatically via httpClient's withCredentials) — rehydrateAuth calls
  // GET /api/auth/me unconditionally and lets the response decide the
  // outcome; there is no sessionStorage token to gate the call on.

  it("sets unauthenticated when getMeRequest rejects (no valid session cookie)", async () => {
    mockedAuthService.getMeRequest.mockRejectedValue(new Error("401"));

    const store = makeStore();
    await store.dispatch(rehydrateAuth());

    expect(store.getState().auth.status).toBe("unauthenticated");
    expect(store.getState().auth.currentUser).toBeNull();
  });

  it("sets authenticated when getMeRequest succeeds (valid session cookie)", async () => {
    mockedAuthService.getMeRequest.mockResolvedValue(testUser);

    const store = makeStore();
    await store.dispatch(rehydrateAuth());

    expect(store.getState().auth.status).toBe("authenticated");
    expect(store.getState().auth.currentUser).toEqual(testUser);
  });
});

describe("login thunk", () => {
  it("sets authenticated state on successful login", async () => {
    mockedAuthService.loginRequest.mockResolvedValue(testAuthResponse);
    const store = makeStore();

    await store.dispatch(login({ email: "test@example.com", password: "pass1234" }));

    expect(store.getState().auth.status).toBe("authenticated");
    expect(store.getState().auth.currentUser).toEqual(testUser);
  });

  it("sets unauthenticated status on login failure", async () => {
    const axiosError = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: { data: { message: "Invalid email or password" } },
    });
    mockedAuthService.loginRequest.mockRejectedValue(axiosError);
    const store = makeStore();

    const result = await store.dispatch(login({ email: "x@x.com", password: "wrong" }));

    expect(login.rejected.match(result)).toBe(true);
    expect(result.payload).toBe("Invalid email or password");
    expect(store.getState().auth.status).toBe("unauthenticated");
  });
});

describe("logout thunk", () => {
  it("clears auth state regardless of logoutRequest outcome", async () => {
    mockedAuthService.loginRequest.mockResolvedValue(testAuthResponse);
    mockedAuthService.logoutRequest.mockResolvedValue(undefined);

    const store = makeStore();
    await store.dispatch(login({ email: "test@example.com", password: "pass1234" }));
    expect(store.getState().auth.status).toBe("authenticated");

    await store.dispatch(logout());

    expect(store.getState().auth.status).toBe("unauthenticated");
    expect(store.getState().auth.currentUser).toBeNull();
    // HEL-287: logout no longer reads a token from state or passes one to
    // logoutRequest — the session cookie identifies which session to clear.
    expect(mockedAuthService.logoutRequest).toHaveBeenCalledWith();
  });

  it("still clears auth state even when logoutRequest throws", async () => {
    mockedAuthService.loginRequest.mockResolvedValue(testAuthResponse);
    mockedAuthService.logoutRequest.mockRejectedValue(new Error("network error"));

    const store = makeStore();
    await store.dispatch(login({ email: "test@example.com", password: "pass1234" }));

    await store.dispatch(logout());

    expect(store.getState().auth.status).toBe("unauthenticated");
    expect(store.getState().auth.currentUser).toBeNull();
  });
});

describe("handleOAuthCallback thunk", () => {
  it("sets authenticated state on successful OAuth callback", async () => {
    const oauthUser: User = {
      id: "google-user-1",
      email: "google@example.com",
      displayName: "Google User",
      avatarUrl: "https://example.com/avatar.jpg",
      createdAt: "2026-01-01T00:00:00Z",
    };
    const oauthResponse: AuthResponse = {
      expiresAt: "2026-12-31T00:00:00Z",
      user: oauthUser,
    };
    mockedAuthService.oauthCallbackRequest.mockResolvedValue(oauthResponse);

    const store = makeStore();
    const result = await store.dispatch(handleOAuthCallback({ code: "auth-code-123" }));

    expect(handleOAuthCallback.fulfilled.match(result)).toBe(true);
    expect(store.getState().auth.status).toBe("authenticated");
    expect(store.getState().auth.currentUser).toEqual(oauthUser);
  });

  it("sets unauthenticated state on OAuth callback failure", async () => {
    mockedAuthService.oauthCallbackRequest.mockRejectedValue(new Error("exchange failed"));

    const store = makeStore();
    const result = await store.dispatch(handleOAuthCallback({ code: "bad-code" }));

    expect(handleOAuthCallback.rejected.match(result)).toBe(true);
    expect(result.payload).toBe("OAuth sign-in failed.");
    expect(store.getState().auth.status).toBe("unauthenticated");
    expect(store.getState().auth.currentUser).toBeNull();
  });

  it("passes state param to oauthCallbackRequest when provided", async () => {
    mockedAuthService.oauthCallbackRequest.mockResolvedValue(testAuthResponse);

    const store = makeStore();
    await store.dispatch(handleOAuthCallback({ code: "code-abc", state: "csrf-state-xyz" }));

    expect(mockedAuthService.oauthCallbackRequest).toHaveBeenCalledWith(
      "code-abc",
      "csrf-state-xyz",
    );
  });
});

describe("updateUserPreferences thunk", () => {
  beforeEach(() => {
    mockedApplyAccentTokens.mockClear();
  });

  it("updates currentUser.preferences on successful update", async () => {
    const preferences = { accentColor: "#3b82f6", zoomLevels: { "dash-1": 1.5 } };
    mockedAuthService.updateUserPreferencesRequest.mockResolvedValue(preferences);

    // First set up an authenticated user
    mockedAuthService.loginRequest.mockResolvedValue(testAuthResponse);
    const store = makeStore();
    await store.dispatch(login({ email: "test@example.com", password: "pass1234" }));

    // Now update preferences
    await store.dispatch(
      updateUserPreferences({
        fields: ["accentColor"],
        user: { accentColor: "#3b82f6" },
      }),
    );

    const state = store.getState().auth;
    expect(state.currentUser?.preferences).toEqual(preferences);
  });
});

describe("rehydrateAuth with preferences", () => {
  beforeEach(() => {
    mockedApplyAccentTokens.mockClear();
  });

  it("calls applyAccentTokens when user has accentColor preference", async () => {
    const userWithPrefs: User = {
      ...testUser,
      preferences: {
        accentColor: "#f97316",
        zoomLevels: {},
      },
    };

    mockedAuthService.getMeRequest.mockResolvedValue(userWithPrefs);

    const store = makeStore();
    await store.dispatch(rehydrateAuth());

    expect(mockedApplyAccentTokens).toHaveBeenCalledWith("#f97316");
    expect(store.getState().auth.currentUser).toEqual(userWithPrefs);
  });

  it("does not call applyAccentTokens when user has no accent color", async () => {
    mockedAuthService.getMeRequest.mockResolvedValue(testUser);

    const store = makeStore();
    await store.dispatch(rehydrateAuth());

    expect(mockedApplyAccentTokens).not.toHaveBeenCalled();
  });
});
