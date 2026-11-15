import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { authReducer } from "../../auth/state/authSlice";
import * as apiTokenService from "../../settings/services/apiTokenService";
import * as mcpConnectService from "../services/mcpConnectService";
import { ConnectMcpPage } from "./ConnectMcpPage";

jest.mock("../../settings/services/apiTokenService", () => ({ createApiToken: jest.fn() }));

const mockEnv = { MCP_ORIGIN: "https://mcp.test" };
jest.mock("../../../config/env", () => ({
  get MCP_ORIGIN() {
    return mockEnv.MCP_ORIGIN;
  },
}));

const createApiToken = jest.mocked(apiTokenService.createApiToken);

const REQUEST = "v1.sealed.request";
const FUTURE = () => Math.floor(Date.now() / 1000) + 600;

let submitSpy: jest.SpyInstance;
let submitted: { action: string; fields: Record<string, string> }[];
let fetchMock: jest.Mock;

function pending(body: Record<string, unknown> | number) {
  fetchMock.mockResolvedValue(
    typeof body === "number"
      ? { ok: false, status: body, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => body },
  );
}

async function renderPage(search = `?request=${REQUEST}`) {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        currentUser: {
          id: "u1",
          email: "a@example.com",
          displayName: null,
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          tier: "free" as const,
        },
        status: "authenticated" as const,
        submitStatus: "idle" as const,
        mfaChallenge: null,
      },
    },
  });
  await act(async () => {
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[`/connect/mcp${search}`]}>
          <ConnectMcpPage />
        </MemoryRouter>
      </Provider>,
    );
  });
}

const attend = () => act(() => void jest.advanceTimersByTime(600));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockEnv.MCP_ORIGIN = "https://mcp.test";
  jest.spyOn(document, "hasFocus").mockReturnValue(true);
  submitted = [];
  submitSpy = jest.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (
    this: HTMLFormElement,
  ) {
    const fields: Record<string, string> = {};
    new FormData(this).forEach((v, k) => (fields[k] = String(v)));
    submitted.push({ action: this.action, fields });
  });
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  createApiToken.mockResolvedValue({
    id: "t1",
    name: "n",
    token: "helio_pat_secret",
    createdAt: "x",
    expiresAt: "y",
  });
});

afterEach(() => {
  jest.useRealTimers();
  submitSpy.mockRestore();
  jest.restoreAllMocks();
});

describe("ConnectMcpPage", () => {
  it("shows a spinner, then the client name, redirect host and signed-in account", async () => {
    pending({ clientName: "Claude", redirectHost: "claude.ai", expiresAt: FUTURE() });
    await renderPage();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("claude.ai")).toBeInTheDocument();
    expect(screen.getByText("a@example.com")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://mcp.test/oauth/pending?request=${encodeURIComponent(REQUEST)}`);
    expect(init.credentials).toBe("omit");
    expect(init.headers).toBeUndefined();
  });

  it("falls back to a generic name when the client has none", async () => {
    pending({ redirectHost: "claude.ai", expiresAt: FUTURE() });
    await renderPage();
    expect(screen.getByText("An MCP client")).toBeInTheDocument();
  });

  it("ignores a click before 500 ms of attention, then mints exactly once", async () => {
    pending({ clientName: "Claude", redirectHost: "claude.ai", expiresAt: FUTURE() });
    await renderPage();
    const allow = screen.getByRole("button", { name: "Allow" });
    expect(allow).toBeDisabled();
    fireEvent.click(allow);
    expect(createApiToken).not.toHaveBeenCalled();

    attend();
    expect(allow).toBeEnabled();
    await act(async () => {
      fireEvent.click(allow);
      fireEvent.click(allow); // a second click during the mint
    });
    expect(createApiToken).toHaveBeenCalledTimes(1);
    expect(createApiToken).toHaveBeenCalledWith({
      name: "MCP connector: Claude (claude.ai)",
      expiresInDays: 90,
    });
    expect(submitted).toEqual([
      {
        action: "https://mcp.test/oauth/callback",
        fields: { request: REQUEST, pat: "helio_pat_secret" },
      },
    ]);
  });

  it("resets the attention window on blur", async () => {
    pending({ clientName: "Claude", redirectHost: "claude.ai", expiresAt: FUTURE() });
    await renderPage();
    attend();
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled();
    attend();
    expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    attend();
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();
  });

  it("caps a 200-character client name at a 100-character token name", async () => {
    pending({ clientName: "n".repeat(200), redirectHost: "claude.ai", expiresAt: FUTURE() });
    await renderPage();
    attend();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    });
    const name = createApiToken.mock.calls[0]?.[0].name ?? "";
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.startsWith("MCP connector: nnn")).toBe(true);
  });

  it("Deny mints nothing and posts a denial", async () => {
    pending({ clientName: "Claude", redirectHost: "claude.ai", expiresAt: FUTURE() });
    await renderPage();
    attend();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    });
    expect(createApiToken).not.toHaveBeenCalled();
    expect(submitted).toEqual([
      { action: "https://mcp.test/oauth/callback", fields: { request: REQUEST, deny: "1" } },
    ]);
  });

  it("mints nothing when the request expired while the page was open", async () => {
    pending({
      clientName: "Claude",
      redirectHost: "claude.ai",
      expiresAt: Math.floor(Date.now() / 1000) + 1,
    });
    await renderPage();
    act(() => void jest.advanceTimersByTime(2000));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    });
    expect(createApiToken).not.toHaveBeenCalled();
    expect(submitted).toEqual([]);
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });

  it("shows an error and no Allow for an invalid request", async () => {
    pending(400);
    await renderPage();
    expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });

  it("shows an error when the request parameter is missing", async () => {
    await renderPage("");
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("states connectors are unavailable when no origin is configured", async () => {
    mockEnv.MCP_ORIGIN = "";
    await renderPage();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createApiToken).not.toHaveBeenCalled();
  });

  it("offers no actions when framed", async () => {
    pending({ clientName: "Claude", redirectHost: "claude.ai", expiresAt: FUTURE() });
    jest.spyOn(mcpConnectService, "isFramed").mockReturnValue(true);
    await renderPage();
    expect(screen.getByText(/cannot be shown inside another page/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recovers from a failed mint without posting anything", async () => {
    pending({ clientName: "Claude", redirectHost: "claude.ai", expiresAt: FUTURE() });
    createApiToken.mockRejectedValueOnce(new Error("boom"));
    await renderPage();
    attend();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    });
    expect(submitted).toEqual([]);
    expect(screen.getByText(/could not create/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    });
    expect(createApiToken).toHaveBeenCalledTimes(2);
    expect(submitted).toHaveLength(1);
  });
});
