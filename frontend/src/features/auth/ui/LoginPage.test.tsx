import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import * as authService from "../services/authService";
import type { AuthResponse, User } from "../types/user";
import { authReducer } from "../state/authSlice";
import { consumeReturnTo } from "../utils/postLoginReturnTo";
import { LoginPage } from "./LoginPage";

jest.mock("../services/authService", () => ({
  loginRequest: jest.fn(),
  registerRequest: jest.fn(),
  logoutRequest: jest.fn(),
  getMeRequest: jest.fn(),
  oauthCallbackRequest: jest.fn(),
}));

const mockedAuthService = jest.mocked(authService);

const testUser: User = {
  id: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  tier: "free",
};

const testAuthResponse: AuthResponse = {
  expiresAt: "2026-12-31T00:00:00Z",
  user: testUser,
};

function makeStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

function renderLoginPage(search = "") {
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/verify" element={<div data-testid="mfa-verify-page" />} />
          <Route path="/" element={<div data-testid="home-page" />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { store };
}

/** F-081 helper: renders LoginPage as ProtectedRoute would after redirecting
 *  a logged-out visitor away from a deep link, and a stand-in destination
 *  route so a successful login's navigation target is observable. */
function renderLoginPageWithDeepLink(fromPath = "/pipelines/abc-123") {
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/login",
            state: { from: { pathname: fromPath, search: "", hash: "" } },
          },
        ]}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path={fromPath} element={<div data-testid="deep-link-target" />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { store };
}

describe("LoginPage", () => {
  it("renders the oauth error message when ?error=oauth_failed is in the URL", () => {
    renderLoginPage("?error=oauth_failed");

    expect(screen.getByText("Google sign-in failed. Please try again.")).toBeInTheDocument();
  });

  it("does not render the oauth error message when no error param is present", () => {
    renderLoginPage();

    expect(screen.queryByText("Google sign-in failed. Please try again.")).not.toBeInTheDocument();
  });

  it("does not render the oauth error message for unrelated error values", () => {
    renderLoginPage("?error=some_other_error");

    expect(screen.queryByText("Google sign-in failed. Please try again.")).not.toBeInTheDocument();
  });

  it("renders the Continue with Google button as enabled", () => {
    renderLoginPage();

    const googleBtn = screen.getByRole("button", { name: /Continue with Google/i });
    expect(googleBtn).not.toBeDisabled();
  });

  // F-091: the submit button used to derive its loading state from the same
  // `status` field the unconditional boot-time rehydrateAuth() check writes
  // to, so a genuinely fresh (never-submitted) page load showed "Signing
  // in…" and a disabled button until that unrelated check resolved.
  it("does not show a submitting state on a fresh page load", () => {
    renderLoginPage();

    const submitBtn = screen.getByRole("button", { name: "Sign in" });
    expect(submitBtn).not.toBeDisabled();
    expect(screen.queryByText("Signing in…")).not.toBeInTheDocument();
  });

  // HEL-702 design.md D7
  it("navigates to /login/verify when login returns an MFA challenge instead of a session", async () => {
    mockedAuthService.loginRequest.mockResolvedValue({
      mfaRequired: true,
      challengeToken: "challenge-token-123",
    });
    renderLoginPage();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pass1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByTestId("mfa-verify-page")).toBeInTheDocument();
    });
  });

  it("navigates to / when login returns a normal session", async () => {
    mockedAuthService.loginRequest.mockResolvedValue(testAuthResponse);
    renderLoginPage();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pass1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
    });
  });

  describe("deep-link preservation (F-081)", () => {
    it("navigates back to the deep-linked path after a successful login", async () => {
      mockedAuthService.loginRequest.mockResolvedValue(testAuthResponse);
      renderLoginPageWithDeepLink("/pipelines/abc-123");

      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "test@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "pass1234" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(screen.getByTestId("deep-link-target")).toBeInTheDocument();
      });
    });

    describe("Google redirect", () => {
      // jsdom (26.x) declares `window.location` non-configurable, so it
      // can't be swapped for a stub the way `window.location.assign` mocks
      // often are; assigning `.href` for real triggers jsdom's noisy (but
      // harmless) "Not implemented: navigation" console.error. Silence that
      // expected error rather than fighting jsdom for a real `location`
      // double — the behavior under test is the sessionStorage stash order,
      // not the browser navigation itself.
      let consoleErrorSpy: jest.SpyInstance;

      beforeEach(() => {
        window.sessionStorage.clear();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      });

      afterEach(() => {
        consoleErrorSpy.mockRestore();
      });

      it("stashes the deep-linked path before redirecting to Google", () => {
        renderLoginPageWithDeepLink("/pipelines/abc-123");

        fireEvent.click(screen.getByRole("button", { name: /Continue with Google/i }));

        expect(consumeReturnTo()).toBe("/pipelines/abc-123");
      });

      it("does not stash anything when there is no deep link to preserve", () => {
        renderLoginPage();

        fireEvent.click(screen.getByRole("button", { name: /Continue with Google/i }));

        expect(consumeReturnTo()).toBeNull();
      });
    });
  });
});
