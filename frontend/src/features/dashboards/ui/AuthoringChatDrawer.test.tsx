import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { createSseMock } from "../../../test/sseMock";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { AuthoringChatDrawer } from "./AuthoringChatDrawer";
import type { DashboardProposal } from "../types/proposal";

/** Renders the exact `location.state.proposal` handed off by the drawer, so
 * tests can assert the navigate() call carried the byte-identical shape
 * `ProposalReviewPage.tsx` reads (design.md D4) without mocking react-router
 * internals. */
function ReviewRouteProbe() {
  const location = useLocation();
  const proposal = (location.state as { proposal?: DashboardProposal } | null)?.proposal;
  return <div data-testid="review-route">{proposal ? JSON.stringify(proposal) : "none"}</div>;
}

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
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

  it("submits a goal, shows an indeterminate progress state, then hands the terminal proposal to the review route", async () => {
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
          body: JSON.stringify({ goal: "Show weekly revenue by region" }),
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
    controller.push("authoring-result", { proposal, warnings: [] });

    const reviewRoute = await screen.findByTestId("review-route");
    expect(reviewRoute).toHaveTextContent(JSON.stringify(proposal));

    // Exactly one network call for the whole flow -- no second apply call.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    controller.close();
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
