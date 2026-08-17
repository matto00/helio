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

  // F-068 — a free-tier user has no conversations to browse (ActiveConversationPanel renders its
  // request-access state instead), so the link to the full list is misleading and should be hidden.
  it("hides the 'Browse all conversations' link for a free-tier user", () => {
    renderWithStore(<QuickLauncherOverlay open onClose={jest.fn()} />, {
      auth: {
        currentUser: {
          id: "user-free",
          email: "free@test.local",
          displayName: null,
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          tier: "free",
        },
      },
    });

    expect(screen.queryByText("Browse all conversations →")).not.toBeInTheDocument();
  });

  it("shows the 'Browse all conversations' link for a non-free-tier user", async () => {
    renderWithStore(<QuickLauncherOverlay open onClose={jest.fn()} />, {
      auth: {
        currentUser: {
          id: "user-owner",
          email: "owner@test.local",
          displayName: null,
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          tier: "owner",
        },
      },
    });

    await waitFor(() => expect(screen.getByText("Browse all conversations →")).toBeInTheDocument());
  });

  // F-104 regression — this used to re-dispatch `fetchConversations()` on
  // every open with no dedupe guard, even when the list was already loaded
  // (e.g. from a prior /chat visit in the same session). Reopening the
  // quick-launcher (Ctrl/Cmd+K) fired a fresh GET every time.
  it("does not refetch conversations on open when the list is already loaded", async () => {
    const { rerender } = renderWithStore(
      <QuickLauncherOverlay open={false} onClose={jest.fn()} />,
      {
        assistantConversations: { items: [], status: "succeeded" },
      },
    );

    rerender(<QuickLauncherOverlay open onClose={jest.fn()} />);

    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());
    expect(listConversationsMock).not.toHaveBeenCalled();
  });
});
