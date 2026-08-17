import { configureStore } from "@reduxjs/toolkit";

import * as authService from "../services/authService";
import type { AuthResponse, MfaRequiredResponse, User } from "../types/user";
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
  verifyMfa,
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

// HEL-702: returned by `login`/`handleOAuthCallback` in place of
// `testAuthResponse` when the account has MFA enabled.
const testMfaRequiredResponse: MfaRequiredResponse = {
  mfaRequired: true,
  challengeToken: "challenge-token-123",
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

  // HEL-702 design.md D7
  it("stores the challenge and stays unauthenticated when MFA is required", async () => {
    mockedAuthService.loginRequest.mockResolvedValue(testMfaRequiredResponse);
    const store = makeStore();

    const result = await store.dispatch(login({ email: "test@example.com", password: "pass1234" }));

    expect(login.fulfilled.match(result)).toBe(true);
    expect(store.getState().auth.status).toBe("unauthenticated");
    expect(store.getState().auth.currentUser).toBeNull();
    expect(store.getState().auth.mfaChallenge).toEqual({ challengeToken: "challenge-token-123" });
  });
});

// HEL-702 design.md D7
describe("handleOAuthCallback thunk (MFA gate)", () => {
  it("stores the challenge and stays unauthenticated when MFA is required", async () => {
    mockedAuthService.oauthCallbackRequest.mockResolvedValue(testMfaRequiredResponse);
    const store = makeStore();

    const result = await store.dispatch(handleOAuthCallback({ code: "auth-code-123" }));

    expect(handleOAuthCallback.fulfilled.match(result)).toBe(true);
    expect(store.getState().auth.status).toBe("unauthenticated");
    expect(store.getState().auth.mfaChallenge).toEqual({ challengeToken: "challenge-token-123" });
  });
});

// HEL-702 design.md D4/D7
describe("verifyMfa thunk", () => {
  async function storeWithPendingChallenge() {
    mockedAuthService.loginRequest.mockResolvedValue(testMfaRequiredResponse);
    const store = makeStore();
    await store.dispatch(login({ email: "test@example.com", password: "pass1234" }));
    return store;
  }

  it("authenticates and clears the challenge on success", async () => {
    const store = await storeWithPendingChallenge();
    mockedAuthService.mfaVerifyRequest.mockResolvedValue(testAuthResponse);

    const result = await store.dispatch(verifyMfa({ code: "123456" }));

    expect(verifyMfa.fulfilled.match(result)).toBe(true);
    expect(store.getState().auth.status).toBe("authenticated");
    expect(store.getState().auth.currentUser).toEqual(testUser);
    expect(store.getState().auth.mfaChallenge).toBeNull();
    expect(mockedAuthService.mfaVerifyRequest).toHaveBeenCalledWith(
      "challenge-token-123",
      "123456",
    );
  });

  it("retains the challenge and reports the error on a wrong code", async () => {
    const store = await storeWithPendingChallenge();
    const axiosError = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: { data: { message: "Invalid code." } },
    });
    mockedAuthService.mfaVerifyRequest.mockRejectedValue(axiosError);

    const result = await store.dispatch(verifyMfa({ code: "000000" }));

    expect(verifyMfa.rejected.match(result)).toBe(true);
    expect(result.payload).toBe("Invalid code.");
    expect(store.getState().auth.status).toBe("unauthenticated");
    // The challenge is retained on failure -- the user can retry until it
    // expires/attempt-caps (design.md D4).
    expect(store.getState().auth.mfaChallenge).toEqual({ challengeToken: "challenge-token-123" });
  });

  it("rejects immediately when there is no pending challenge in state", async () => {
    // Prior tests in this describe block already invoked mfaVerifyRequest —
    // clear its call history so this assertion checks THIS dispatch only.
    mockedAuthService.mfaVerifyRequest.mockClear();
    const store = makeStore();

    const result = await store.dispatch(verifyMfa({ code: "123456" }));

    expect(verifyMfa.rejected.match(result)).toBe(true);
    expect(result.payload).toBe("No pending verification. Please sign in again.");
    expect(mockedAuthService.mfaVerifyRequest).not.toHaveBeenCalled();
  });
});

// HEL-702 design.md D7
describe("clearAuth (MFA challenge)", () => {
  it("clears a pending mfaChallenge", () => {
    const action = login.fulfilled(testMfaRequiredResponse, "request-1", {
      email: "test@example.com",
      password: "pass1234",
    });
    const withChallenge = authReducer(undefined, action);
    expect(withChallenge.mfaChallenge).toEqual({ challengeToken: "challenge-token-123" });

    const cleared = authReducer(withChallenge, clearAuth());
    expect(cleared.mfaChallenge).toBeNull();
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
