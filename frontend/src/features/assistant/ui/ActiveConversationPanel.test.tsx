import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  converse as converseRequest,
  createConversation as createConversationRequest,
  getConversation as getConversationRequest,
} from "../services/assistantConversationsService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { AssistantConversationDetail, AssistantConversationSummary } from "../types";
import { ActiveConversationPanel } from "./ActiveConversationPanel";

jest.mock("../services/assistantConversationsService", () => ({
  listConversations: jest.fn(),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
  createConversation: jest.fn(),
  converse: jest.fn(),
}));

const getConversationMock = jest.mocked(getConversationRequest);
const createConversationMock = jest.mocked(createConversationRequest);
const converseMock = jest.mocked(converseRequest);

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
    createConversationMock.mockReset();
    converseMock.mockReset();
  });

  it("shows EmptyState when there are no conversations to select", () => {
    renderWithStore(<ActiveConversationPanel />, { assistantConversations: { items: [] } });

    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
  });

  // HEL-665 (reopened composer ticket) tasks.md 5.3/6.1 — the composer renders alongside
  // EmptyState, not behind a separate, unreachable "create conversation" step.
  it("renders the message composer alongside EmptyState when there are no conversations", () => {
    renderWithStore(<ActiveConversationPanel />, { assistantConversations: { items: [] } });

    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
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

  // HEL-665 tasks.md 5.2 — two tool_use blocks in one transcript turn render as two distinct
  // progress-indicator rows.
  it("renders two distinct tool-call indicator rows for two tool_use blocks in one turn", async () => {
    const detail: AssistantConversationDetail = {
      ...summaryOne,
      transcript: [
        {
          role: "assistant",
          content: [
            { blockType: "tool_use", id: "tu-1", name: "find", input: { query: "revenue" } },
            {
              blockType: "tool_use",
              id: "tu-2",
              name: "get_resource",
              input: { id: "dt-1", type: "dataType" },
            },
          ],
        },
      ],
    };
    getConversationMock.mockResolvedValueOnce(detail);

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: { items: [summaryOne], selectedConversationId: "conv-1" },
    });

    await waitFor(() =>
      expect(screen.getByText('Searching: find(query: "revenue")')).toBeInTheDocument(),
    );
    expect(
      screen.getByText('Looking up: get_resource(id: "dt-1", type: "dataType")'),
    ).toBeInTheDocument();
  });

  // HEL-665 tasks.md 3.1 — renders ProposalHandoff when proposalExtraction finds a result.
  it("renders the proposal hand-off card when the transcript contains a successful propose_dashboard call", async () => {
    const proposal = { dashboardName: "Revenue", panels: [] };
    const detail: AssistantConversationDetail = {
      ...summaryOne,
      transcript: [
        {
          role: "assistant",
          content: [
            { blockType: "tool_use", id: "tu-1", name: "propose_dashboard", input: proposal },
          ],
        },
        {
          role: "user",
          content: [
            {
              blockType: "tool_result",
              toolUseId: "tu-1",
              content: JSON.stringify(proposal),
              isError: false,
            },
          ],
        },
      ],
    };
    getConversationMock.mockResolvedValueOnce(detail);

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: { items: [summaryOne], selectedConversationId: "conv-1" },
    });

    expect(await screen.findByText("Proposal ready")).toBeInTheDocument();
  });

  // HEL-665 (reopened composer ticket) tasks.md 6.7 — sending a message on an EXISTING
  // conversation renders the new turns via the same MessageTurn component already used for
  // pre-existing turns, no separate rendering path.
  it("renders the new turns via MessageTurn after sending a message on an existing conversation", async () => {
    getConversationMock.mockResolvedValueOnce(detailOf(summaryOne, 0));
    const updatedDetail: AssistantConversationDetail = {
      ...summaryOne,
      transcript: [
        { role: "user", content: [{ blockType: "text", text: "What's our revenue?" }] },
        { role: "assistant", content: [{ blockType: "text", text: "Revenue is $42,000." }] },
      ],
    };
    converseMock.mockResolvedValueOnce(updatedDetail);

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: { items: [summaryOne], selectedConversationId: "conv-1" },
    });

    await waitFor(() => expect(getConversationMock).toHaveBeenCalledWith("conv-1"));

    const input = await screen.findByLabelText("Message");
    fireEvent.change(input, { target: { value: "What's our revenue?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(converseMock).toHaveBeenCalledWith("conv-1", "What's our revenue?");
    await waitFor(() => expect(screen.getByText("What's our revenue?")).toBeInTheDocument());
    expect(screen.getByText("Revenue is $42,000.")).toBeInTheDocument();
    // The composer clears its input on a successful send (a separate local-state render pass from
    // the Redux-driven transcript update above, so assert it independently).
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
  });

  // HEL-667 design.md D5/tasks.md 6.2/7.5 — a converse response with searchedWithNoResults=true
  // decorates the resulting (real, trailing-text) assistant turn with a distinct treatment.
  it("renders a distinct treatment for the most recent turn when searchedWithNoResults is true", async () => {
    getConversationMock.mockResolvedValueOnce(detailOf(summaryOne, 0));
    const updatedDetail: AssistantConversationDetail = {
      ...summaryOne,
      transcript: [
        { role: "user", content: [{ blockType: "text", text: "Find our llama data" }] },
        {
          role: "assistant",
          content: [{ blockType: "text", text: "I couldn't find anything — can you clarify?" }],
        },
      ],
      searchedWithNoResults: true,
    };
    converseMock.mockResolvedValueOnce(updatedDetail);

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: { items: [summaryOne], selectedConversationId: "conv-1" },
    });

    await waitFor(() => expect(getConversationMock).toHaveBeenCalledWith("conv-1"));
    const input = await screen.findByLabelText("Message");
    fireEvent.change(input, { target: { value: "Find our llama data" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByText("I couldn't find anything — can you clarify?")).toBeInTheDocument(),
    );
    expect(screen.getByText("Asking a follow-up")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't finish in time")).not.toBeInTheDocument();
  });

  // HEL-667 design.md D5/tasks.md 6.2/7.5 — hopBudgetExhausted=true with a real trailing text
  // block (Claude included preamble text alongside its never-executed 4th tool_use) decorates that
  // SAME turn rather than adding a separate synthetic bubble.
  it("renders a distinct treatment for the most recent turn when hopBudgetExhausted is true and a trailing text block exists", async () => {
    getConversationMock.mockResolvedValueOnce(detailOf(summaryOne, 0));
    const updatedDetail: AssistantConversationDetail = {
      ...summaryOne,
      transcript: [
        { role: "user", content: [{ blockType: "text", text: "Build me a huge dashboard" }] },
        {
          role: "assistant",
          content: [{ blockType: "text", text: "Let me check one more thing…" }],
        },
      ],
      hopBudgetExhausted: true,
    };
    converseMock.mockResolvedValueOnce(updatedDetail);

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: { items: [summaryOne], selectedConversationId: "conv-1" },
    });

    await waitFor(() => expect(getConversationMock).toHaveBeenCalledWith("conv-1"));
    const input = await screen.findByLabelText("Message");
    fireEvent.change(input, { target: { value: "Build me a huge dashboard" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByText("Let me check one more thing…")).toBeInTheDocument(),
    );
    expect(screen.getByText("Couldn't finish in time")).toBeInTheDocument();
    // No separate synthetic fallback bubble — exactly one decorated turn, the real one.
    expect(screen.getAllByText("Couldn't finish in time")).toHaveLength(1);
  });

  // HEL-667 design.md D5/tasks.md 6.2/7.5 — hopBudgetExhausted=true with NO trailing text block
  // (the transcript's last turn is a dangling tool_use, the common case) still surfaces a clear,
  // visible message rather than a silent failure (ticket AC).
  it("renders a synthesized hop-budget-exhausted message when the last turn has no trailing text", async () => {
    getConversationMock.mockResolvedValueOnce(detailOf(summaryOne, 0));
    const updatedDetail: AssistantConversationDetail = {
      ...summaryOne,
      transcript: [
        { role: "user", content: [{ blockType: "text", text: "Build me a huge dashboard" }] },
        {
          role: "assistant",
          content: [{ blockType: "tool_use", id: "tu-9", name: "find", input: { query: "x" } }],
        },
      ],
      hopBudgetExhausted: true,
    };
    converseMock.mockResolvedValueOnce(updatedDetail);

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: { items: [summaryOne], selectedConversationId: "conv-1" },
    });

    await waitFor(() => expect(getConversationMock).toHaveBeenCalledWith("conv-1"));
    const input = await screen.findByLabelText("Message");
    fireEvent.change(input, { target: { value: "Build me a huge dashboard" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(
        screen.getByText("I couldn't find enough in 3 lookups — can you narrow this down?"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Couldn't finish in time")).toBeInTheDocument();
    // The dangling tool_use itself also renders its own "cut short" indicator, independently.
    expect(screen.getByText(/cut short/i)).toBeInTheDocument();
  });

  // HEL-667 design.md D5/tasks.md 7.5 — the unaffected-normal-turn case: both signals absent
  // renders the existing, undecorated treatment.
  it("does not decorate a normal turn when neither outcome signal is set", async () => {
    getConversationMock.mockResolvedValueOnce(detailOf(summaryOne, 0));
    const updatedDetail: AssistantConversationDetail = {
      ...summaryOne,
      transcript: [
        { role: "user", content: [{ blockType: "text", text: "What's our revenue?" }] },
        { role: "assistant", content: [{ blockType: "text", text: "Revenue is $42,000." }] },
      ],
    };
    converseMock.mockResolvedValueOnce(updatedDetail);

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: { items: [summaryOne], selectedConversationId: "conv-1" },
    });

    await waitFor(() => expect(getConversationMock).toHaveBeenCalledWith("conv-1"));
    const input = await screen.findByLabelText("Message");
    fireEvent.change(input, { target: { value: "What's our revenue?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Revenue is $42,000.")).toBeInTheDocument());
    expect(screen.queryByText("Couldn't finish in time")).not.toBeInTheDocument();
    expect(screen.queryByText("Asking a follow-up")).not.toBeInTheDocument();
  });

  // HEL-665 (reopened composer ticket) tasks.md 6.8 — sending with NO conversation selected
  // creates one, explicitly selects it (design-gate round-1 fix), and converses against it in one
  // action -- the new conversation becomes the active selection, showing the sent message and its
  // response. The auto-select GET the newly-selected id triggers is left deliberately unresolved
  // here (skeptic round-2's documented benign near-concurrency, tasks.md 6.10) so this test
  // deterministically exercises the converse response alone.
  it("creates a conversation and sends to it when none is currently selected", async () => {
    createConversationMock.mockResolvedValueOnce({
      id: "new-conv",
      title: "New conversation",
      pinned: false,
      updatedAt: "2026-08-01T00:00:00Z",
      transcript: [],
    });
    getConversationMock.mockReturnValueOnce(new Promise(() => {})); // never resolves
    const newConversationDetail: AssistantConversationDetail = {
      id: "new-conv",
      title: "New conversation",
      pinned: false,
      updatedAt: "2026-08-01T00:01:00Z",
      transcript: [
        { role: "user", content: [{ blockType: "text", text: "Hello there" }] },
        { role: "assistant", content: [{ blockType: "text", text: "Hi! How can I help?" }] },
      ],
    };
    converseMock.mockResolvedValueOnce(newConversationDetail);

    const { store } = renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: { items: [] },
    });

    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "Hello there" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(createConversationMock).toHaveBeenCalledWith({}));
    await waitFor(() =>
      expect(store.getState().assistantConversations.selectedConversationId).toBe("new-conv"),
    );
    await waitFor(() => expect(converseMock).toHaveBeenCalledWith("new-conv", "Hello there"));
    await waitFor(() => expect(screen.getByText("Hello there")).toBeInTheDocument());
    expect(screen.getByText("Hi! How can I help?")).toBeInTheDocument();
  });

  // HEL-665 (reopened composer ticket) tasks.md 6.9 — a failed converse call surfaces a visible
  // error, never a silent failure, and does NOT clear the typed input so the user can retry
  // without retyping.
  it("shows a visible error and preserves the typed input when converse fails", async () => {
    getConversationMock.mockResolvedValueOnce(detailOf(summaryOne, 0));
    converseMock.mockRejectedValueOnce(new Error("Claude API error (502): upstream unavailable"));

    renderWithStore(<ActiveConversationPanel />, {
      assistantConversations: { items: [summaryOne], selectedConversationId: "conv-1" },
    });

    await waitFor(() => expect(getConversationMock).toHaveBeenCalledWith("conv-1"));

    const input = await screen.findByLabelText("Message");
    fireEvent.change(input, { target: { value: "Trigger a failure" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByText("Claude API error (502): upstream unavailable")).toBeInTheDocument(),
    );
    expect((input as HTMLTextAreaElement).value).toBe("Trigger a failure");
  });
});
