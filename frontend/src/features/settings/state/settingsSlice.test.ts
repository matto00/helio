// Per-thunk reducer + thunk sub-suites — matches `metricsSlice.test.ts`'s /
// `pipelinesSlice.test.ts`'s structure.

import {
  clearAgentMemoryThunk,
  createApiTokenThunk,
  deleteAgentMemoryEntryThunk,
  dismissCreatedApiToken,
  fetchAgentMemory,
  fetchApiTokens,
  fetchPreferences,
  redeemInviteCodeThunk,
  requestBetaAccessThunk,
  revokeApiTokenThunk,
  savePreferences,
  settingsReducer,
} from "./settingsSlice";
import * as settingsService from "../services/settingsService";
import * as apiTokenService from "../services/apiTokenService";
import type { AgentMemoryEntry } from "../types/agentMemory";
import type { ApiTokenResponse, CreateApiTokenResponse } from "../types/apiToken";
import type { AgentPreferences } from "../types/preferences";
import type { User } from "../../auth/types/user";

jest.mock("../services/settingsService", () => ({
  getPreferences: jest.fn(),
  putPreferences: jest.fn(),
  listAgentMemory: jest.fn(),
  deleteAgentMemoryEntry: jest.fn(),
  clearAgentMemory: jest.fn(),
  requestBetaAccess: jest.fn(),
  redeemInviteCode: jest.fn(),
}));

jest.mock("../services/apiTokenService", () => ({
  listApiTokens: jest.fn(),
  createApiToken: jest.fn(),
  revokeApiToken: jest.fn(),
}));

const getPreferencesMock = jest.mocked(settingsService.getPreferences);
const putPreferencesMock = jest.mocked(settingsService.putPreferences);
const listAgentMemoryMock = jest.mocked(settingsService.listAgentMemory);
const deleteAgentMemoryEntryMock = jest.mocked(settingsService.deleteAgentMemoryEntry);
const clearAgentMemoryMock = jest.mocked(settingsService.clearAgentMemory);
const requestBetaAccessMock = jest.mocked(settingsService.requestBetaAccess);
const redeemInviteCodeMock = jest.mocked(settingsService.redeemInviteCode);
const listApiTokensMock = jest.mocked(apiTokenService.listApiTokens);
const createApiTokenMock = jest.mocked(apiTokenService.createApiToken);
const revokeApiTokenMock = jest.mocked(apiTokenService.revokeApiToken);

const testPreferences: AgentPreferences = {
  defaultSeriesColors: ["#ff0000"],
  defaultPanelStyle: { background: "#111111" },
  namingConventions: { titleCase: true },
  extras: { favoriteChart: "bar" },
};

const testEntry: AgentMemoryEntry = {
  id: "mem-1",
  kind: "fact",
  content: "Prefers dark mode.",
  createdAt: "2026-08-01T00:00:00Z",
  lastUsedAt: null,
};

const testBetaUser: User = {
  id: "user-1",
  email: "user@example.com",
  displayName: null,
  avatarUrl: null,
  createdAt: "2026-08-01T00:00:00Z",
  tier: "beta",
};

const testApiToken: ApiTokenResponse = {
  id: "tok-1",
  name: "helio-mcp",
  createdAt: "2026-08-01T00:00:00Z",
  lastUsedAt: null,
  expiresAt: null,
};

const testCreatedApiToken: CreateApiTokenResponse = {
  id: "tok-2",
  name: "ci-runner",
  token: "helio_pat_abc123",
  createdAt: "2026-08-02T00:00:00Z",
  expiresAt: null,
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("settingsSlice preferences reducers", () => {
  it("sets loading status when fetchPreferences is pending", () => {
    const nextState = settingsReducer(undefined, fetchPreferences.pending("req-1"));
    expect(nextState.preferences.status).toBe("loading");
    expect(nextState.preferences.error).toBeNull();
  });

  it("populates preferences data when fetchPreferences fulfills", () => {
    const nextState = settingsReducer(
      undefined,
      fetchPreferences.fulfilled(testPreferences, "req-1"),
    );
    expect(nextState.preferences.status).toBe("succeeded");
    expect(nextState.preferences.data).toEqual(testPreferences);
    expect(nextState.preferences.error).toBeNull();
  });

  it("sets error status when fetchPreferences rejects", () => {
    const nextState = settingsReducer(
      undefined,
      fetchPreferences.rejected(null, "req-1", undefined, "Failed to load preferences."),
    );
    expect(nextState.preferences.status).toBe("failed");
    expect(nextState.preferences.error).toBe("Failed to load preferences.");
  });

  it("sets saveStatus loading when savePreferences is pending", () => {
    const nextState = settingsReducer(undefined, savePreferences.pending("req-1", testPreferences));
    expect(nextState.preferences.saveStatus).toBe("loading");
    expect(nextState.preferences.saveError).toBeNull();
  });

  it("updates preferences data and saveStatus when savePreferences fulfills", () => {
    const saved: AgentPreferences = { ...testPreferences, defaultSeriesColors: ["#00ff00"] };
    const nextState = settingsReducer(
      undefined,
      savePreferences.fulfilled(saved, "req-1", testPreferences),
    );
    expect(nextState.preferences.data).toEqual(saved);
    expect(nextState.preferences.saveStatus).toBe("succeeded");
    expect(nextState.preferences.saveError).toBeNull();
  });

  it("sets saveError and leaves prior data untouched when savePreferences rejects", () => {
    const preloaded = settingsReducer(
      undefined,
      fetchPreferences.fulfilled(testPreferences, "req-0"),
    );
    const nextState = settingsReducer(
      preloaded,
      savePreferences.rejected(null, "req-1", testPreferences, "Failed to save preferences."),
    );
    expect(nextState.preferences.saveStatus).toBe("failed");
    expect(nextState.preferences.saveError).toBe("Failed to save preferences.");
    // The user's last-fetched data is not reverted/cleared by a failed save.
    expect(nextState.preferences.data).toEqual(testPreferences);
  });
});

describe("settingsSlice agent memory reducers", () => {
  it("sets loading status when fetchAgentMemory is pending", () => {
    const nextState = settingsReducer(undefined, fetchAgentMemory.pending("req-1"));
    expect(nextState.agentMemory.status).toBe("loading");
    expect(nextState.agentMemory.error).toBeNull();
  });

  it("populates items when fetchAgentMemory fulfills", () => {
    const nextState = settingsReducer(undefined, fetchAgentMemory.fulfilled([testEntry], "req-1"));
    expect(nextState.agentMemory.status).toBe("succeeded");
    expect(nextState.agentMemory.items).toEqual([testEntry]);
  });

  it("sets error status when fetchAgentMemory rejects", () => {
    const nextState = settingsReducer(
      undefined,
      fetchAgentMemory.rejected(null, "req-1", undefined, "Failed to load agent memory."),
    );
    expect(nextState.agentMemory.status).toBe("failed");
    expect(nextState.agentMemory.error).toBe("Failed to load agent memory.");
  });

  it("keys deleteStatus/deleteError by entry id when deleteAgentMemoryEntryThunk is pending", () => {
    const preloaded = settingsReducer(undefined, fetchAgentMemory.fulfilled([testEntry], "req-0"));
    const nextState = settingsReducer(
      preloaded,
      deleteAgentMemoryEntryThunk.pending("req-1", "mem-1"),
    );
    expect(nextState.agentMemory.deleteStatus["mem-1"]).toBe("loading");
    expect(nextState.agentMemory.deleteError["mem-1"]).toBeNull();
  });

  it("removes the deleted entry and sets deleteStatus succeeded when deleteAgentMemoryEntryThunk fulfills", () => {
    const preloaded = settingsReducer(undefined, fetchAgentMemory.fulfilled([testEntry], "req-0"));
    const nextState = settingsReducer(
      preloaded,
      deleteAgentMemoryEntryThunk.fulfilled("mem-1", "req-1", "mem-1"),
    );
    expect(nextState.agentMemory.items).toEqual([]);
    expect(nextState.agentMemory.deleteStatus["mem-1"]).toBe("succeeded");
  });

  it("sets deleteError keyed by id when deleteAgentMemoryEntryThunk rejects", () => {
    const nextState = settingsReducer(
      undefined,
      deleteAgentMemoryEntryThunk.rejected(
        null,
        "req-1",
        "mem-1",
        "Failed to delete memory entry.",
      ),
    );
    expect(nextState.agentMemory.deleteStatus["mem-1"]).toBe("failed");
    expect(nextState.agentMemory.deleteError["mem-1"]).toBe("Failed to delete memory entry.");
  });

  it("sets clearStatus loading when clearAgentMemoryThunk is pending", () => {
    const nextState = settingsReducer(undefined, clearAgentMemoryThunk.pending("req-1"));
    expect(nextState.agentMemory.clearStatus).toBe("loading");
    expect(nextState.agentMemory.clearError).toBeNull();
  });

  it("empties items and sets clearStatus succeeded when clearAgentMemoryThunk fulfills", () => {
    const preloaded = settingsReducer(undefined, fetchAgentMemory.fulfilled([testEntry], "req-0"));
    const nextState = settingsReducer(
      preloaded,
      clearAgentMemoryThunk.fulfilled(undefined, "req-1"),
    );
    expect(nextState.agentMemory.items).toEqual([]);
    expect(nextState.agentMemory.clearStatus).toBe("succeeded");
  });

  it("sets clearError when clearAgentMemoryThunk rejects", () => {
    const nextState = settingsReducer(
      undefined,
      clearAgentMemoryThunk.rejected(null, "req-1", undefined, "Failed to clear agent memory."),
    );
    expect(nextState.agentMemory.clearStatus).toBe("failed");
    expect(nextState.agentMemory.clearError).toBe("Failed to clear agent memory.");
  });
});

describe("settingsSlice betaAccess reducers", () => {
  it("sets requestStatus loading when requestBetaAccessThunk is pending", () => {
    const nextState = settingsReducer(undefined, requestBetaAccessThunk.pending("req-1"));
    expect(nextState.betaAccess.requestStatus).toBe("loading");
    expect(nextState.betaAccess.requestError).toBeNull();
  });

  it("sets requestStatus succeeded when requestBetaAccessThunk fulfills", () => {
    const nextState = settingsReducer(
      undefined,
      requestBetaAccessThunk.fulfilled(undefined, "req-1"),
    );
    expect(nextState.betaAccess.requestStatus).toBe("succeeded");
    expect(nextState.betaAccess.requestError).toBeNull();
  });

  it("sets requestError when requestBetaAccessThunk rejects", () => {
    const nextState = settingsReducer(
      undefined,
      requestBetaAccessThunk.rejected(null, "req-1", undefined, "Failed to request Beta access."),
    );
    expect(nextState.betaAccess.requestStatus).toBe("failed");
    expect(nextState.betaAccess.requestError).toBe("Failed to request Beta access.");
  });

  it("sets redeemStatus loading when redeemInviteCodeThunk is pending", () => {
    const nextState = settingsReducer(undefined, redeemInviteCodeThunk.pending("req-1", "CODE1"));
    expect(nextState.betaAccess.redeemStatus).toBe("loading");
    expect(nextState.betaAccess.redeemError).toBeNull();
  });

  it("sets redeemStatus succeeded when redeemInviteCodeThunk fulfills", () => {
    const nextState = settingsReducer(
      undefined,
      redeemInviteCodeThunk.fulfilled(testBetaUser, "req-1", "CODE1"),
    );
    expect(nextState.betaAccess.redeemStatus).toBe("succeeded");
    expect(nextState.betaAccess.redeemError).toBeNull();
  });

  it("sets redeemError when redeemInviteCodeThunk rejects", () => {
    const nextState = settingsReducer(
      undefined,
      redeemInviteCodeThunk.rejected(null, "req-1", "CODE1", "Invalid or already-used invite code"),
    );
    expect(nextState.betaAccess.redeemStatus).toBe("failed");
    expect(nextState.betaAccess.redeemError).toBe("Invalid or already-used invite code");
  });
});

describe("requestBetaAccessThunk", () => {
  it("calls settingsService.requestBetaAccess on success", async () => {
    requestBetaAccessMock.mockResolvedValueOnce(undefined);

    const dispatch = jest.fn();
    const thunk = requestBetaAccessThunk();
    await thunk(dispatch, jest.fn(), undefined);

    expect(requestBetaAccessMock).toHaveBeenCalledTimes(1);
    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "settings/requestBetaAccess/fulfilled")).toBe(
      true,
    );
  });

  it("dispatches rejected on service error", async () => {
    requestBetaAccessMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = requestBetaAccessThunk();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "settings/requestBetaAccess/rejected")).toBe(
      true,
    );
  });
});

describe("redeemInviteCodeThunk", () => {
  it("calls settingsService.redeemInviteCode and dispatches setAuth with the returned user", async () => {
    redeemInviteCodeMock.mockResolvedValueOnce(testBetaUser);

    const dispatch = jest.fn();
    const thunk = redeemInviteCodeThunk("CODE1");
    await thunk(dispatch, jest.fn(), undefined);

    expect(redeemInviteCodeMock).toHaveBeenCalledWith("CODE1");
    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const setAuthCall = calls.find(([action]) => action.type === "auth/setAuth");
    expect(setAuthCall?.[0].payload).toEqual({ user: testBetaUser });

    const fulfilledCall = calls.find(
      ([action]) => action.type === "settings/redeemInviteCode/fulfilled",
    );
    expect(fulfilledCall?.[0].payload).toEqual(testBetaUser);
  });

  it("dispatches rejected (and never setAuth) on an invalid code", async () => {
    redeemInviteCodeMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = redeemInviteCodeThunk("BAD-CODE");
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "settings/redeemInviteCode/rejected")).toBe(
      true,
    );
    expect(calls.some(([action]) => action.type === "auth/setAuth")).toBe(false);
  });
});

describe("fetchPreferences thunk", () => {
  it("dispatches fulfilled with preferences on success", async () => {
    getPreferencesMock.mockResolvedValueOnce(testPreferences);

    const dispatch = jest.fn();
    const thunk = fetchPreferences();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "settings/fetchPreferences/fulfilled",
    );
    expect(fulfilledCall?.[0].payload).toEqual(testPreferences);
  });

  it("dispatches rejected on service error", async () => {
    getPreferencesMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = fetchPreferences();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "settings/fetchPreferences/rejected")).toBe(
      true,
    );
  });
});

describe("savePreferences thunk", () => {
  it("calls settingsService.putPreferences with the request payload", async () => {
    putPreferencesMock.mockResolvedValueOnce(testPreferences);

    const dispatch = jest.fn();
    const request = {
      defaultSeriesColors: ["#ff0000"],
      defaultPanelStyle: { background: "#111111" },
      namingConventions: { titleCase: true },
      extras: { favoriteChart: "bar" },
    };
    const thunk = savePreferences(request);
    await thunk(dispatch, jest.fn(), undefined);

    expect(putPreferencesMock).toHaveBeenCalledWith(request);
  });

  it("dispatches rejected on service error", async () => {
    putPreferencesMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = savePreferences({
      defaultSeriesColors: null,
      defaultPanelStyle: null,
      namingConventions: null,
      extras: null,
    });
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "settings/savePreferences/rejected")).toBe(
      true,
    );
  });
});

describe("fetchAgentMemory thunk", () => {
  it("dispatches fulfilled with the entry list on success", async () => {
    listAgentMemoryMock.mockResolvedValueOnce([testEntry]);

    const dispatch = jest.fn();
    const thunk = fetchAgentMemory();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "settings/fetchAgentMemory/fulfilled",
    );
    expect(fulfilledCall?.[0].payload).toEqual([testEntry]);
  });

  it("dispatches rejected on service error", async () => {
    listAgentMemoryMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = fetchAgentMemory();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "settings/fetchAgentMemory/rejected")).toBe(
      true,
    );
  });
});

describe("deleteAgentMemoryEntryThunk", () => {
  it("calls settingsService.deleteAgentMemoryEntry and resolves with the deleted id", async () => {
    deleteAgentMemoryEntryMock.mockResolvedValueOnce(undefined);

    const dispatch = jest.fn();
    const thunk = deleteAgentMemoryEntryThunk("mem-1");
    await thunk(dispatch, jest.fn(), undefined);

    expect(deleteAgentMemoryEntryMock).toHaveBeenCalledWith("mem-1");
    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "settings/deleteAgentMemoryEntry/fulfilled",
    );
    expect(fulfilledCall?.[0].payload).toBe("mem-1");
  });

  it("dispatches rejected on service error", async () => {
    deleteAgentMemoryEntryMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = deleteAgentMemoryEntryThunk("mem-1");
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(
      calls.some(([action]) => action.type === "settings/deleteAgentMemoryEntry/rejected"),
    ).toBe(true);
  });
});

describe("clearAgentMemoryThunk", () => {
  it("calls settingsService.clearAgentMemory on success", async () => {
    clearAgentMemoryMock.mockResolvedValueOnce(undefined);

    const dispatch = jest.fn();
    const thunk = clearAgentMemoryThunk();
    await thunk(dispatch, jest.fn(), undefined);

    expect(clearAgentMemoryMock).toHaveBeenCalledTimes(1);
    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "settings/clearAgentMemory/fulfilled")).toBe(
      true,
    );
  });

  it("dispatches rejected on service error", async () => {
    clearAgentMemoryMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = clearAgentMemoryThunk();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "settings/clearAgentMemory/rejected")).toBe(
      true,
    );
  });
});

describe("settingsSlice apiTokens reducers", () => {
  it("sets loading status when fetchApiTokens is pending", () => {
    const nextState = settingsReducer(undefined, fetchApiTokens.pending("req-1"));
    expect(nextState.apiTokens.status).toBe("loading");
    expect(nextState.apiTokens.error).toBeNull();
  });

  it("populates items when fetchApiTokens fulfills", () => {
    const nextState = settingsReducer(undefined, fetchApiTokens.fulfilled([testApiToken], "req-1"));
    expect(nextState.apiTokens.status).toBe("succeeded");
    expect(nextState.apiTokens.items).toEqual([testApiToken]);
  });

  it("sets error status when fetchApiTokens rejects", () => {
    const nextState = settingsReducer(
      undefined,
      fetchApiTokens.rejected(null, "req-1", undefined, "Failed to load personal access tokens."),
    );
    expect(nextState.apiTokens.status).toBe("failed");
    expect(nextState.apiTokens.error).toBe("Failed to load personal access tokens.");
  });

  it("sets createStatus loading when createApiTokenThunk is pending", () => {
    const nextState = settingsReducer(undefined, createApiTokenThunk.pending("req-1", "ci-runner"));
    expect(nextState.apiTokens.createStatus).toBe("loading");
    expect(nextState.apiTokens.createError).toBeNull();
  });

  // design.md "Shown-once reveal": createApiTokenThunk.fulfilled sets
  // `createdToken` AND appends the new token's metadata to `items` in the
  // SAME reducer, atomically -- not gated behind a later dismiss action.
  it("sets createdToken and appends the new token's metadata to items when createApiTokenThunk fulfills, in the same reducer", () => {
    const preloaded = settingsReducer(undefined, fetchApiTokens.fulfilled([testApiToken], "req-0"));
    const nextState = settingsReducer(
      preloaded,
      createApiTokenThunk.fulfilled(testCreatedApiToken, "req-1", "ci-runner"),
    );
    expect(nextState.apiTokens.createStatus).toBe("succeeded");
    expect(nextState.apiTokens.createdToken).toEqual(testCreatedApiToken);
    expect(nextState.apiTokens.items).toEqual([
      testApiToken,
      {
        id: testCreatedApiToken.id,
        name: testCreatedApiToken.name,
        createdAt: testCreatedApiToken.createdAt,
        lastUsedAt: null,
        expiresAt: testCreatedApiToken.expiresAt,
      },
    ]);
    // The raw token value is never stored in `items` — only in the
    // transient, shown-once `createdToken` field.
    expect(nextState.apiTokens.items.some((t) => "token" in t)).toBe(false);
  });

  it("sets createError when createApiTokenThunk rejects", () => {
    const nextState = settingsReducer(
      undefined,
      createApiTokenThunk.rejected(null, "req-1", "ci-runner", "Failed to create token."),
    );
    expect(nextState.apiTokens.createStatus).toBe("failed");
    expect(nextState.apiTokens.createError).toBe("Failed to create token.");
  });

  it("clears createdToken (but not items) when dismissCreatedApiToken is dispatched", () => {
    const preloaded = settingsReducer(
      undefined,
      createApiTokenThunk.fulfilled(testCreatedApiToken, "req-1", "ci-runner"),
    );
    expect(preloaded.apiTokens.createdToken).not.toBeNull();
    const nextState = settingsReducer(preloaded, dismissCreatedApiToken());
    expect(nextState.apiTokens.createdToken).toBeNull();
    expect(nextState.apiTokens.items).toHaveLength(1);
  });

  it("keys revokeStatus/revokeError by token id when revokeApiTokenThunk is pending", () => {
    const preloaded = settingsReducer(undefined, fetchApiTokens.fulfilled([testApiToken], "req-0"));
    const nextState = settingsReducer(preloaded, revokeApiTokenThunk.pending("req-1", "tok-1"));
    expect(nextState.apiTokens.revokeStatus["tok-1"]).toBe("loading");
    expect(nextState.apiTokens.revokeError["tok-1"]).toBeNull();
  });

  it("removes the revoked token and sets revokeStatus succeeded when revokeApiTokenThunk fulfills", () => {
    const preloaded = settingsReducer(undefined, fetchApiTokens.fulfilled([testApiToken], "req-0"));
    const nextState = settingsReducer(
      preloaded,
      revokeApiTokenThunk.fulfilled("tok-1", "req-1", "tok-1"),
    );
    expect(nextState.apiTokens.items).toEqual([]);
    expect(nextState.apiTokens.revokeStatus["tok-1"]).toBe("succeeded");
  });

  it("sets revokeError keyed by id when revokeApiTokenThunk rejects", () => {
    const nextState = settingsReducer(
      undefined,
      revokeApiTokenThunk.rejected(null, "req-1", "tok-1", "Failed to revoke token."),
    );
    expect(nextState.apiTokens.revokeStatus["tok-1"]).toBe("failed");
    expect(nextState.apiTokens.revokeError["tok-1"]).toBe("Failed to revoke token.");
  });
});

describe("fetchApiTokens thunk", () => {
  it("dispatches fulfilled with the token list on success", async () => {
    listApiTokensMock.mockResolvedValueOnce([testApiToken]);

    const dispatch = jest.fn();
    const thunk = fetchApiTokens();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "settings/fetchApiTokens/fulfilled",
    );
    expect(fulfilledCall?.[0].payload).toEqual([testApiToken]);
  });

  it("dispatches rejected on service error", async () => {
    listApiTokensMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = fetchApiTokens();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "settings/fetchApiTokens/rejected")).toBe(true);
  });
});

describe("createApiTokenThunk", () => {
  it("calls apiTokenService.createApiToken with the given name", async () => {
    createApiTokenMock.mockResolvedValueOnce(testCreatedApiToken);

    const dispatch = jest.fn();
    const thunk = createApiTokenThunk("ci-runner");
    await thunk(dispatch, jest.fn(), undefined);

    expect(createApiTokenMock).toHaveBeenCalledWith({ name: "ci-runner" });
    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "settings/createApiToken/fulfilled",
    );
    expect(fulfilledCall?.[0].payload).toEqual(testCreatedApiToken);
  });

  it("dispatches rejected on service error", async () => {
    createApiTokenMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = createApiTokenThunk("ci-runner");
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "settings/createApiToken/rejected")).toBe(true);
  });
});

describe("revokeApiTokenThunk", () => {
  it("calls apiTokenService.revokeApiToken and resolves with the revoked id", async () => {
    revokeApiTokenMock.mockResolvedValueOnce(undefined);

    const dispatch = jest.fn();
    const thunk = revokeApiTokenThunk("tok-1");
    await thunk(dispatch, jest.fn(), undefined);

    expect(revokeApiTokenMock).toHaveBeenCalledWith("tok-1");
    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "settings/revokeApiToken/fulfilled",
    );
    expect(fulfilledCall?.[0].payload).toBe("tok-1");
  });

  it("dispatches rejected on service error", async () => {
    revokeApiTokenMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = revokeApiTokenThunk("tok-1");
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "settings/revokeApiToken/rejected")).toBe(true);
  });
});
