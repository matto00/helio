// HEL-590 task 6.11 — shareTokensSlice reducers: fulfilled/rejected for each thunk
// (fetch/create/revoke), keyed per-dashboard.

import { configureStore } from "@reduxjs/toolkit";

import * as shareTokenService from "../services/shareTokenService";
import {
  createShareTokenThunk,
  dismissCreatedShareToken,
  fetchShareTokens,
  revokeShareTokenThunk,
  selectShareTokensForDashboard,
  shareTokensReducer,
} from "./shareTokensSlice";

jest.mock("../services/shareTokenService", () => ({
  listShareTokens: jest.fn(),
  createShareToken: jest.fn(),
  revokeShareToken: jest.fn(),
}));

const listShareTokensMock = jest.mocked(shareTokenService.listShareTokens);
const createShareTokenMock = jest.mocked(shareTokenService.createShareToken);
const revokeShareTokenMock = jest.mocked(shareTokenService.revokeShareToken);

const dashboardId = "dash-1";

function buildStore() {
  return configureStore({ reducer: { shareTokens: shareTokensReducer } });
}

beforeEach(() => {
  listShareTokensMock.mockReset();
  createShareTokenMock.mockReset();
  revokeShareTokenMock.mockReset();
});

describe("fetchShareTokens", () => {
  it("fulfilled populates items and status", async () => {
    listShareTokensMock.mockResolvedValueOnce([
      {
        id: "tok-1",
        dashboardId,
        expiresAt: null,
        revokedAt: null,
        createdAt: "2026-09-01T00:00:00Z",
      },
    ]);
    const store = buildStore();

    await store.dispatch(fetchShareTokens(dashboardId));

    const state = selectShareTokensForDashboard(store.getState(), dashboardId);
    expect(state.status).toBe("succeeded");
    expect(state.items).toHaveLength(1);
    expect(state.error).toBeNull();
  });

  it("rejected sets the error and status", async () => {
    listShareTokensMock.mockRejectedValueOnce(new Error("boom"));
    const store = buildStore();

    await store.dispatch(fetchShareTokens(dashboardId));

    const state = selectShareTokensForDashboard(store.getState(), dashboardId);
    expect(state.status).toBe("failed");
    expect(state.error).toBe("Failed to load share links.");
  });
});

describe("createShareTokenThunk", () => {
  it("fulfilled sets createdToken and appends a metadata entry to items", async () => {
    createShareTokenMock.mockResolvedValueOnce({
      id: "tok-2",
      dashboardId,
      token: "raw-secret",
      expiresAt: null,
      createdAt: "2026-09-01T00:00:00Z",
    });
    const store = buildStore();

    await store.dispatch(createShareTokenThunk({ dashboardId }));

    const state = selectShareTokensForDashboard(store.getState(), dashboardId);
    expect(state.createStatus).toBe("succeeded");
    expect(state.createdToken?.token).toBe("raw-secret");
    expect(state.items.map((t) => t.id)).toContain("tok-2");
  });

  it("rejected sets createError and leaves items untouched", async () => {
    createShareTokenMock.mockRejectedValueOnce(new Error("boom"));
    const store = buildStore();

    await store.dispatch(createShareTokenThunk({ dashboardId }));

    const state = selectShareTokensForDashboard(store.getState(), dashboardId);
    expect(state.createStatus).toBe("failed");
    expect(state.createError).toBe("Failed to create share link.");
    expect(state.items).toHaveLength(0);
  });
});

describe("revokeShareTokenThunk", () => {
  // HEL-590 (evaluation-1.md CR3): a revoked token must survive in `items` with `revokedAt` set,
  // never be deleted -- deleting it destroys the audit trail of what was shared and withdrawn,
  // and can make the dialog show "No share links yet" while the server still holds the row.
  it("fulfilled marks the token revoked rather than removing it", async () => {
    createShareTokenMock.mockResolvedValueOnce({
      id: "tok-3",
      dashboardId,
      token: "raw-secret",
      expiresAt: null,
      createdAt: "2026-09-01T00:00:00Z",
    });
    revokeShareTokenMock.mockResolvedValueOnce(undefined);
    const store = buildStore();
    await store.dispatch(createShareTokenThunk({ dashboardId }));

    await store.dispatch(revokeShareTokenThunk({ dashboardId, tokenId: "tok-3" }));

    const state = selectShareTokensForDashboard(store.getState(), dashboardId);
    const revoked = state.items.find((t) => t.id === "tok-3");
    expect(revoked).toBeDefined();
    expect(revoked?.revokedAt).not.toBeNull();
    expect(state.revokeStatus["tok-3"]).toBe("succeeded");
  });

  it("rejected sets a per-token revokeError and keeps the item", async () => {
    createShareTokenMock.mockResolvedValueOnce({
      id: "tok-4",
      dashboardId,
      token: "raw-secret",
      expiresAt: null,
      createdAt: "2026-09-01T00:00:00Z",
    });
    revokeShareTokenMock.mockRejectedValueOnce(new Error("boom"));
    const store = buildStore();
    await store.dispatch(createShareTokenThunk({ dashboardId }));

    await store.dispatch(revokeShareTokenThunk({ dashboardId, tokenId: "tok-4" }));

    const state = selectShareTokensForDashboard(store.getState(), dashboardId);
    expect(state.revokeStatus["tok-4"]).toBe("failed");
    expect(state.revokeError["tok-4"]).toBe("Failed to revoke share link.");
    expect(state.items.map((t) => t.id)).toContain("tok-4");
  });
});

describe("dismissCreatedShareToken", () => {
  it("clears createdToken without touching items", async () => {
    createShareTokenMock.mockResolvedValueOnce({
      id: "tok-5",
      dashboardId,
      token: "raw-secret",
      expiresAt: null,
      createdAt: "2026-09-01T00:00:00Z",
    });
    const store = buildStore();
    await store.dispatch(createShareTokenThunk({ dashboardId }));

    store.dispatch(dismissCreatedShareToken(dashboardId));

    const state = selectShareTokensForDashboard(store.getState(), dashboardId);
    expect(state.createdToken).toBeNull();
    expect(state.items.map((t) => t.id)).toContain("tok-5");
  });
});
