// HEL-1709: the MCP consent page (`/connect/mcp?request=...`) is protected, and the visitor is
// usually signed out when helio-mcp redirects them to it. Every sign-in path must return them to
// that exact URL (path AND query). Mounted under the REAL `AppRoutes` wrappers (`ProtectedRoute`,
// `PublicOnlyRoute`), because the traps are the redirects those wrappers issue, not the pages.

import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Outlet, useLocation } from "react-router-dom";

import * as authService from "../features/auth/services/authService";
import { authReducer } from "../features/auth/state/authSlice";
import type { User } from "../features/auth/types/user";
import { AppRoutes } from "./AppRoutes";

jest.mock("../features/auth/services/authService", () => ({
  loginRequest: jest.fn(),
  registerRequest: jest.fn(),
  logoutRequest: jest.fn(),
  getMeRequest: jest.fn(),
  oauthCallbackRequest: jest.fn(),
  mfaVerifyRequest: jest.fn(),
}));

// The app shell drags in the whole workspace chrome; the wrappers under test do not need it.
jest.mock("./App", () => ({ AppShell: () => <Outlet /> }));

// Stands in for the consent page: renders where we ended up.
function Probe() {
  const location = useLocation();
  return <div data-testid="landed">{`${location.pathname}${location.search}`}</div>;
}
jest.mock("../features/mcpConnect/ui/ConnectMcpPage", () => ({
  ConnectMcpPage: () => <Probe />,
}));

const mocked = jest.mocked(authService);
const TARGET = "/connect/mcp?request=v1.abc.def&x=1";

const user: User = {
  id: "u1",
  email: "a@example.com",
  displayName: null,
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  tier: "free",
};
const session = { expiresAt: "2026-12-31T00:00:00Z", user };

function mount(initial: string) {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        currentUser: null,
        status: "unauthenticated" as const,
        submitStatus: "idle" as const,
        mfaChallenge: null,
      },
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initial]}>
        <AppRoutes />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

function signInWithPassword() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

async function expectLanded() {
  await waitFor(() => expect(screen.getByTestId("landed")).toHaveTextContent(TARGET));
}

describe("returning to /connect/mcp after sign-in", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("password", async () => {
    mocked.loginRequest.mockResolvedValue(session);
    mount(TARGET);
    signInWithPassword();
    await expectLanded();
  });

  it("password + MFA", async () => {
    mocked.loginRequest.mockResolvedValue({ mfaRequired: true, challengeToken: "ch-1" });
    mocked.mfaVerifyRequest.mockResolvedValue(session);
    mount(TARGET);
    signInWithPassword();
    const code = await screen.findByLabelText("Authentication code");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await expectLanded();
    expect(screen.queryByText("/home")).not.toBeInTheDocument();
  });

  it("password sign-up (RegisterPage)", async () => {
    mocked.registerRequest.mockResolvedValue(session);
    mount(TARGET);
    fireEvent.click(await screen.findByRole("link", { name: "Create one" }));
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "a@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /create account|sign up|register/i }));
    await expectLanded();
  });

  // The Google round trip leaves the SPA, so the target survives in sessionStorage and the
  // callback is a fresh mount, exactly as in a browser.
  describe("Google", () => {
    let consoleError: jest.SpyInstance;
    beforeEach(() => {
      consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => consoleError.mockRestore());

    it("Google", async () => {
      const first = render(
        <Provider
          store={configureStore({
            reducer: { auth: authReducer },
            preloadedState: {
              auth: {
                currentUser: null,
                status: "unauthenticated" as const,
                submitStatus: "idle" as const,
                mfaChallenge: null,
              },
            },
          })}
        >
          <MemoryRouter initialEntries={[TARGET]}>
            <AppRoutes />
          </MemoryRouter>
        </Provider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/i }));
      first.unmount();

      mocked.oauthCallbackRequest.mockResolvedValue(session);
      mount("/auth/callback?code=c1&state=s1");
      await expectLanded();
    });

    it("Google + MFA", async () => {
      const first = render(
        <Provider
          store={configureStore({
            reducer: { auth: authReducer },
            preloadedState: {
              auth: {
                currentUser: null,
                status: "unauthenticated" as const,
                submitStatus: "idle" as const,
                mfaChallenge: null,
              },
            },
          })}
        >
          <MemoryRouter initialEntries={[TARGET]}>
            <AppRoutes />
          </MemoryRouter>
        </Provider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/i }));
      first.unmount();

      mocked.oauthCallbackRequest.mockResolvedValue({ mfaRequired: true, challengeToken: "ch-2" });
      mocked.mfaVerifyRequest.mockResolvedValue(session);
      mount("/auth/callback?code=c1&state=s1");
      const code = await screen.findByLabelText("Authentication code");
      fireEvent.change(code, { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "Verify" }));
      await expectLanded();
    });
  });

  it("ignores a non-relative return target", async () => {
    window.sessionStorage.setItem("helio.auth.returnTo", "https://evil.example/x");
    mocked.oauthCallbackRequest.mockResolvedValue(session);
    mount("/auth/callback?code=c1&state=s1");
    await waitFor(() => expect(screen.queryByTestId("landed")).not.toBeInTheDocument());
    expect(window.location.hostname).not.toBe("evil.example");
  });
});
