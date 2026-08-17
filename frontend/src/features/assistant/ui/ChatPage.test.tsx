import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

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
});
