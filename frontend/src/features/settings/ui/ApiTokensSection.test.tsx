// ApiTokensSection tests (HEL-727, tasks.md 4.3): list render, empty state,
// create + shown-once reveal + dismiss (removes reveal, keeps list entry),
// revoke confirm/cancel flow, blank name leaves submit disabled and sends no
// request. Mirrors `AgentMemoryList.test.tsx`'s store-connected harness
// pattern — this component dispatches its own create/revoke thunks
// internally (design.md's inline-confirm + shown-once-reveal pattern), so a
// thin store-connected harness exercises the full dispatch -> reducer ->
// re-render loop, not just the presentational markup.

import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import * as apiTokenService from "../services/apiTokenService";
import { settingsReducer } from "../state/settingsSlice";
import type { ApiTokenResponse } from "../types/apiToken";
import { ApiTokensSection } from "./ApiTokensSection";

jest.mock("../services/apiTokenService", () => ({
  createApiToken: jest.fn(),
  revokeApiToken: jest.fn(),
}));

const createApiTokenMock = jest.mocked(apiTokenService.createApiToken);
const revokeApiTokenMock = jest.mocked(apiTokenService.revokeApiToken);

function buildStore(items: ApiTokenResponse[]) {
  return configureStore({
    reducer: { settings: settingsReducer, toasts: toastsReducer },
    preloadedState: {
      settings: {
        preferences: {
          data: null,
          status: "idle" as const,
          error: null,
          saveStatus: "idle" as const,
          saveError: null,
        },
        agentMemory: {
          items: [],
          status: "idle" as const,
          error: null,
          deleteStatus: {},
          deleteError: {},
          clearStatus: "idle" as const,
          clearError: null,
        },
        mfa: {
          status: "idle" as const,
          error: null,
          enabled: false,
          verifiedAt: null,
          backupCodesRemaining: 0,
          enrollStatus: "idle" as const,
          enrollError: null,
          enrollment: null,
          confirmStatus: "idle" as const,
          confirmError: null,
          backupCodes: null,
          regenerateStatus: "idle" as const,
          regenerateError: null,
          disableStatus: "idle" as const,
          disableError: null,
        },
        betaAccess: {
          requestStatus: "idle" as const,
          requestError: null,
          redeemStatus: "idle" as const,
          redeemError: null,
        },
        apiTokens: {
          items,
          status: "succeeded" as const,
          error: null,
          createStatus: "idle" as const,
          createError: null,
          createdToken: null,
          revokeStatus: {},
          revokeError: {},
        },
      },
      toasts: { items: [] },
    },
  });
}

/** Reads `items` from the store rather than hard-coding a static prop, so a
 *  fulfilled create/revoke thunk's reducer update is actually visible in the
 *  rendered list — mirrors how `SettingsPage` wires this component. */
function Harness() {
  const items = useAppSelector((state) => state.settings.apiTokens.items);
  return <ApiTokensSection tokens={items} />;
}

function renderSection(items: ApiTokenResponse[] = []) {
  const store = buildStore(items);
  render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  );
  return { store };
}

const tokenA: ApiTokenResponse = {
  id: "tok-1",
  name: "helio-mcp",
  createdAt: "2026-08-01T00:00:00Z",
  lastUsedAt: "2026-08-10T12:00:00Z",
  expiresAt: null,
};

const tokenNeverUsed: ApiTokenResponse = {
  id: "tok-2",
  name: "ci-runner",
  createdAt: "2026-08-02T00:00:00Z",
  lastUsedAt: null,
  expiresAt: null,
};

beforeEach(() => {
  createApiTokenMock.mockReset();
  revokeApiTokenMock.mockReset();
});

describe("ApiTokensSection — populated render", () => {
  it("displays name, created, and last-used time for each token", () => {
    renderSection([tokenA]);

    expect(screen.getByText("helio-mcp")).toBeInTheDocument();
    expect(screen.getByText(new Date(tokenA.createdAt).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText(new Date(tokenA.lastUsedAt!).toLocaleString())).toBeInTheDocument();
  });

  it("shows 'Never used' rather than a fabricated last-used value", () => {
    renderSection([tokenNeverUsed]);

    expect(screen.getByText("Never used")).toBeInTheDocument();
  });
});

describe("ApiTokensSection — empty state", () => {
  it("renders an empty state, not a blank list, when there are no tokens", () => {
    renderSection([]);

    expect(screen.getByText("No personal access tokens yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("ApiTokensSection — blank-name guard", () => {
  it("leaves the submit button disabled and sends no request for a blank name", () => {
    renderSection([]);

    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(createApiTokenMock).not.toHaveBeenCalled();
  });

  it("enables the submit button once a non-blank name is entered", () => {
    renderSection([]);

    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "helio-mcp" } });
    expect(screen.getByRole("button", { name: "Create token" })).not.toBeDisabled();
  });
});

describe("ApiTokensSection — create + shown-once reveal", () => {
  it("shows the raw token and copy action on success, and the token also appears in the list", async () => {
    createApiTokenMock.mockResolvedValueOnce({
      id: "tok-3",
      name: "new-token",
      token: "helio_pat_abc123",
      createdAt: "2026-08-03T00:00:00Z",
      expiresAt: null,
    });
    renderSection([]);

    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "new-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));

    await waitFor(() => expect(createApiTokenMock).toHaveBeenCalledWith({ name: "new-token" }));
    expect(screen.getByLabelText("New personal access token")).toHaveValue("helio_pat_abc123");
    // Appears in the list underneath the reveal panel immediately, as an
    // outcome of creation itself (design.md "Shown-once reveal").
    expect(screen.getByText("new-token")).toBeInTheDocument();
  });

  it("dismissing the reveal (Done) removes the raw-token panel but keeps the token's metadata in the list", async () => {
    createApiTokenMock.mockResolvedValueOnce({
      id: "tok-3",
      name: "new-token",
      token: "helio_pat_abc123",
      createdAt: "2026-08-03T00:00:00Z",
      expiresAt: null,
    });
    renderSection([]);

    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "new-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));

    await waitFor(() =>
      expect(screen.getByLabelText("New personal access token")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByLabelText("New personal access token")).not.toBeInTheDocument();
    // The row (metadata only) remains — the raw value is gone for good.
    expect(screen.getByText("new-token")).toBeInTheDocument();
  });

  it("copies the raw token to the clipboard when Copy is clicked", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    createApiTokenMock.mockResolvedValueOnce({
      id: "tok-3",
      name: "new-token",
      token: "helio_pat_abc123",
      createdAt: "2026-08-03T00:00:00Z",
      expiresAt: null,
    });
    renderSection([]);

    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "new-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));

    await waitFor(() =>
      expect(screen.getByLabelText("New personal access token")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("helio_pat_abc123"));
  });
});

describe("ApiTokensSection — revoke", () => {
  it("shows an inline confirm/cancel affordance and does not revoke immediately", () => {
    renderSection([tokenA]);

    fireEvent.click(screen.getByRole("button", { name: "Revoke helio-mcp" }));

    expect(screen.getByRole("button", { name: /^Confirm revoke/ })).toBeInTheDocument();
    expect(revokeApiTokenMock).not.toHaveBeenCalled();
    expect(screen.getByText("helio-mcp")).toBeInTheDocument();
  });

  it("canceling revoke leaves the token intact", () => {
    renderSection([tokenA]);

    fireEvent.click(screen.getByRole("button", { name: "Revoke helio-mcp" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(revokeApiTokenMock).not.toHaveBeenCalled();
    expect(screen.getByText("helio-mcp")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke helio-mcp" })).toBeInTheDocument();
  });

  it("confirming revoke removes the token from the list and persists the revocation", async () => {
    revokeApiTokenMock.mockResolvedValueOnce(undefined);
    renderSection([tokenA]);

    fireEvent.click(screen.getByRole("button", { name: "Revoke helio-mcp" }));
    fireEvent.click(screen.getByRole("button", { name: /^Confirm revoke/ }));

    await waitFor(() => expect(revokeApiTokenMock).toHaveBeenCalledWith("tok-1"));
    await waitFor(() => expect(screen.queryByText("helio-mcp")).not.toBeInTheDocument());
    expect(screen.getByText("No personal access tokens yet")).toBeInTheDocument();
  });
});
