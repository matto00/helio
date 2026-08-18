import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { httpClient } from "../../../services/httpClient";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { RefinementChatDrawer } from "./RefinementChatDrawer";
import type { PatchSet } from "../../patchSets/types/patchSet";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

const STORAGE_KEY_FOR = (dashboardId: string) => `helio.refinement.conversationId.${dashboardId}`;

/** Renders the exact `location.state.patchSet` handed off by the drawer, so tests can assert the
 *  navigate() call carried the byte-identical shape `PatchSetReviewPage.tsx` reads (design.md D6)
 *  without mocking react-router internals. */
function ReviewRouteProbe() {
  const location = useLocation();
  const state = location.state as { patchSet?: PatchSet } | null;
  const patchSet = state?.patchSet;
  return (
    <div data-testid="review-route">
      <span>{patchSet ? JSON.stringify(patchSet) : "none"}</span>
    </div>
  );
}

function DashboardSwitchHarness() {
  const [dashboardId, setDashboardId] = useState("dash-1");
  return (
    <>
      <button type="button" onClick={() => setDashboardId("dash-2")}>
        Switch dashboard
      </button>
      <RefinementChatDrawer open onClose={jest.fn()} dashboardId={dashboardId} />
    </>
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  window.sessionStorage.clear();
});

function renderDrawer(onClose: () => void = jest.fn(), dashboardId = "dash-1") {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <OverlayProvider>
        <Routes>
          <Route
            path="/"
            element={<RefinementChatDrawer open onClose={onClose} dashboardId={dashboardId} />}
          />
          <Route path="/patch-sets/review" element={<ReviewRouteProbe />} />
        </Routes>
      </OverlayProvider>
    </MemoryRouter>,
  );
}

describe("RefinementChatDrawer", () => {
  it("does not render when open=false", () => {
    render(
      <MemoryRouter>
        <OverlayProvider>
          <RefinementChatDrawer open={false} onClose={jest.fn()} dashboardId="dash-1" />
        </OverlayProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText("Refine this dashboard with AI")).not.toBeInTheDocument();
  });

  it("sends target={kind:dashboard,id:dashboardId} on submit and appends the completed turn to the thread, keeping the drawer open", async () => {
    let resolvePost: (value: { data: unknown }) => void = () => {};
    mockedHttpClient.post.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );

    renderDrawer(jest.fn(), "dash-1");

    fireEvent.change(screen.getByLabelText("Refinement message"), {
      target: { value: "Make that a bar chart" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose changes" }));

    await waitFor(() => {
      expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/refinements", {
        target: { kind: "dashboard", id: "dash-1" },
        message: "Make that a bar chart",
        conversationId: undefined,
      });
    });

    // Indeterminate progress state shown before the response lands.
    expect(screen.getByRole("status")).toHaveTextContent("Composing your patch set…");

    const patchSet: PatchSet = {
      summary: "Change chart type",
      edits: [{ target: { kind: "panel", id: "panel-1" }, op: "update", patch: { title: "x" } }],
    };
    resolvePost({ data: { patchSet, conversationId: "conv-1" } });

    await waitFor(() => {
      expect(screen.getByText("Make that a bar chart")).toBeInTheDocument();
      expect(screen.getByText("Change chart type")).toBeInTheDocument();
    });
    // Appended to the visible thread -- NOT an automatic hand-off to Review UI.
    expect(screen.queryByTestId("review-route")).not.toBeInTheDocument();

    const input = screen.getByLabelText("Refinement message") as HTMLTextAreaElement;
    expect(input.value).toBe("");
    expect(input).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & apply" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(STORAGE_KEY_FOR("dash-1"))).toBe("conv-1");
  });

  it('"Review & apply" is the only path that navigates -- hands off the latest patch set unchanged and closes the drawer', async () => {
    const patchSet: PatchSet = {
      edits: [{ target: { kind: "panel", id: "p-1" }, op: "update", patch: { title: "y" } }],
    };
    mockedHttpClient.post.mockResolvedValueOnce({ data: { patchSet, conversationId: "conv-1" } });
    const onClose = jest.fn();

    renderDrawer(onClose, "dash-1");

    fireEvent.change(screen.getByLabelText("Refinement message"), {
      target: { value: "Change it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose changes" }));
    await screen.findByRole("button", { name: "Review & apply" });

    fireEvent.click(screen.getByRole("button", { name: "Review & apply" }));

    const reviewRoute = await screen.findByTestId("review-route");
    expect(reviewRoute).toHaveTextContent(JSON.stringify(patchSet));
    expect(onClose).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(STORAGE_KEY_FOR("dash-1"))).toBeNull();
  });

  it("a reload with a stored conversationId rehydrates the thread from the GET response (design.md D4)", async () => {
    window.sessionStorage.setItem(STORAGE_KEY_FOR("dash-1"), "conv-42");
    const patchSet: PatchSet = { edits: [] };
    mockedHttpClient.get.mockResolvedValueOnce({
      data: {
        conversationId: "conv-42",
        displayTurns: [
          { role: "user", text: "Make that a bar chart" },
          { role: "assistant", text: "Proposed 0 edits" },
        ],
        latestPatchSet: patchSet,
      },
    });

    renderDrawer(jest.fn(), "dash-1");

    await waitFor(() => {
      expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/authoring/conversations/conv-42");
    });
    await waitFor(() => {
      expect(screen.getByText("Make that a bar chart")).toBeInTheDocument();
      expect(screen.getByText("Proposed 0 edits")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Review & apply" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(STORAGE_KEY_FOR("dash-1"))).toBe("conv-42");
    // Explicit regression guard (evaluation-1.md non-blocking suggestion) for the double-mount-
    // effect bug this suite's own dashboard-switch test flushed out: a single open+dashboardId
    // mount must rehydrate exactly once, never twice (a second, unmocked GET would reject and
    // clear sessionStorage — already implicitly covered above, made explicit here).
    expect(mockedHttpClient.get).toHaveBeenCalledTimes(1);
  });

  it("a stale/404 conversation id clears and starts fresh rather than erroring", async () => {
    window.sessionStorage.setItem(STORAGE_KEY_FOR("dash-1"), "conv-stale");
    const notFound = Object.assign(new Error("Not Found"), {
      isAxiosError: true,
      response: { status: 404 },
    });
    mockedHttpClient.get.mockRejectedValueOnce(notFound);

    renderDrawer(jest.fn(), "dash-1");

    await waitFor(() => {
      expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/authoring/conversations/conv-stale");
    });
    await waitFor(() => {
      expect(window.sessionStorage.getItem(STORAGE_KEY_FOR("dash-1"))).toBeNull();
    });

    expect(screen.queryByRole("list", { name: "Conversation" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Propose changes" })).toBeInTheDocument();
  });

  it("an authoring conversation's GET response (no latestPatchSet) degrades to a fresh conversation, not a crash", async () => {
    window.sessionStorage.setItem(STORAGE_KEY_FOR("dash-1"), "conv-authoring");
    mockedHttpClient.get.mockResolvedValueOnce({
      data: {
        conversationId: "conv-authoring",
        displayTurns: [{ role: "user", text: "Show total revenue" }],
        latestProposal: { dashboardName: "Sales", panels: [] },
      },
    });

    renderDrawer(jest.fn(), "dash-1");

    await waitFor(() => {
      expect(window.sessionStorage.getItem(STORAGE_KEY_FOR("dash-1"))).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Propose changes" })).toBeInTheDocument();
  });

  it("switching the target dashboard resets local state and rehydrates under the new dashboard's own storage key", async () => {
    window.sessionStorage.setItem(STORAGE_KEY_FOR("dash-1"), "conv-1");
    mockedHttpClient.get.mockResolvedValueOnce({
      data: {
        conversationId: "conv-1",
        displayTurns: [{ role: "user", text: "dash-1 message" }],
        latestPatchSet: { edits: [] },
      },
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <OverlayProvider>
          <DashboardSwitchHarness />
        </OverlayProvider>
      </MemoryRouter>,
    );

    await screen.findByText("dash-1 message");

    window.sessionStorage.setItem(STORAGE_KEY_FOR("dash-2"), "conv-2");
    mockedHttpClient.get.mockResolvedValueOnce({
      data: {
        conversationId: "conv-2",
        displayTurns: [{ role: "user", text: "dash-2 message" }],
        latestPatchSet: { edits: [] },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch dashboard" }));

    await waitFor(() => {
      expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/authoring/conversations/conv-2");
    });
    await waitFor(() => {
      expect(screen.queryByText("dash-1 message")).not.toBeInTheDocument();
      expect(screen.getByText("dash-2 message")).toBeInTheDocument();
    });
  });

  it("shows an inline error on a failed request and does not navigate", async () => {
    const apiError = Object.assign(new Error("Unprocessable Entity"), {
      isAxiosError: true,
      response: {
        status: 422,
        data: { message: "Model output was invalid twice.", kind: "InvalidProposal" },
      },
    });
    mockedHttpClient.post.mockRejectedValueOnce(apiError);

    renderDrawer(jest.fn(), "dash-1");

    fireEvent.change(screen.getByLabelText("Refinement message"), {
      target: { value: "Change it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose changes" }));

    expect(await screen.findByText("Model output was invalid twice.")).toBeInTheDocument();
    expect(
      screen.getByText("Try refining your message with more specific detail."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("review-route")).not.toBeInTheDocument();
  });

  it("closing the drawer calls onClose", () => {
    const onClose = jest.fn();
    renderDrawer(onClose, "dash-1");

    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);

    expect(onClose).toHaveBeenCalled();
  });

  // HEL-718: the header close button migrated from a hand-rolled
  // `.refinement-drawer__close` button onto the shared IconButton primitive
  // — verifies the accessible name/tooltip pairing and click behavior
  // survived the migration.
  it("the header close button has a visible title tooltip and calls onClose when clicked", () => {
    const onClose = jest.fn();
    renderDrawer(onClose, "dash-1");

    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    const headerCloseButton = closeButtons[closeButtons.length - 1];
    expect(headerCloseButton).toHaveAttribute("title", "Close");

    fireEvent.click(headerCloseButton);

    expect(onClose).toHaveBeenCalled();
  });
});
