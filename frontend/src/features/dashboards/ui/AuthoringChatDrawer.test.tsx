import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { createSseMock } from "../../../test/sseMock";
import { httpClient } from "../../../services/httpClient";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { AuthoringChatDrawer } from "./AuthoringChatDrawer";
import type { DashboardProposal } from "../types/proposal";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

const CONVERSATION_ID_STORAGE_KEY = "helio.authoring.conversationId";

/** Renders the exact `location.state.proposal` handed off by the drawer, so
 * tests can assert the navigate() call carried the byte-identical shape
 * `ProposalReviewPage.tsx` reads (design.md D4) without mocking react-router
 * internals. A "Reject" button (skeptic-final-1.md CR1 regression test) lets
 * a test simulate returning to `/` via SPA navigation (no full page reload)
 * without touching any of the other tests' assertions -- `toHaveTextContent`
 * is a substring match, so the added button's own text is harmless to them. */
function ReviewRouteProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  const proposal = (location.state as { proposal?: DashboardProposal } | null)?.proposal;
  return (
    <div data-testid="review-route">
      <span>{proposal ? JSON.stringify(proposal) : "none"}</span>
      <button type="button" onClick={() => navigate("/")}>
        Reject
      </button>
    </div>
  );
}

/** skeptic-final-1.md CR1 regression harness: `AuthoringChatDrawer` is mounted OUTSIDE the
 * `<Routes>` switch (an "Open Author with AI" trigger toggles its `open` prop instead), so its
 * component instance survives a "Review & apply" -> reject -> return-to-"/" round trip exactly
 * like the real app (confirmed live by the skeptic: the drawer is never unmounted by that
 * navigation) -- `renderDrawer`'s own harness above can't exercise this, since routing there
 * literally unmounts the drawer along with the rest of "/"'s tree. */
function ReopenHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <AuthoringChatDrawer open={open} onClose={() => setOpen(false)} />
      <Routes>
        <Route
          path="/"
          element={
            <button type="button" onClick={() => setOpen(true)}>
              Open Author with AI
            </button>
          }
        />
        <Route path="/proposals/review" element={<ReviewRouteProbe />} />
      </Routes>
    </>
  );
}

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  window.sessionStorage.clear();
  mockedHttpClient.get.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function renderDrawer(onClose: () => void = jest.fn()) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <OverlayProvider>
        <Routes>
          <Route path="/" element={<AuthoringChatDrawer open onClose={onClose} />} />
          <Route path="/proposals/review" element={<ReviewRouteProbe />} />
        </Routes>
      </OverlayProvider>
    </MemoryRouter>,
  );
}

describe("AuthoringChatDrawer", () => {
  it("does not render when open=false", () => {
    render(
      <MemoryRouter>
        <OverlayProvider>
          <AuthoringChatDrawer open={false} onClose={jest.fn()} />
        </OverlayProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText("Author a dashboard with AI")).not.toBeInTheDocument();
  });

  it("submits a goal, shows an indeterminate progress state, then appends the completed turn to the thread and keeps the drawer open (HEL-397 D6)", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    renderDrawer();

    fireEvent.change(screen.getByLabelText("Dashboard goal"), {
      target: { value: "Show weekly revenue by region" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/authoring/dashboard?stream=true",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({
            goal: "Show weekly revenue by region",
            conversationId: undefined,
          }),
        }),
      );
    });

    // In-progress state shown before any terminal event lands -- and never
    // the raw mid-JSON progress text (design.md's Risk note).
    expect(screen.getByRole("status")).toHaveTextContent("Composing your dashboard…");

    controller.push("authoring-progress", { text: '{"dashboardName":"Sales' });
    expect(screen.queryByText(/dashboardName/)).not.toBeInTheDocument();

    controller.push("authoring-status", { label: "repairing" });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Repairing…");
    });

    const proposal: DashboardProposal = { dashboardName: "Sales overview", panels: [] };
    controller.push("authoring-result", { proposal, warnings: [], conversationId: "conv-1" });

    // Appended to the visible thread -- NOT an automatic hand-off to Review UI.
    await waitFor(() => {
      expect(screen.getByText("Show weekly revenue by region")).toBeInTheDocument();
      expect(screen.getByText('Proposed "Sales overview" (0 panel(s))')).toBeInTheDocument();
    });
    expect(screen.queryByTestId("review-route")).not.toBeInTheDocument();

    // The input re-opens for a follow-up, ready and enabled.
    const input = screen.getByLabelText("Dashboard goal") as HTMLTextAreaElement;
    expect(input.value).toBe("");
    expect(input).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & apply" })).toBeInTheDocument();

    expect(window.sessionStorage.getItem(CONVERSATION_ID_STORAGE_KEY)).toBe("conv-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    controller.close();
  });

  it('"Review & apply" is the only path that navigates -- hands off the latest proposal and closes the drawer', async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;
    const onClose = jest.fn();

    renderDrawer(onClose);

    fireEvent.change(screen.getByLabelText("Dashboard goal"), {
      target: { value: "Show weekly revenue by region" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const proposal: DashboardProposal = { dashboardName: "Sales overview", panels: [] };
    controller.push("authoring-result", { proposal, warnings: [], conversationId: "conv-1" });
    await screen.findByRole("button", { name: "Review & apply" });

    fireEvent.click(screen.getByRole("button", { name: "Review & apply" }));

    const reviewRoute = await screen.findByTestId("review-route");
    expect(reviewRoute).toHaveTextContent(JSON.stringify(proposal));
    expect(onClose).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(CONVERSATION_ID_STORAGE_KEY)).toBeNull();

    controller.close();
  });

  it('reopening the SAME mounted drawer instance after "Review & apply" starts a genuinely fresh conversation, not the stale prior thread (skeptic-final-1.md CR1)', async () => {
    const first = createSseMock();
    global.fetch = first.fetchMock;

    render(
      <MemoryRouter initialEntries={["/"]}>
        <OverlayProvider>
          <ReopenHarness />
        </OverlayProvider>
      </MemoryRouter>,
    );

    // Turn 1: goal A completes and "Review & apply" becomes available.
    fireEvent.change(screen.getByLabelText("Dashboard goal"), {
      target: { value: "Show profit as a single metric" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(first.fetchMock).toHaveBeenCalled());

    const proposalA: DashboardProposal = { dashboardName: "Profit Overview", panels: [] };
    first.controller.push("authoring-result", {
      proposal: proposalA,
      warnings: [],
      conversationId: "conv-A",
    });
    await screen.findByText('Proposed "Profit Overview" (0 panel(s))');

    // "Review & apply" -- navigates away. The drawer's component instance is NOT unmounted by
    // this (mirrors the real app, confirmed live by the skeptic), only closed (open=false).
    fireEvent.click(screen.getByRole("button", { name: "Review & apply" }));
    await screen.findByTestId("review-route");
    expect(window.sessionStorage.getItem(CONVERSATION_ID_STORAGE_KEY)).toBeNull();

    // Reject in review -- back to "/", still no full page reload/unmount.
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await screen.findByRole("button", { name: "Open Author with AI" });

    // Reopen the SAME mounted drawer instance.
    fireEvent.click(screen.getByRole("button", { name: "Open Author with AI" }));

    // Fresh state -- NOT the stale thread from the already-reviewed conversation A.
    expect(screen.queryByText('Proposed "Profit Overview" (0 panel(s))')).not.toBeInTheDocument();
    expect(screen.queryByText("Show profit as a single metric")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review & apply" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate proposal" })).toBeInTheDocument();
    expect((screen.getByLabelText("Dashboard goal") as HTMLTextAreaElement).value).toBe("");

    // A follow-up goal now correctly starts a NEW conversation (no conversationId on the wire) --
    // not a silent continuation of the already-applied conversation A.
    const second = createSseMock();
    global.fetch = second.fetchMock;
    fireEvent.change(screen.getByLabelText("Dashboard goal"), {
      target: { value: "Show a completely different dashboard about customer churn" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));

    await waitFor(() => {
      expect(second.fetchMock).toHaveBeenCalledWith(
        "/api/authoring/dashboard?stream=true",
        expect.objectContaining({
          body: JSON.stringify({
            goal: "Show a completely different dashboard about customer churn",
            conversationId: undefined,
          }),
        }),
      );
    });

    first.controller.close();
    second.controller.close();
  });

  it("a second submitted message appends to the thread rather than replacing it (HEL-397 tasks.md 6.3)", async () => {
    const first = createSseMock();
    global.fetch = first.fetchMock;

    renderDrawer();

    fireEvent.change(screen.getByLabelText("Dashboard goal"), {
      target: { value: "Show weekly revenue by region" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(first.fetchMock).toHaveBeenCalled());

    const proposal1: DashboardProposal = { dashboardName: "Sales overview", panels: [] };
    first.controller.push("authoring-result", {
      proposal: proposal1,
      warnings: [],
      conversationId: "conv-1",
    });
    await screen.findByText('Proposed "Sales overview" (0 panel(s))');

    const second = createSseMock();
    global.fetch = second.fetchMock;

    fireEvent.change(screen.getByLabelText("Dashboard goal"), {
      target: { value: "Make the second panel a bar chart" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(second.fetchMock).toHaveBeenCalledWith(
        "/api/authoring/dashboard?stream=true",
        expect.objectContaining({
          body: JSON.stringify({
            goal: "Make the second panel a bar chart",
            conversationId: "conv-1",
          }),
        }),
      );
    });

    const proposal2: DashboardProposal = { dashboardName: "Sales overview v2", panels: [] };
    second.controller.push("authoring-result", {
      proposal: proposal2,
      warnings: [],
      conversationId: "conv-1",
    });

    await waitFor(() => {
      // Both turns are visible -- the first is still there, not replaced.
      expect(screen.getByText("Show weekly revenue by region")).toBeInTheDocument();
      expect(screen.getByText('Proposed "Sales overview" (0 panel(s))')).toBeInTheDocument();
      expect(screen.getByText("Make the second panel a bar chart")).toBeInTheDocument();
      expect(screen.getByText('Proposed "Sales overview v2" (0 panel(s))')).toBeInTheDocument();
    });
    expect(screen.queryByTestId("review-route")).not.toBeInTheDocument();

    first.controller.close();
    second.controller.close();
  });

  it("a reload with a stored conversationId rehydrates the thread from the GET response (HEL-397 design.md D7)", async () => {
    window.sessionStorage.setItem(CONVERSATION_ID_STORAGE_KEY, "conv-42");
    mockedHttpClient.get.mockResolvedValueOnce({
      data: {
        conversationId: "conv-42",
        displayTurns: [
          { role: "user", text: "Show total revenue" },
          { role: "assistant", text: 'Proposed "Sales" (1 panel(s))' },
        ],
        latestProposal: { dashboardName: "Sales", panels: [] },
      },
    });

    renderDrawer();

    await waitFor(() => {
      expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/authoring/conversations/conv-42");
    });
    await waitFor(() => {
      expect(screen.getByText("Show total revenue")).toBeInTheDocument();
      expect(screen.getByText('Proposed "Sales" (1 panel(s))')).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Review & apply" })).toBeInTheDocument();
    // The stored id survives a mere rehydration -- only "Review & apply" clears it.
    expect(window.sessionStorage.getItem(CONVERSATION_ID_STORAGE_KEY)).toBe("conv-42");
  });

  it("a stale/404 conversation id clears and starts fresh rather than erroring (HEL-397 design.md D7)", async () => {
    window.sessionStorage.setItem(CONVERSATION_ID_STORAGE_KEY, "conv-stale");
    const notFound = Object.assign(new Error("Not Found"), {
      isAxiosError: true,
      response: { status: 404 },
    });
    mockedHttpClient.get.mockRejectedValueOnce(notFound);

    renderDrawer();

    await waitFor(() => {
      expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/authoring/conversations/conv-stale");
    });
    await waitFor(() => {
      expect(window.sessionStorage.getItem(CONVERSATION_ID_STORAGE_KEY)).toBeNull();
    });

    // Starts fresh: no thread rendered, no inline error surfaced for this recoverable case.
    expect(screen.queryByRole("list", { name: "Conversation" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate proposal" })).toBeInTheDocument();
  });

  it("shows an inline error on a terminal authoring-error event and does not navigate", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    renderDrawer();

    fireEvent.change(screen.getByLabelText("Dashboard goal"), {
      target: { value: "Show weekly revenue by region" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("authoring-error", { message: "The authoring service is unavailable." });

    expect(await screen.findByText("The authoring service is unavailable.")).toBeInTheDocument();
    expect(screen.queryByTestId("review-route")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    controller.close();
  });

  it("shows a connection-error state and does not navigate when the stream response is not SSE", async () => {
    const { fetchMock } = createSseMock({ ok: false, contentType: "application/json" });
    global.fetch = fetchMock;

    renderDrawer();

    fireEvent.change(screen.getByLabelText("Dashboard goal"), {
      target: { value: "Show weekly revenue by region" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));

    expect(await screen.findByText(/Unexpected response/)).toBeInTheDocument();
    expect(screen.queryByTestId("review-route")).not.toBeInTheDocument();
  });

  it("lets the user retry after an error", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    renderDrawer();

    fireEvent.change(screen.getByLabelText("Dashboard goal"), {
      target: { value: "Show weekly revenue by region" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("authoring-error", { message: "boom" });
    await screen.findByText("boom");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByRole("button", { name: "Generate proposal" })).toBeInTheDocument();
    expect(screen.getByLabelText("Dashboard goal")).not.toBeDisabled();
  });

  it("cancelling a streaming request aborts the fetch", async () => {
    const { fetchMock } = createSseMock();
    global.fetch = fetchMock;

    renderDrawer();

    fireEvent.change(screen.getByLabelText("Dashboard goal"), {
      target: { value: "Show weekly revenue by region" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const signal = (fetchMock.mock.calls[0] as [string, { signal: AbortSignal }])[1].signal;
    expect(signal.aborted).toBe(true);
  });

  it("closing the drawer calls onClose", () => {
    const onClose = jest.fn();
    renderDrawer(onClose);

    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);

    expect(onClose).toHaveBeenCalled();
  });
});
