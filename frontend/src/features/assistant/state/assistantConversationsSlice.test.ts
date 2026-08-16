// Per-thunk reducer + thunk sub-suites — matches `metricsSlice.test.ts`'s
// structure.

import {
  assistantConversationsReducer,
  conversationCreated,
  converse,
  fetchConversations,
  selectConversation,
  setSelectedConversationId,
  startNewConversation,
  togglePinned,
} from "./assistantConversationsSlice";
import * as assistantConversationsService from "../services/assistantConversationsService";
import type { AssistantConversationDetail, AssistantConversationSummary } from "../types";

jest.mock("../services/assistantConversationsService", () => ({
  listConversations: jest.fn(),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
  converse: jest.fn(),
}));

const listConversationsMock = jest.mocked(assistantConversationsService.listConversations);
const getConversationMock = jest.mocked(assistantConversationsService.getConversation);
const updateConversationMock = jest.mocked(assistantConversationsService.updateConversation);
const converseMock = jest.mocked(assistantConversationsService.converse);

const summary: AssistantConversationSummary = {
  id: "conv-1",
  title: "Netflix dashboard build",
  pinned: false,
  updatedAt: "2026-08-01T00:00:00Z",
};

const detail: AssistantConversationDetail = {
  ...summary,
  transcript: [{ role: "user", content: [{ blockType: "text", text: "Hello" }] }],
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("assistantConversationsSlice reducers", () => {
  it("sets loading status when fetchConversations is pending", () => {
    const nextState = assistantConversationsReducer(undefined, fetchConversations.pending("req-1"));
    expect(nextState.status).toBe("loading");
    expect(nextState.error).toBeNull();
  });

  it("populates items when fetchConversations fulfills", () => {
    const nextState = assistantConversationsReducer(
      undefined,
      fetchConversations.fulfilled([summary], "req-1"),
    );
    expect(nextState.status).toBe("succeeded");
    expect(nextState.items).toEqual([summary]);
  });

  it("sets error status when fetchConversations rejects", () => {
    const nextState = assistantConversationsReducer(
      undefined,
      fetchConversations.rejected(null, "req-1", undefined, "Failed to load conversations."),
    );
    expect(nextState.status).toBe("failed");
    expect(nextState.error).toBe("Failed to load conversations.");
  });

  it("setSelectedConversationId updates selectedConversationId", () => {
    const nextState = assistantConversationsReducer(undefined, setSelectedConversationId("conv-1"));
    expect(nextState.selectedConversationId).toBe("conv-1");
  });

  it("startNewConversation sets startingNewConversation", () => {
    const nextState = assistantConversationsReducer(undefined, startNewConversation());
    expect(nextState.startingNewConversation).toBe(true);
  });

  it("setSelectedConversationId clears startingNewConversation -- selecting the freshly-created conversation (or any other) exits new-chat mode", () => {
    const startingNew = assistantConversationsReducer(undefined, startNewConversation());
    const nextState = assistantConversationsReducer(
      startingNew,
      setSelectedConversationId("conv-1"),
    );
    expect(nextState.startingNewConversation).toBe(false);
    expect(nextState.selectedConversationId).toBe("conv-1");
  });

  it("sets activeConversation.status to loading when selectConversation is pending", () => {
    const nextState = assistantConversationsReducer(
      undefined,
      selectConversation.pending("req-1", "conv-1"),
    );
    expect(nextState.activeConversation.status).toBe("loading");
    expect(nextState.activeConversation.error).toBeNull();
  });

  it("populates activeConversation.data when selectConversation fulfills", () => {
    const nextState = assistantConversationsReducer(
      undefined,
      selectConversation.fulfilled(detail, "req-1", "conv-1"),
    );
    expect(nextState.activeConversation.status).toBe("succeeded");
    expect(nextState.activeConversation.data).toEqual(detail);
  });

  it("a second selectConversation.fulfilled replaces the first conversation's data cleanly", () => {
    const firstLoaded = assistantConversationsReducer(
      undefined,
      selectConversation.fulfilled(detail, "req-1", "conv-1"),
    );
    const secondDetail: AssistantConversationDetail = {
      id: "conv-2",
      title: "Second conversation",
      pinned: false,
      updatedAt: "2026-08-02T00:00:00Z",
      transcript: [],
    };
    const nextState = assistantConversationsReducer(
      firstLoaded,
      selectConversation.fulfilled(secondDetail, "req-2", "conv-2"),
    );
    expect(nextState.activeConversation.data).toEqual(secondDetail);
    expect(nextState.activeConversation.data?.id).not.toBe("conv-1");
  });

  it("sets activeConversation error status when selectConversation rejects", () => {
    const nextState = assistantConversationsReducer(
      undefined,
      selectConversation.rejected(null, "req-1", "conv-1", "Failed to load conversation."),
    );
    expect(nextState.activeConversation.status).toBe("failed");
    expect(nextState.activeConversation.error).toBe("Failed to load conversation.");
  });

  it("replaces the matching item when togglePinned fulfills", () => {
    const preloaded = assistantConversationsReducer(
      undefined,
      fetchConversations.fulfilled([summary], "req-0"),
    );
    const pinned = { ...summary, pinned: true };
    const nextState = assistantConversationsReducer(
      preloaded,
      togglePinned.fulfilled(pinned, "req-1", { id: "conv-1", pinned: true }),
    );
    expect(nextState.items[0].pinned).toBe(true);
  });

  it("replaces activeConversation.data wholesale when converse fulfills, mirroring selectConversation.fulfilled", () => {
    const nextState = assistantConversationsReducer(
      undefined,
      converse.fulfilled(detail, "req-1", { id: "conv-1", message: "Hello" }),
    );
    expect(nextState.activeConversation.status).toBe("succeeded");
    expect(nextState.activeConversation.data).toEqual(detail);
  });

  // HEL-667 design.md D1/D5 — converse.fulfilled captures both new turn-outcome fields.
  it("captures hopBudgetExhausted/searchedWithNoResults into lastTurnOutcome when converse fulfills", () => {
    const detailWithSignals: AssistantConversationDetail = {
      ...detail,
      hopBudgetExhausted: true,
      searchedWithNoResults: false,
    };
    const nextState = assistantConversationsReducer(
      undefined,
      converse.fulfilled(detailWithSignals, "req-1", { id: "conv-1", message: "Hello" }),
    );
    expect(nextState.lastTurnOutcome).toEqual({
      hopBudgetExhausted: true,
      searchedWithNoResults: false,
    });
  });

  // HEL-667 design.md D1 — a converse response never omits the fields entirely in practice (POST
  // always populates them), but the reducer defaults defensively to false rather than `undefined`
  // leaking into lastTurnOutcome.
  it("defaults lastTurnOutcome fields to false when the converse response omits them", () => {
    const nextState = assistantConversationsReducer(
      undefined,
      converse.fulfilled(detail, "req-1", { id: "conv-1", message: "Hello" }),
    );
    expect(nextState.lastTurnOutcome).toEqual({
      hopBudgetExhausted: false,
      searchedWithNoResults: false,
    });
  });

  // HEL-667 design.md D5 tasks.md 6.3 — "cleared on the next send".
  it("clears lastTurnOutcome when converse.pending fires", () => {
    const withOutcome = assistantConversationsReducer(
      undefined,
      converse.fulfilled({ ...detail, hopBudgetExhausted: true }, "req-1", {
        id: "conv-1",
        message: "Hello",
      }),
    );
    expect(withOutcome.lastTurnOutcome).not.toBeNull();

    const pending = assistantConversationsReducer(
      withOutcome,
      converse.pending("req-2", { id: "conv-1", message: "Another message" }),
    );
    expect(pending.lastTurnOutcome).toBeNull();
  });

  // HEL-667 design.md D5 — switching (or reloading) a conversation never leaks a stale badge.
  it("clears lastTurnOutcome when selectConversation.pending fires", () => {
    const withOutcome = assistantConversationsReducer(
      undefined,
      converse.fulfilled({ ...detail, searchedWithNoResults: true }, "req-1", {
        id: "conv-1",
        message: "Hello",
      }),
    );
    expect(withOutcome.lastTurnOutcome).not.toBeNull();

    const pending = assistantConversationsReducer(
      withOutcome,
      selectConversation.pending("req-2", "conv-2"),
    );
    expect(pending.lastTurnOutcome).toBeNull();
  });

  // HEL-696: MessageComposer's null-conversationId send path creates a conversation outside any
  // thunk, so the sidebar needs this reducer to learn about it directly (no fetchConversations
  // round trip).
  it("conversationCreated inserts a new unpinned conversation at the front when there are no pinned items", () => {
    const preloaded = assistantConversationsReducer(
      undefined,
      fetchConversations.fulfilled([summary], "req-0"),
    );
    const created: AssistantConversationDetail = {
      id: "conv-new",
      title: "New conversation",
      pinned: false,
      updatedAt: "2026-08-16T00:00:00Z",
      transcript: [],
    };
    const nextState = assistantConversationsReducer(preloaded, conversationCreated(created));
    expect(nextState.items.map((item) => item.id)).toEqual(["conv-new", "conv-1"]);
  });

  it("conversationCreated inserts after existing pinned items, matching the backend's pinned-first, updatedAt-desc order", () => {
    const pinned = { ...summary, id: "conv-pinned", pinned: true };
    const preloaded = assistantConversationsReducer(
      undefined,
      fetchConversations.fulfilled([pinned, summary], "req-0"),
    );
    const created: AssistantConversationDetail = {
      id: "conv-new",
      title: "New conversation",
      pinned: false,
      updatedAt: "2026-08-16T00:00:00Z",
      transcript: [],
    };
    const nextState = assistantConversationsReducer(preloaded, conversationCreated(created));
    expect(nextState.items.map((item) => item.id)).toEqual(["conv-pinned", "conv-new", "conv-1"]);
  });

  it("conversationCreated stores only summary fields, dropping the detail's transcript", () => {
    const created: AssistantConversationDetail = {
      id: "conv-new",
      title: "New conversation",
      pinned: false,
      updatedAt: "2026-08-16T00:00:00Z",
      transcript: [{ role: "user", content: [{ blockType: "text", text: "Hi" }] }],
    };
    const nextState = assistantConversationsReducer(undefined, conversationCreated(created));
    expect(nextState.items).toEqual([
      {
        id: "conv-new",
        title: "New conversation",
        pinned: false,
        updatedAt: "2026-08-16T00:00:00Z",
      },
    ]);
  });

  it("converse.pending/rejected do NOT touch activeConversation.status -- the composer's own local state surfaces sending/errors, not a full-panel swap", () => {
    const preloaded = assistantConversationsReducer(
      undefined,
      selectConversation.fulfilled(detail, "req-0", "conv-1"),
    );
    const pending = assistantConversationsReducer(
      preloaded,
      converse.pending("req-1", { id: "conv-1", message: "Hello" }),
    );
    expect(pending.activeConversation.status).toBe("succeeded");
    expect(pending.activeConversation.data).toEqual(detail);

    const rejected = assistantConversationsReducer(
      pending,
      converse.rejected(
        null,
        "req-1",
        { id: "conv-1", message: "Hello" },
        "Failed to send message.",
      ),
    );
    expect(rejected.activeConversation.status).toBe("succeeded");
    expect(rejected.activeConversation.data).toEqual(detail);
  });
});

describe("fetchConversations thunk", () => {
  it("dispatches fulfilled with the conversation list on success", async () => {
    listConversationsMock.mockResolvedValueOnce([summary]);

    const dispatch = jest.fn();
    const thunk = fetchConversations();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "assistantConversations/fetchConversations/fulfilled",
    );
    expect(fulfilledCall?.[0].payload).toEqual([summary]);
  });

  it("dispatches rejected on service error", async () => {
    listConversationsMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = fetchConversations();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(
      calls.some(
        ([action]) => action.type === "assistantConversations/fetchConversations/rejected",
      ),
    ).toBe(true);
  });
});

describe("selectConversation thunk", () => {
  it("calls getConversation with the given id", async () => {
    getConversationMock.mockResolvedValueOnce(detail);

    const dispatch = jest.fn();
    const thunk = selectConversation("conv-1");
    await thunk(dispatch, jest.fn(), undefined);

    expect(getConversationMock).toHaveBeenCalledWith("conv-1");
  });
});

describe("togglePinned thunk", () => {
  it("calls updateConversation with the id and pinned flag", async () => {
    updateConversationMock.mockResolvedValueOnce({ ...summary, pinned: true });

    const dispatch = jest.fn();
    const thunk = togglePinned({ id: "conv-1", pinned: true });
    await thunk(dispatch, jest.fn(), undefined);

    expect(updateConversationMock).toHaveBeenCalledWith("conv-1", { pinned: true });
  });
});

describe("converse thunk", () => {
  it("calls the converse service function with the id and message", async () => {
    converseMock.mockResolvedValueOnce(detail);

    const dispatch = jest.fn();
    const thunk = converse({ id: "conv-1", message: "Hello" });
    await thunk(dispatch, jest.fn(), undefined);

    expect(converseMock).toHaveBeenCalledWith("conv-1", "Hello");
  });

  it("dispatches rejected with a fallback message on service error", async () => {
    converseMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = converse({ id: "conv-1", message: "Hello" });
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const rejectedCall = calls.find(
      ([action]) => action.type === "assistantConversations/converse/rejected",
    );
    expect(rejectedCall?.[0].payload).toBe("network error");
  });
});
