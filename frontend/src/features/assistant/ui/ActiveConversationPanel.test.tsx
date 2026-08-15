import { screen, waitFor } from "@testing-library/react";

import { getConversation as getConversationRequest } from "../services/assistantConversationsService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { AssistantConversationDetail, AssistantConversationSummary } from "../types";
import { ActiveConversationPanel } from "./ActiveConversationPanel";

jest.mock("../services/assistantConversationsService", () => ({
  listConversations: jest.fn(),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
}));

const getConversationMock = jest.mocked(getConversationRequest);

const summaryOne: AssistantConversationSummary = {
  id: "conv-1",
  title: "Netflix dashboard build",
  pinned: false,
  updatedAt: "2026-08-01T00:00:00Z",
};

const summaryTwo: AssistantConversationSummary = {
  id: "conv-2",
  title: "Revenue pipeline debug",
  pinned: false,
  updatedAt: "2026-08-02T00:00:00Z",
};

function detailOf(
  summary: AssistantConversationSummary,
  messageCount: number,
): AssistantConversationDetail {
  return {
    ...summary,
    transcript: Array.from({ length: messageCount }, () => ({
      role: "user",
      content: [{ blockType: "text" as const, text: "hi" }],
    })),
  };
}

describe("ActiveConversationPanel", () => {
  beforeEach(() => {
    getConversationMock.mockReset();
  });

  it("shows EmptyState when there are no conversations to select", () => {
    renderWithStore(<ActiveConversationPanel />, { assistantConversations: { items: [] } });

    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
  });

  it("fetches the selected conversation's detail and renders its title and message count", async () => {
    getConversationMock.mockResolvedValueOnce(detailOf(summaryOne, 3));

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: {
        items: [summaryOne],
        selectedConversationId: "conv-1",
      },
    });

    await waitFor(() => expect(getConversationMock).toHaveBeenCalledWith("conv-1"));
    await waitFor(() => expect(screen.getByText("Netflix dashboard build")).toBeInTheDocument());
    expect(screen.getByTestId("active-conversation-message-count")).toHaveTextContent("3 messages");
  });

  it("falls back to the first item when no explicit selection is set", async () => {
    getConversationMock.mockResolvedValueOnce(detailOf(summaryOne, 1));

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: { items: [summaryOne, summaryTwo] },
    });

    await waitFor(() => expect(getConversationMock).toHaveBeenCalledWith("conv-1"));
  });

  it("replaces the active conversation cleanly when a second selection resolves", async () => {
    getConversationMock.mockResolvedValueOnce(detailOf(summaryTwo, 5));

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: {
        items: [summaryOne, summaryTwo],
        selectedConversationId: "conv-2",
        // A first conversation's detail is already loaded in state...
        activeConversation: {
          data: detailOf(summaryOne, 2),
          status: "succeeded",
        },
      },
    });

    // ...but the effective selection (conv-2) doesn't match the stale loaded
    // data (conv-1), so the panel re-fetches and never shows a stale mix.
    await waitFor(() => expect(getConversationMock).toHaveBeenCalledWith("conv-2"));
    await waitFor(() => expect(screen.getByText("Revenue pipeline debug")).toBeInTheDocument());
    expect(screen.getByTestId("active-conversation-message-count")).toHaveTextContent("5 messages");
    expect(screen.queryByText("Netflix dashboard build")).not.toBeInTheDocument();
  });

  it("shows a visible error when the detail fetch fails", async () => {
    getConversationMock.mockRejectedValueOnce(new Error("network error"));

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: {
        items: [summaryOne],
        selectedConversationId: "conv-1",
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("network error");
  });
});
