import { screen, waitFor } from "@testing-library/react";

import { listConversations as listConversationsRequest } from "../services/assistantConversationsService";
import { renderWithStore } from "../../../test/renderWithStore";
import { ChatPage } from "./ChatPage";

jest.mock("../services/assistantConversationsService", () => ({
  listConversations: jest.fn(),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
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
});
