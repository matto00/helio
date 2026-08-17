import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import * as authService from "../services/authService";
import { authReducer } from "../state/authSlice";
import { LoginPage } from "./LoginPage";

jest.mock("../services/authService", () => ({
  loginRequest: jest.fn(),
  registerRequest: jest.fn(),
  logoutRequest: jest.fn(),
  getMeRequest: jest.fn(),
  oauthCallbackRequest: jest.fn(),
}));

const mockedAuthService = jest.mocked(authService);

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
    mockedAuthService.loginRequest.mockResolvedValue({
      expiresAt: "2026-12-31T00:00:00Z",
      user: {
        id: "user-1",
        email: "test@example.com",
        displayName: null,
        avatarUrl: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    });
    renderLoginPage();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pass1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
    });
  });
});
