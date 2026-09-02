import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";

import { assistantConversationsReducer } from "../../features/assistant/state/assistantConversationsSlice";
import * as assistantConversationsService from "../../features/assistant/services/assistantConversationsService";
import type { AssistantConversationSummary } from "../../features/assistant/types";
import { authReducer } from "../../features/auth/state/authSlice";
import type { User, UserTier } from "../../features/auth/types/user";
import { pipelinesReducer } from "../../features/pipelines/state/pipelinesSlice";
import * as pipelineService from "../../features/pipelines/services/pipelineService";
import type { PipelineSummary } from "../../features/pipelines/types/pipelineStep";
import { sourcesReducer } from "../../features/sources/state/sourcesSlice";
import { SidebarBody } from "./SidebarBody";

jest.mock("../../features/pipelines/services/pipelineService", () => ({
  getPipelines: jest.fn(),
}));

jest.mock("../../features/assistant/services/assistantConversationsService", () => ({
  listConversations: jest.fn(),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
}));

const getPipelinesMock = jest.mocked(pipelineService.getPipelines);
const listConversationsMock = jest.mocked(assistantConversationsService.listConversations);
const updateConversationMock = jest.mocked(assistantConversationsService.updateConversation);

beforeEach(() => {
  getPipelinesMock.mockReset();
  getPipelinesMock.mockResolvedValue([]);
  listConversationsMock.mockReset();
  listConversationsMock.mockResolvedValue([]);
  updateConversationMock.mockReset();
});

function buildPipeline(overrides: Partial<PipelineSummary>): PipelineSummary {
  return {
    id: "pipe-1",
    name: "Revenue ETL",
    sourceDataSourceId: "src-1",
    sourceDataSourceName: "Profit",
    lastRunStatus: "succeeded",
    lastRunAt: "2026-01-01T00:00:00Z",
    lastRunRowCount: 10,
    ...overrides,
  };
}

interface StoreOptions {
  pipelineItems?: PipelineSummary[];
  pipelineStatus?: "idle" | "loading" | "succeeded" | "failed";
  conversationItems?: AssistantConversationSummary[];
  conversationStatus?: "idle" | "loading" | "succeeded" | "failed";
  /** HEL-703 cycle 2 — defaults to `null` (unauthenticated-shaped state), which behaves
   *  identically to every pre-existing test here: `currentUser?.tier === "free"` is `false`
   *  whenever `currentUser` is `null`, so the chat section's normal (non-gated) branch renders. */
  currentUser?: User | null;
}

function buildUser(tier: UserTier): User {
  return {
    id: `user-${tier}`,
    email: `${tier}@test.local`,
    displayName: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    tier,
  };
}

function makeStore(options: StoreOptions = {}) {
  const {
    pipelineItems = [],
    pipelineStatus = "idle",
    conversationItems = [],
    conversationStatus = "idle",
    currentUser = null,
  } = options;
  return configureStore({
    reducer: {
      auth: authReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      assistantConversations: assistantConversationsReducer,
    } as never,
    preloadedState: {
      auth: {
        status: "idle" as const,
        currentUser,
      },
      pipelines: {
        items: pipelineItems,
        status: pipelineStatus,
        error: null,
        // HEL-548 D4/5.3 — useCreatePipelineAction()'s dispatch target;
        // SidebarBody itself never reads this field, but a test asserting
        // the CTA's effect needs a real starting value, not `undefined`.
        createModalOpen: false,
      },
      assistantConversations: {
        items: conversationItems,
        status: conversationStatus,
        error: null,
        selectedConversationId: null,
        activeConversation: { data: null, status: "idle" as const, error: null },
      },
    } as never,
  });
}

/** Surfaces `useNavigate()` calls made from inside `SidebarBody` for
 *  assertion — there's no `<Routes>` table here otherwise, so a click that
 *  navigates would be silently unobservable (F-017's "Request access in
 *  Settings" CTA regression test needs this). */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderAt(path: string, options: StoreOptions = {}) {
  const store = makeStore(options);
  return {
    store,
    ...render(
      <MemoryRouter initialEntries={[path]}>
        <Provider store={store}>
          <SidebarBody />
        </Provider>
        <LocationProbe />
      </MemoryRouter>,
    ),
  };
}

describe("SidebarBody — regression check for other sections", () => {
  it("renders the sources sidebar list with no badge markup", () => {
    renderAt("/sources");
    expect(document.querySelector(".dashboard-list__badge")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
  });

  it("renders the pipelines sidebar list with no badge markup", () => {
    renderAt("/pipelines");
    expect(document.querySelector(".dashboard-list__badge")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data Pipelines" })).toBeInTheDocument();
  });

  // F-016: Settings and the proposal/patch-set review routes aren't a list section — this used to
  // fall through to the dashboards `DashboardList` default (a "DASHBOARDS" heading with no active
  // nav item, and a dead-end dashboard picker). It renders nothing now.
  it.each(["/settings", "/proposals/review", "/patch-sets/review"])(
    "renders nothing for the non-list route %s",
    (path) => {
      renderAt(path);
      expect(document.querySelector(".dashboard-list")).not.toBeInTheDocument();
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    },
  );
});

describe("SidebarBody pipelines section — delete-dependency warning (F-144)", () => {
  function openDeleteConfirm(itemName: string) {
    fireEvent.click(screen.getByRole("button", { name: `${itemName} actions` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  }

  // HEL-909: the warning's copy is retired from naming a specific DataType
  // (the DataType feature is gone) to a generic Output-impact warning, shown
  // for any known pipeline.
  it("warns that deleting a pipeline may break panels bound to its Outputs", () => {
    renderAt("/pipelines", {
      pipelineItems: [buildPipeline({ id: "pipe-1", name: "Revenue ETL" })],
      pipelineStatus: "succeeded",
    });

    openDeleteConfirm("Revenue ETL");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Any panels bound to this pipeline's Outputs will stop working.",
    );
  });
});

function buildConversation(
  overrides: Partial<AssistantConversationSummary>,
): AssistantConversationSummary {
  return {
    id: "conv-1",
    title: "Netflix dashboard build",
    pinned: false,
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

// HEL-703 design.md D9 (cycle-2 evaluator CR1) — this was the one `fetchConversations()` dispatch
// site the original pass never gated (`ChatPage.tsx`/`QuickLauncherOverlay.tsx` were gated
// correctly). A free-tier user landing directly on `/chat` drives the sidebar's list through
// THIS component, not through either of those two.
describe("SidebarBody chat section — tier gating (HEL-703 cycle 2)", () => {
  it("a free-tier user sees the locked state with a working link to the self-serve request flow, not the raw list/error, and never fetches", async () => {
    renderAt("/chat", { currentUser: buildUser("free") });

    expect(screen.getByText("Assistant access is limited")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Assistant access is limited during this rollout. Request access in Settings.",
      ),
    ).toBeInTheDocument();
    // Neither the generic "No conversations yet" empty state nor its "+ New chat" CTA renders —
    // starting a conversation is not actually possible for this user.
    expect(screen.queryByText("No conversations yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();
    // No filter box either — none of the list chrome applies to a locked section.
    expect(screen.queryByLabelText("Filter chat by name")).not.toBeInTheDocument();

    // F-056: a compact, single-purpose locked notice, not the same
    // icon+title+description(+CTA) `EmptyState` card `ActiveConversationPanel`'s
    // main-content pane renders (just scaled down) — the two used to read as
    // an accidental duplicate stacked in one viewport.
    expect(document.querySelector(".sidebar-body__locked-notice")).toBeInTheDocument();
    expect(document.querySelector(".ui-empty-state")).not.toBeInTheDocument();

    // F-017: the locked state used to be a dead end ("Contact the workspace owner", no link) even
    // though a self-serve "Request Beta access" flow already exists in Settings. Now it's a real
    // CTA into that flow.
    fireEvent.click(screen.getByRole("button", { name: "Request access in Settings" }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/settings");

    // Give any pending effect a chance to run, then assert the fetch never fired.
    await Promise.resolve();
    expect(listConversationsMock).not.toHaveBeenCalled();
  });

  it("a beta-tier user still sees the normal chat section (list fetch + New chat)", async () => {
    renderAt("/chat", { currentUser: buildUser("beta"), conversationStatus: "idle" });

    await waitFor(() => expect(listConversationsMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Assistant access is limited")).not.toBeInTheDocument();
    // Two elements share this accessible name at zero conversations: the header "+" button and
    // the empty-state's own CTA (both use `addLabel="New chat"`) — either is proof the normal,
    // ungated branch rendered.
    expect(screen.getAllByRole("button", { name: "New chat" }).length).toBeGreaterThan(0);
  });

  it("an owner-tier user still sees the normal chat section (list fetch + New chat)", async () => {
    renderAt("/chat", { currentUser: buildUser("owner"), conversationStatus: "idle" });

    await waitFor(() => expect(listConversationsMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Assistant access is limited")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New chat" }).length).toBeGreaterThan(0);
  });
});

describe("SidebarBody chat section — conversation list (HEL-664)", () => {
  it("renders conversations in the exact order the API returned them, no client re-sort", () => {
    // A pinned conversation with an OLDER updatedAt than the unpinned one —
    // if the list re-sorted by updatedAt client-side, "Older pinned" would
    // render second; server order (design.md D3) keeps it first.
    const items = [
      buildConversation({ id: "conv-pinned", title: "Older pinned", pinned: true }),
      buildConversation({ id: "conv-recent", title: "Newer unpinned", pinned: false }),
    ];
    renderAt("/chat", { conversationItems: items, conversationStatus: "succeeded" });

    const names = screen.getAllByText(/Older pinned|Newer unpinned/).map((el) => el.textContent);
    expect(names).toEqual(["Older pinned", "Newer unpinned"]);
  });

  it("shows a pin indicator on pinned items only", () => {
    const items = [
      buildConversation({ id: "conv-pinned", title: "Pinned one", pinned: true }),
      buildConversation({ id: "conv-plain", title: "Plain one", pinned: false }),
    ];
    renderAt("/chat", { conversationItems: items, conversationStatus: "succeeded" });

    const pinnedRow = screen.getByText("Pinned one").closest("li");
    const plainRow = screen.getByText("Plain one").closest("li");
    expect(pinnedRow?.querySelector('[data-testid="pin-badge"]')).toBeInTheDocument();
    expect(plainRow?.querySelector('[data-testid="pin-badge"]')).not.toBeInTheDocument();
  });

  it("renders no delete affordance for conversations (HEL-663 has no delete endpoint)", () => {
    const items = [buildConversation({})];
    renderAt("/chat", { conversationItems: items, conversationStatus: "succeeded" });

    expect(screen.queryByRole("button", { name: /actions$/ })).not.toBeInTheDocument();
  });

  it('clicking "New chat" sets startingNewConversation even with existing conversations and a selection', () => {
    const items = [buildConversation({ id: "conv-1" })];
    const { store } = renderAt("/chat", {
      conversationItems: items,
      conversationStatus: "succeeded",
    });

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    const state = store.getState() as {
      assistantConversations: { startingNewConversation: boolean };
    };
    expect(state.assistantConversations.startingNewConversation).toBe(true);
  });

  it("pinning a conversation sends PATCH {pinned: true} and shows the pinned indicator", async () => {
    updateConversationMock.mockResolvedValueOnce({
      id: "conv-1",
      title: "Netflix dashboard build",
      pinned: true,
      updatedAt: "2026-08-01T00:00:00Z",
    });
    const items = [buildConversation({ pinned: false })];
    renderAt("/chat", { conversationItems: items, conversationStatus: "succeeded" });

    // HEL-718: this icon-only row action already had aria-label; this locks
    // in the added visible title tooltip pairing it.
    const pinButton = screen.getByRole("button", { name: "Pin Netflix dashboard build" });
    expect(pinButton).toHaveAttribute("title", "Pin Netflix dashboard build");
    fireEvent.click(pinButton);

    await waitFor(() =>
      expect(updateConversationMock).toHaveBeenCalledWith("conv-1", { pinned: true }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByText("Netflix dashboard build")
          .closest("li")
          ?.querySelector('[data-testid="pin-badge"]'),
      ).toBeInTheDocument(),
    );
  });

  it("clicking the pin/unpin row action does not also select the conversation", async () => {
    updateConversationMock.mockResolvedValueOnce({
      id: "conv-1",
      title: "Netflix dashboard build",
      pinned: true,
      updatedAt: "2026-08-01T00:00:00Z",
    });
    const items = [buildConversation({ pinned: false })];
    const { store } = renderAt("/chat", {
      conversationItems: items,
      conversationStatus: "succeeded",
    });

    fireEvent.click(screen.getByRole("button", { name: "Pin Netflix dashboard build" }));

    await waitFor(() => expect(updateConversationMock).toHaveBeenCalled());
    expect(
      (store.getState() as { assistantConversations: { selectedConversationId: string | null } })
        .assistantConversations.selectedConversationId,
    ).toBeNull();
  });
});

describe("SidebarBody chat section — inline rename (HEL-693)", () => {
  function openRename() {
    // HEL-718: this icon-only row action already had aria-label; this locks
    // in the added visible title tooltip pairing it.
    const renameButton = screen.getByRole("button", { name: "Rename Netflix dashboard build" });
    expect(renameButton).toHaveAttribute("title", "Rename Netflix dashboard build");
    fireEvent.click(renameButton);
    return screen.getByRole("textbox", { name: "Rename Netflix dashboard build" });
  }

  it("renaming a conversation sends PATCH {title} and shows the new title (Enter commit path)", async () => {
    updateConversationMock.mockResolvedValueOnce({
      id: "conv-1",
      title: "New title",
      pinned: false,
      updatedAt: "2026-08-01T00:00:00Z",
    });
    const items = [buildConversation({})];
    renderAt("/chat", { conversationItems: items, conversationStatus: "succeeded" });

    const input = openRename();
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(updateConversationMock).toHaveBeenCalledWith("conv-1", { title: "New title" }),
    );
    await waitFor(() => expect(screen.getByText("New title")).toBeInTheDocument());
  });

  it("Escape cancels a rename with no PATCH and restores the original title", () => {
    const items = [buildConversation({})];
    renderAt("/chat", { conversationItems: items, conversationStatus: "succeeded" });

    const input = openRename();
    fireEvent.change(input, { target: { value: "Changed title" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(screen.getByText("Netflix dashboard build")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Rename Netflix dashboard build" }),
    ).not.toBeInTheDocument();
  });

  it("a blank-after-trim title commits nothing and marks the input invalid", () => {
    const items = [buildConversation({})];
    renderAt("/chat", { conversationItems: items, conversationStatus: "succeeded" });

    const input = openRename();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("committing an unchanged title exits edit mode with no PATCH", () => {
    const items = [buildConversation({})];
    renderAt("/chat", { conversationItems: items, conversationStatus: "succeeded" });

    const input = openRename();
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "Rename Netflix dashboard build" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Netflix dashboard build")).toBeInTheDocument();
  });

  it("a failed rename keeps the row editable and shows a role=alert error", async () => {
    updateConversationMock.mockRejectedValueOnce(new Error("Failed to rename conversation."));
    const items = [buildConversation({})];
    renderAt("/chat", { conversationItems: items, conversationStatus: "succeeded" });

    const input = openRename();
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(updateConversationMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to rename conversation."),
    );
    expect(
      screen.getByRole("textbox", { name: "Rename Netflix dashboard build" }),
    ).toBeInTheDocument();
  });

  // Evaluator Change Request 1 (evaluation-2.md) — a failed save re-enables
  // the input but, before this fix, never restored focus: DOM focus landed
  // on <body>, stranding a keyboard-only user (Escape became a no-op until
  // focus was manually reacquired via mouse/Tab). Real browsers blur a
  // focused element the instant it becomes `disabled` (per the evaluator's
  // live-browser repro); jsdom does not model this -- probed directly:
  // neither disabling a focused input nor calling `.blur()` on it while
  // disabled changes `document.activeElement` in jsdom. A plain "is the
  // input focused after the reject" assertion would therefore pass even
  // without the fix, since jsdom would simply never have lost focus in the
  // first place. Simulate the real-browser outcome by moving focus to
  // another real, focusable element (confirmed via the same probe: focusing
  // a *different* element does reliably move `document.activeElement` in
  // jsdom) before the request settles.
  it("a failed rename restores focus to the rename input so a keyboard-only user can retry or Escape", async () => {
    let rejectPatch!: (err: Error) => void;
    updateConversationMock.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectPatch = reject;
        }),
    );
    const items = [buildConversation({})];
    renderAt("/chat", { conversationItems: items, conversationStatus: "succeeded" });

    const input = openRename();
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(input).toBeDisabled());
    screen.getByRole("button", { name: "New chat" }).focus();
    expect(input).not.toHaveFocus();

    rejectPatch(new Error("Failed to rename conversation."));

    await waitFor(() => expect(input).not.toBeDisabled());
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("clicking the rename action does not also select the conversation", () => {
    const items = [buildConversation({})];
    const { store } = renderAt("/chat", {
      conversationItems: items,
      conversationStatus: "succeeded",
    });

    openRename();

    expect(
      (store.getState() as { assistantConversations: { selectedConversationId: string | null } })
        .assistantConversations.selectedConversationId,
    ).toBeNull();
  });
});
