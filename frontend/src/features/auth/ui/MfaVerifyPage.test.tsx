// MfaVerifyPage tests (HEL-702, tasks.md 4.6): valid/invalid code, the
// backup-code toggle, and the no-challenge-in-state redirect.

import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import * as authService from "../services/authService";
import { authReducer, type AuthState } from "../state/authSlice";
import { MfaVerifyPage } from "./MfaVerifyPage";

jest.mock("../services/authService", () => ({
  mfaVerifyRequest: jest.fn(),
}));

const mockedAuthService = jest.mocked(authService);

const testUser = {
  id: "user-1",
  email: "test@example.com",
  displayName: null,
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  tier: "free" as const,
};

function makeStore(authState: Partial<AuthState> = {}) {
  const preloaded: AuthState = {
    currentUser: null,
    status: "unauthenticated",
    submitStatus: "idle",
    mfaChallenge: { challengeToken: "challenge-token-123" },
    ...authState,
  };
  return configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: preloaded },
  });
}

function renderVerifyPage(authState?: Partial<AuthState>) {
  const store = makeStore(authState);
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/login/verify"]}>
        <Routes>
          <Route path="/login/verify" element={<MfaVerifyPage />} />
          <Route path="/login" element={<div data-testid="login-page" />} />
          <Route path="/" element={<div data-testid="home-page" />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { store };
}

describe("MfaVerifyPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("redirects to /login when there is no pending challenge", () => {
    renderVerifyPage({ mfaChallenge: null });

    expect(screen.getByTestId("login-page")).toBeInTheDocument();
  });

  it("navigates to / on a valid code", async () => {
    mockedAuthService.mfaVerifyRequest.mockResolvedValue({
      expiresAt: "2026-12-31T00:00:00Z",
      user: testUser,
    });
    renderVerifyPage();

    fireEvent.change(screen.getByLabelText("Authentication code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
    });
    expect(mockedAuthService.mfaVerifyRequest).toHaveBeenCalledWith(
      "challenge-token-123",
      "123456",
    );
  });

  it("shows an inline error and stays on the page for an invalid code", async () => {
    const axiosError = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: { data: { message: "Invalid code. Please try again." } },
    });
    mockedAuthService.mfaVerifyRequest.mockRejectedValue(axiosError);
    renderVerifyPage();

    fireEvent.change(screen.getByLabelText("Authentication code"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid code. Please try again.")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("home-page")).not.toBeInTheDocument();
  });

  it("toggles between authenticator-code and backup-code entry", () => {
    renderVerifyPage();

    expect(screen.getByLabelText("Authentication code")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use a backup code instead" }));
    expect(screen.getByLabelText("Backup code")).toBeInTheDocument();
    expect(screen.getByText("Enter one of your unused backup codes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use an authenticator code instead" }));
    expect(screen.getByLabelText("Authentication code")).toBeInTheDocument();
  });
});
