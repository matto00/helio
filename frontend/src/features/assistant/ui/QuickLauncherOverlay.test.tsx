import { screen, waitFor } from "@testing-library/react";

import { listConversations as listConversationsRequest } from "../services/assistantConversationsService";
import { renderWithStore } from "../../../test/renderWithStore";
import { QuickLauncherOverlay } from "./QuickLauncherOverlay";

// <dialog> showModal/close are not implemented in jsdom -- stub them so the modal's contents are
// accessible, mirroring PanelList.test.tsx's established convention.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

jest.mock("../services/assistantConversationsService", () => ({
  listConversations: jest.fn(),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
  createConversation: jest.fn(),
  converse: jest.fn(),
}));

const listConversationsMock = jest.mocked(listConversationsRequest);

describe("QuickLauncherOverlay", () => {
  beforeEach(() => {
    listConversationsMock.mockReset();
    listConversationsMock.mockResolvedValue([]);
  });

  // HEL-665 (reopened composer ticket) tasks.md 6.6 -- the SAME composer /chat renders is also
  // available from the quick-launcher overlay, via the one shared ActiveConversationPanel (no
  // second, divergent composer implementation).
  it("renders the message composer via the shared ActiveConversationPanel when open", async () => {
    renderWithStore(<QuickLauncherOverlay open onClose={jest.fn()} />);

    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("does not render the composer (or any conversation content) when closed", () => {
    renderWithStore(<QuickLauncherOverlay open={false} onClose={jest.fn()} />);

    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
  });
});
