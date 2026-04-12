import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import * as authService from "../../services/authService";
import type { AuthResponse, User } from "../../types/models";
import { authReducer } from "./authSlice";
import { OAuthCallbackPage } from "./OAuthCallbackPage";

jest.mock("../../services/authService", () => ({
  loginRequest: jest.fn(),
  registerRequest: jest.fn(),
  logoutRequest: jest.fn(),
  getMeRequest: jest.fn(),
  oauthCallbackRequest: jest.fn(),
}));

jest.mock("../../services/httpClient", () => ({
  httpClient: { defaults: { headers: { common: {} } } },
  setAuthToken: jest.fn(),
}));

const mockedAuthService = jest.mocked(authService);

const oauthUser: User = {
  id: "google-user",
  email: "google@example.com",
  displayName: "Google User",
  avatarUrl: "https://example.com/avatar.jpg",
  createdAt: "2026-01-01T00:00:00Z",
};

const oauthResponse: AuthResponse = {
  token: "oauth-token-xyz",
  expiresAt: "2026-12-31T00:00:00Z",
  user: oauthUser,
};

function makeStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

function renderCallbackPage(search: string) {
  const store = makeStore();

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/auth/callback${search}`]}>
        <Routes>
          <Route path="/auth/callback" element={<OAuthCallbackPage />} />
          <Route path="/login" element={<div data-testid="login-page" />} />
          <Route path="/" element={<div data-testid="home-page" />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

  return { store };
}

describe("OAuthCallbackPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  it("navigates to / on successful OAuth callback", async () => {
    mockedAuthService.oauthCallbackRequest.mockResolvedValue(oauthResponse);

    renderCallbackPage("?code=valid-code");

    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
    });
  });

  it("navigates to /login?error=oauth_failed on OAuth callback failure", async () => {
    mockedAuthService.oauthCallbackRequest.mockRejectedValue(new Error("exchange failed"));

    renderCallbackPage("?code=bad-code");

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
    });
  });

  it("navigates immediately to /login?error=oauth_failed when error query param is present", async () => {
    renderCallbackPage("?error=access_denied");

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
    });
    // Should not have called the backend at all
    expect(mockedAuthService.oauthCallbackRequest).not.toHaveBeenCalled();
  });

  it("shows loading indicator before the exchange resolves", () => {
    // Use a never-resolving promise to keep the component in loading state
    mockedAuthService.oauthCallbackRequest.mockReturnValue(new Promise(() => {}));

    renderCallbackPage("?code=valid-code");

    expect(screen.getByText("Signing in…")).toBeInTheDocument();
  });
});
