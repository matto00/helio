// One test per exported function, axios mocked — matches
// `metricService.test.ts`/`pipelineService.test.ts`'s structure.

import { httpClient } from "../../../services/httpClient";
import {
  appendTurns,
  createConversation,
  getConversation,
  listConversations,
  updateConversation,
} from "./assistantConversationsService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

const summary = {
  id: "conv-1",
  title: "Netflix dashboard build",
  pinned: false,
  updatedAt: "2026-08-01T00:00:00Z",
};

const detail = {
  ...summary,
  transcript: [{ role: "user", content: [{ blockType: "text" as const, text: "Hello" }] }],
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("assistantConversationsService", () => {
  it("listConversations GETs /api/assistant-conversations and returns the raw array", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: [summary] });

    const result = await listConversations();

    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/assistant-conversations");
    expect(result).toEqual([summary]);
  });

  it("createConversation POSTs the request body and returns the created detail", async () => {
    mockedHttpClient.post.mockResolvedValueOnce({ data: detail });

    const result = await createConversation({ title: "New chat" });

    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/assistant-conversations", {
      title: "New chat",
    });
    expect(result).toEqual(detail);
  });

  it("getConversation GETs /api/assistant-conversations/:id and returns the detail", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: detail });

    const result = await getConversation("conv-1");

    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/assistant-conversations/conv-1");
    expect(result.transcript).toHaveLength(1);
  });

  it("appendTurns POSTs to the /:id/messages sub-route with a turns array body", async () => {
    mockedHttpClient.post.mockResolvedValueOnce({ data: summary });
    const turns = [{ role: "user", content: [{ blockType: "text" as const, text: "More" }] }];

    const result = await appendTurns("conv-1", turns);

    expect(mockedHttpClient.post).toHaveBeenCalledWith(
      "/api/assistant-conversations/conv-1/messages",
      { turns },
    );
    expect(result).toEqual(summary);
  });

  it("updateConversation PATCHes /api/assistant-conversations/:id with only the given fields", async () => {
    const pinned = { ...summary, pinned: true };
    mockedHttpClient.patch.mockResolvedValueOnce({ data: pinned });

    const result = await updateConversation("conv-1", { pinned: true });

    expect(mockedHttpClient.patch).toHaveBeenCalledWith("/api/assistant-conversations/conv-1", {
      pinned: true,
    });
    expect(result.pinned).toBe(true);
  });
});
