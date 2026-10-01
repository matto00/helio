import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";

import { listConversations as listConversationsRequest } from "../services/assistantConversationsService";
import { renderWithStore } from "../../../test/renderWithStore";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { ChatPage } from "./ChatPage";

jest.mock("../services/assistantConversationsService", () => ({
  listConversations: jest.fn(),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
  createConversation: jest.fn(),
  converse: jest.fn(),
}));

const listConversationsMock = jest.mocked(listConversationsRequest);

describe("ChatPage", () => {
  beforeEach(() => {
    listConversationsMock.mockReset();
    listConversationsMock.mockResolvedValue([]);
  });

  it("renders the page shell and fetches conversations on mount", async () => {
    renderWithStore(<ChatPage />);

    expect(document.querySelector(".chat-page")).toBeInTheDocument();
    await waitFor(() => expect(listConversationsMock).toHaveBeenCalledTimes(1));
  });

  it("shows the empty state when there are no conversations", async () => {
    renderWithStore(<ChatPage />);

    await waitFor(() => expect(screen.getByText("No conversations yet")).toBeInTheDocument());
  });

  // HEL-665 (reopened composer ticket) tasks.md 6.6 -- the composer is available on /chat via the
  // shared ActiveConversationPanel, no separate implementation.
  it("renders the message composer via the shared ActiveConversationPanel", async () => {
    renderWithStore(<ChatPage />);

    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  // F-104 — navigating away from /chat and back (an unmount/remount of
  // `ChatPage`, e.g. a route change) must not re-issue `fetchConversations`
  // once the list already loaded successfully; only the internal `status`
  // guard added to the mount effect prevents this (`fetchConversations`
  // itself has no dedupe `condition`).
  it("does not re-fetch conversations on remount once the list has already loaded", async () => {
    const { store, unmount } = renderWithStore(<ChatPage />);
    await waitFor(() => expect(listConversationsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.getState().assistantConversations.status).toBe("succeeded"));
    unmount();

    render(
      <MemoryRouter>
        <ThemeProvider>
          <Provider store={store}>
            <OverlayProvider>
              <ChatPage />
            </OverlayProvider>
          </Provider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("No conversations yet")).toBeInTheDocument());
    expect(listConversationsMock).toHaveBeenCalledTimes(1);
  });

  // HEL-1209 — "Refine with the assistant" hands a draft over via router state; it prefills the
  // composer once, in a fresh conversation, and does not linger in history state.
  describe("refine hand-off draft", () => {
    const draft = 'I just dropped the CSV "Sales" (source id s-1). Please refine it: ';
    const renderWithDraft = (state: unknown) =>
      renderWithStore(
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace state={state} />} />
          <Route path="/chat" element={<ChatPage />} />
        </Routes>,
        {
          auth: {
            status: "authenticated",
            currentUser: {
              id: "u1",
              email: "a@b.c",
              displayName: null,
              avatarUrl: null,
              createdAt: "2026-01-01T00:00:00Z",
              tier: "beta",
            },
          },
          assistantConversations: {
            items: [
              {
                id: "c1",
                title: "Earlier",
                pinned: false,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              } as never,
            ],
            status: "succeeded",
            selectedConversationId: "c1",
          },
        },
      );

    it("prefills the composer with the draft and starts a new conversation", async () => {
      const { store } = renderWithDraft({ draft });

      await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(draft));
      expect(store.getState().assistantConversations.startingNewConversation).toBe(true);
    });

    it("leaves the composer empty and the open conversation alone when no draft is handed over", async () => {
      const { store } = renderWithDraft(null);

      await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
      expect(store.getState().assistantConversations.startingNewConversation).toBe(false);
    });
  });
});
