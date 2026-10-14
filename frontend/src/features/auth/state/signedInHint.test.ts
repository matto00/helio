import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit";

import * as authService from "../services/authService";
import type { AuthResponse, MfaRequiredResponse, User } from "../types/user";
import type { AppStartListening } from "../../../store/listenerMiddleware";
import {
  authReducer,
  clearAuth,
  handleOAuthCallback,
  login,
  logout,
  register,
  rehydrateAuth,
  setAuth,
  verifyMfa,
} from "./authSlice";
import { SIGNED_IN_HINT_KEY, registerSignedInHintListener } from "./signedInHint";

jest.mock("../services/authService");

const mocked = jest.mocked(authService);

const user: User = {
  id: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  tier: "free",
};
const session: AuthResponse = { expiresAt: "2026-12-31T00:00:00Z", user };
const mfa: MfaRequiredResponse = { mfaRequired: true, challengeToken: "challenge-token" };

function makeStore() {
  const listeners = createListenerMiddleware();
  registerSignedInHintListener(listeners.startListening as unknown as AppStartListening);
  return configureStore({
    reducer: { auth: authReducer },
    middleware: (getDefault) => getDefault().prepend(listeners.middleware),
  });
}

const hint = () => window.localStorage.getItem(SIGNED_IN_HINT_KEY);

describe("signed-in hint", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.resetAllMocks();
  });

  it("uses the key the landing page's inline script reads", () => {
    expect(SIGNED_IN_HINT_KEY).toBe("helio.signedIn");
  });

  it.each([
    ["setAuth", (s: ReturnType<typeof makeStore>) => s.dispatch(setAuth({ user }))],
    [
      "login",
      async (s: ReturnType<typeof makeStore>) => {
        mocked.loginRequest.mockResolvedValue(session);
        await s.dispatch(login({ email: "a@b.c", password: "pass1234" }));
      },
    ],
    [
      "register",
      async (s: ReturnType<typeof makeStore>) => {
        mocked.registerRequest.mockResolvedValue(session);
        await s.dispatch(register({ email: "a@b.c", password: "pass1234" }));
      },
    ],
    [
      "OAuth callback",
      async (s: ReturnType<typeof makeStore>) => {
        mocked.oauthCallbackRequest.mockResolvedValue(session);
        await s.dispatch(handleOAuthCallback({ code: "c" }));
      },
    ],
    [
      "session rehydration",
      async (s: ReturnType<typeof makeStore>) => {
        mocked.getMeRequest.mockResolvedValue(user);
        await s.dispatch(rehydrateAuth());
      },
    ],
  ])("is set when %s authenticates", async (_name, act) => {
    const store = makeStore();
    await act(store);
    expect(store.getState().auth.status).toBe("authenticated");
    expect(hint()).toBe("1");
  });

  it("is set after MFA verification, not after the password step that only returns a challenge", async () => {
    const store = makeStore();
    mocked.loginRequest.mockResolvedValue(mfa);
    await store.dispatch(login({ email: "a@b.c", password: "pass1234" }));
    expect(hint()).toBeNull();

    mocked.mfaVerifyRequest.mockResolvedValue(session);
    await store.dispatch(verifyMfa({ code: "123456" }));
    expect(hint()).toBe("1");
  });

  it("is cleared on logout", async () => {
    const store = makeStore();
    store.dispatch(setAuth({ user }));
    mocked.logoutRequest.mockResolvedValue(undefined);
    await store.dispatch(logout());
    expect(hint()).toBeNull();
  });

  it("is cleared by a 401 (clearAuth from an authenticated session)", () => {
    const store = makeStore();
    store.dispatch(setAuth({ user }));
    store.dispatch(clearAuth());
    expect(hint()).toBeNull();
  });

  it("is cleared when the session check fails, so a stale hint does not survive", async () => {
    window.localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
    mocked.getMeRequest.mockRejectedValue(new Error("401"));
    const store = makeStore();
    await store.dispatch(rehydrateAuth());
    expect(hint()).toBeNull();
  });

  it("holds only a boolean marker, never user data", () => {
    const store = makeStore();
    store.dispatch(setAuth({ user }));
    expect(hint()).toBe("1");
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(user.email);
  });

  it("does not throw when localStorage is unavailable", () => {
    const store = makeStore();
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      expect(() => store.dispatch(setAuth({ user }))).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});
