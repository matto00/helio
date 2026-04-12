import { configureStore } from "@reduxjs/toolkit";

import * as authService from "../../services/authService";
import * as httpClient from "../../services/httpClient";
import type { AuthResponse, User } from "../../types/models";
import { authReducer, clearAuth, login, logout, rehydrateAuth, setAuth } from "./authSlice";

jest.mock("../../services/authService");
jest.mock("../../services/httpClient", () => ({
  httpClient: { defaults: { headers: { common: {} } } },
  setAuthToken: jest.fn(),
}));

const mockedAuthService = jest.mocked(authService);
const mockedSetAuthToken = jest.mocked(httpClient.setAuthToken);

const testUser: User = {
  id: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  createdAt: "2026-01-01T00:00:00Z",
};

const testAuthResponse: AuthResponse = {
  token: "test-token-abc123",
  expiresAt: "2026-12-31T00:00:00Z",
  user: testUser,
};

function makeStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

describe("authSlice reducers", () => {
  beforeEach(() => {
    mockedSetAuthToken.mockClear();
    sessionStorage.clear();
  });

  it("setAuth sets token, user, and status to authenticated", () => {
    const state = authReducer(undefined, setAuth({ token: "tok", user: testUser }));
    expect(state.token).toBe("tok");
    expect(state.currentUser).toEqual(testUser);
    expect(state.status).toBe("authenticated");
    expect(mockedSetAuthToken).toHaveBeenCalledWith("tok");
    expect(sessionStorage.getItem("helio_auth_token")).toBe("tok");
  });

  it("clearAuth clears token, user, and sets status to unauthenticated", () => {
    const preloaded = authReducer(undefined, setAuth({ token: "tok", user: testUser }));
    const state = authReducer(preloaded, clearAuth());
    expect(state.token).toBeNull();
    expect(state.currentUser).toBeNull();
    expect(state.status).toBe("unauthenticated");
    expect(mockedSetAuthToken).toHaveBeenCalledWith(null);
    expect(sessionStorage.getItem("helio_auth_token")).toBeNull();
  });
});

describe("rehydrateAuth thunk", () => {
  beforeEach(() => {
    mockedSetAuthToken.mockClear();
    sessionStorage.clear();
  });

  it("sets unauthenticated when no token in sessionStorage", async () => {
    const store = makeStore();
    await store.dispatch(rehydrateAuth());
    expect(store.getState().auth.status).toBe("unauthenticated");
  });

  it("sets authenticated when token is valid and getMeRequest succeeds", async () => {
    sessionStorage.setItem("helio_auth_token", "valid-token");
    mockedAuthService.getMeRequest.mockResolvedValue(testUser);

    const store = makeStore();
    await store.dispatch(rehydrateAuth());

    expect(store.getState().auth.status).toBe("authenticated");
    expect(store.getState().auth.currentUser).toEqual(testUser);
    expect(mockedSetAuthToken).toHaveBeenCalledWith("valid-token");
  });

  it("sets unauthenticated and clears storage when getMeRequest rejects (expired token)", async () => {
    sessionStorage.setItem("helio_auth_token", "expired-token");
    mockedAuthService.getMeRequest.mockRejectedValue(new Error("401"));

    const store = makeStore();
    await store.dispatch(rehydrateAuth());

    expect(store.getState().auth.status).toBe("unauthenticated");
    expect(store.getState().auth.token).toBeNull();
    expect(sessionStorage.getItem("helio_auth_token")).toBeNull();
    expect(mockedSetAuthToken).toHaveBeenCalledWith(null);
  });
});

describe("login thunk", () => {
  beforeEach(() => {
    mockedSetAuthToken.mockClear();
    sessionStorage.clear();
  });

  it("sets authenticated state on successful login", async () => {
    mockedAuthService.loginRequest.mockResolvedValue(testAuthResponse);
    const store = makeStore();

    await store.dispatch(login({ email: "test@example.com", password: "pass1234" }));

    expect(store.getState().auth.status).toBe("authenticated");
    expect(store.getState().auth.token).toBe("test-token-abc123");
    expect(store.getState().auth.currentUser).toEqual(testUser);
    expect(mockedSetAuthToken).toHaveBeenCalledWith("test-token-abc123");
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
  beforeEach(() => {
    mockedSetAuthToken.mockClear();
    sessionStorage.clear();
  });

  it("clears auth state regardless of logoutRequest outcome", async () => {
    mockedAuthService.loginRequest.mockResolvedValue(testAuthResponse);
    mockedAuthService.logoutRequest.mockResolvedValue(undefined);

    const store = makeStore();
    await store.dispatch(login({ email: "test@example.com", password: "pass1234" }));
    expect(store.getState().auth.status).toBe("authenticated");

    await store.dispatch(logout());

    expect(store.getState().auth.status).toBe("unauthenticated");
    expect(store.getState().auth.token).toBeNull();
  });

  it("still clears auth state even when logoutRequest throws", async () => {
    mockedAuthService.loginRequest.mockResolvedValue(testAuthResponse);
    mockedAuthService.logoutRequest.mockRejectedValue(new Error("network error"));

    const store = makeStore();
    await store.dispatch(login({ email: "test@example.com", password: "pass1234" }));

    await store.dispatch(logout());

    expect(store.getState().auth.status).toBe("unauthenticated");
    expect(store.getState().auth.token).toBeNull();
  });
});
