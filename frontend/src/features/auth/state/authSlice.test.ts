import { configureStore } from "@reduxjs/toolkit";

import * as authService from "../services/authService";
import type { AuthResponse, User } from "../types/user";
import {
  authReducer,
  clearAuth,
  handleOAuthCallback,
  login,
  logout,
  register,
  rehydrateAuth,
  setAuth,
  updateUserPreferences,
} from "./authSlice";

jest.mock("../services/authService");

const mockedAuthService = jest.mocked(authService);

const testUser: User = {
  id: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  tier: "free",
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

describe("submitStatus / status decoupling (F-091)", () => {
  // The submit button's loading state used to be derived from `status`,
  // which rehydrateAuth.pending also sets on every app mount — so a
  // genuinely fresh visitor saw "Signing in…" until GET /api/auth/me
  // resolved. submitStatus is now the only field login/register touch.

  it("login.pending sets submitStatus without touching status", () => {
    mockedAuthService.loginRequest.mockResolvedValue(testAuthResponse);
    const store = makeStore();

    const pending = store.dispatch(login({ email: "test@example.com", password: "pass1234" }));

    expect(store.getState().auth.submitStatus).toBe("loading");
    expect(store.getState().auth.status).toBe("idle");

    return pending;
  });

  it("register.pending sets submitStatus without touching status", () => {
    mockedAuthService.registerRequest.mockResolvedValue(testAuthResponse);
    const store = makeStore();

    const pending = store.dispatch(register({ email: "test@example.com", password: "pass1234" }));

    expect(store.getState().auth.submitStatus).toBe("loading");
    expect(store.getState().auth.status).toBe("idle");

    return pending;
  });

  it("rehydrateAuth.pending sets status without touching submitStatus", () => {
    mockedAuthService.getMeRequest.mockResolvedValue(testUser);
    const store = makeStore();

    const pending = store.dispatch(rehydrateAuth());

    expect(store.getState().auth.status).toBe("loading");
    expect(store.getState().auth.submitStatus).toBe("idle");

    return pending;
  });

  it("resets submitStatus to idle after a failed login", async () => {
    const axiosError = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: { data: { message: "Invalid email or password" } },
    });
    mockedAuthService.loginRequest.mockRejectedValue(axiosError);
    const store = makeStore();

    await store.dispatch(login({ email: "x@x.com", password: "wrong" }));

    expect(store.getState().auth.submitStatus).toBe("idle");
  });

  it("resets submitStatus to idle after a successful login", async () => {
    mockedAuthService.loginRequest.mockResolvedValue(testAuthResponse);
    const store = makeStore();

    await store.dispatch(login({ email: "test@example.com", password: "pass1234" }));

    expect(store.getState().auth.submitStatus).toBe("idle");
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
      tier: "free",
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
    document.documentElement.style.removeProperty("--app-accent");
  });

  it("stores the user's accentColor preference in state without applying it to the DOM directly", async () => {
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

    expect(store.getState().auth.currentUser).toEqual(userWithPrefs);
    // F-061: the slice must never write `--app-accent` itself — ThemeProvider
    // is the single owner, fed by this state's preferences from outside the
    // reducer, so the applied accent and the AccentPicker's selection can
    // never disagree.
    expect(document.documentElement.style.getPropertyValue("--app-accent")).toBe("");
  });

  it("stores currentUser as-is when the user has no accent color preference", async () => {
    mockedAuthService.getMeRequest.mockResolvedValue(testUser);

    const store = makeStore();
    await store.dispatch(rehydrateAuth());

    expect(store.getState().auth.currentUser).toEqual(testUser);
    expect(document.documentElement.style.getPropertyValue("--app-accent")).toBe("");
  });
});
