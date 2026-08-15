// Per-thunk reducer + thunk sub-suites — matches `metricsSlice.test.ts`'s
// structure.

import {
  assistantConversationsReducer,
  fetchConversations,
  selectConversation,
  setSelectedConversationId,
  togglePinned,
} from "./assistantConversationsSlice";
import * as assistantConversationsService from "../services/assistantConversationsService";
import type { AssistantConversationDetail, AssistantConversationSummary } from "../types";

jest.mock("../services/assistantConversationsService", () => ({
  listConversations: jest.fn(),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
}));

const listConversationsMock = jest.mocked(assistantConversationsService.listConversations);
const getConversationMock = jest.mocked(assistantConversationsService.getConversation);
const updateConversationMock = jest.mocked(assistantConversationsService.updateConversation);

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
