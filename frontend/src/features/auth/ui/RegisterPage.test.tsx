import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import * as authService from "../services/authService";
import type { AuthResponse, User } from "../types/user";
import { authReducer } from "../state/authSlice";
import { consumeReturnTo } from "../utils/postLoginReturnTo";
import { RegisterPage } from "./RegisterPage";

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
  displayName: null,
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

function renderRegisterPage() {
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { store };
}

/** Mirrors LoginPage.test.tsx's deep-link helper (F-081). */
function renderRegisterPageWithDeepLink(fromPath = "/pipelines/abc-123") {
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/register",
            state: { from: { pathname: fromPath, search: "", hash: "" } },
          },
        ]}
      >
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path={fromPath} element={<div data-testid="deep-link-target" />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { store };
}

describe("RegisterPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // F-092: Google can create a brand-new account (backend upserts on first
  // sign-in), so RegisterPage needs the same entry point LoginPage has —
  // not just "sign in with an account you already made via Google".
  it("renders a Continue with Google option mirroring LoginPage", () => {
    renderRegisterPage();

    expect(screen.getByText("or")).toBeInTheDocument();
    const googleBtn = screen.getByRole("button", { name: /Continue with Google/i });
    expect(googleBtn).not.toBeDisabled();
  });

  // F-091: same conflated-loading-state bug as LoginPage.
  it("does not show a submitting state on a fresh page load", () => {
    renderRegisterPage();

    const submitBtn = screen.getByRole("button", { name: "Create account" });
    expect(submitBtn).not.toBeDisabled();
    expect(screen.queryByText("Creating account…")).not.toBeInTheDocument();
  });

  // F-234: the backend's raw error strings are lowercase, unpunctuated fragments — not
  // acceptable rendered verbatim as user-facing copy.
  describe("error copy (F-234)", () => {
    it("rewrites the 'email already registered' backend string into a sentence", async () => {
      mockedAuthService.registerRequest.mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: "email already registered" } },
      });
      renderRegisterPage();

      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "test@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "pass1234" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));

      await waitFor(() =>
        expect(screen.getByText("This email is already registered.")).toBeInTheDocument(),
      );
      expect(screen.queryByText("email already registered")).not.toBeInTheDocument();
    });

    it("capitalizes and punctuates any other raw backend error string", async () => {
      mockedAuthService.registerRequest.mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: "password too weak" } },
      });
      renderRegisterPage();

      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "test@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "pass1234" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));

      await waitFor(() => expect(screen.getByText("Password too weak.")).toBeInTheDocument());
    });
  });

  describe("deep-link preservation (F-081)", () => {
    it("navigates back to the deep-linked path after a successful registration", async () => {
      mockedAuthService.registerRequest.mockResolvedValue(testAuthResponse);
      renderRegisterPageWithDeepLink("/pipelines/abc-123");

      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "test@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "pass1234" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));

      await waitFor(() => {
        expect(screen.getByTestId("deep-link-target")).toBeInTheDocument();
      });
    });

    describe("Google redirect", () => {
      // See LoginPage.test.tsx's identical block: jsdom (26.x) declares
      // `window.location` non-configurable, so a stub swap isn't possible;
      // assigning `.href` for real just logs jsdom's harmless "Not
      // implemented: navigation" console.error. Silence it and assert on
      // the sessionStorage stash instead, since that's the F-081 behavior
      // under test — not the browser navigation itself.
      let consoleErrorSpy: jest.SpyInstance;

      beforeEach(() => {
        window.sessionStorage.clear();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      });

      afterEach(() => {
        consoleErrorSpy.mockRestore();
      });

      it("stashes the deep-linked path before redirecting to Google", () => {
        renderRegisterPageWithDeepLink("/pipelines/abc-123");

        fireEvent.click(screen.getByRole("button", { name: /Continue with Google/i }));

        expect(consumeReturnTo()).toBe("/pipelines/abc-123");
      });
    });
  });
});
