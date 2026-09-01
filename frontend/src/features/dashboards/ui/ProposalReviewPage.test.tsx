import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { dashboardsReducer } from "../state/dashboardsSlice";
import { fetchOutputs } from "../services/outputsService";
import { applyDashboardProposal } from "../services/proposalService";
import { postAuthoringOutcome } from "../services/authoringService";
import { ProposalReviewPage } from "./ProposalReviewPage";
import type { DashboardProposal, AppliedProposal } from "../types/proposal";

jest.mock("../services/outputsService", () => ({
  fetchOutputs: jest.fn(),
}));
jest.mock("../services/proposalService", () => ({
  applyDashboardProposal: jest.fn(),
}));
jest.mock("../services/authoringService", () => ({
  postAuthoringOutcome: jest.fn(),
}));

const mockedFetchOutputs = jest.mocked(fetchOutputs);
const mockedApplyDashboardProposal = jest.mocked(applyDashboardProposal);
const mockedPostAuthoringOutcome = jest.mocked(postAuthoringOutcome);

beforeAll(() => {
  // jsdom does not implement <dialog> showModal/close natively (ProposalReview.tsx renders a
  // native <dialog>) — mirrors ProposalReview.test.tsx's own stub.
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

const proposal: DashboardProposal = {
  dashboardName: "Sales overview",
  panels: [{ title: "Notes", type: "text", content: "hello" }],
};

const appliedProposal: AppliedProposal = {
  dashboard: {
    id: "dash-1",
    name: "Sales overview",
    meta: {
      createdBy: "u1",
      createdAt: "2026-01-01T00:00:00Z",
      lastUpdated: "2026-01-01T00:00:00Z",
    },
    appearance: { background: "transparent", gridBackground: "transparent" },
    layout: { lg: [], md: [], sm: [], xs: [] },
  },
  panels: [],
};

function makeStore() {
  return configureStore({ reducer: { dashboards: dashboardsReducer } });
}

/** Renders a route probe alongside the page so a test can assert navigation happened without
 *  mocking react-router internals — mirrors AuthoringChatDrawer.test.tsx's own ReviewRouteProbe. */
function HomeProbe() {
  const location = useLocation();
  return <div data-testid="home-route">{location.pathname}</div>;
}

function renderPage(routeState?: { proposal: DashboardProposal; authoringRequestId?: string }) {
  return render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={[{ pathname: "/proposals/review", state: routeState ?? null }]}>
        <Routes>
          <Route path="/proposals/review" element={<ProposalReviewPage />} />
          <Route path="/" element={<HomeProbe />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  // `resetAllMocks` would also strip the `beforeAll` dialog stub's implementation (it resets
  // EVERY `jest.fn()`, not just this file's own service mocks) — `clearAllMocks` only clears
  // call history, and every mock this file cares about is explicitly re-armed below anyway.
  jest.clearAllMocks();
  mockedFetchOutputs.mockResolvedValue([]);
  mockedPostAuthoringOutcome.mockResolvedValue(undefined);
});

describe("ProposalReviewPage — route guard (F-002)", () => {
  // The demo-fixture synthesis path (`synthesizeDemoProposal`) is DEV-build-
  // only now — `config/env`'s `IS_DEV` is mocked `false` under Jest
  // (`src/test/envMock.ts`), so this exercises the same "no location.state"
  // entry a production user would actually hit. Regression: this must never
  // reach a live, applyable proposal (or an Accept/Apply dispatch) built from
  // the workspace's own real data with no explicit hand-off.
  it("shows a 'nothing to review' empty state — never synthesizes a demo proposal — when no router state is supplied", async () => {
    renderPage();

    await screen.findByText("Nothing to review");
    expect(mockedFetchOutputs).not.toHaveBeenCalled();
    expect(mockedApplyDashboardProposal).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back to dashboards/i }));
    await waitFor(() => {
      expect(screen.getByTestId("home-route")).toBeInTheDocument();
    });
  });
});

describe("ProposalReviewPage — authoring outcome correlation (HEL-401 design.md D4)", () => {
  it("Accept calls postAuthoringOutcome('accepted') AFTER apply succeeds, when authoringRequestId is present", async () => {
    mockedApplyDashboardProposal.mockResolvedValueOnce(appliedProposal);

    renderPage({ proposal, authoringRequestId: "req-1" });

    await screen.findByDisplayValue("Sales overview");
    fireEvent.click(screen.getByRole("button", { name: "Accept & create" }));

    await waitFor(() => {
      expect(screen.getByTestId("home-route")).toBeInTheDocument();
    });

    expect(mockedApplyDashboardProposal).toHaveBeenCalledTimes(1);
    expect(mockedPostAuthoringOutcome).toHaveBeenCalledWith("req-1", "accepted");
  });

  it("Reject calls postAuthoringOutcome('rejected') when authoringRequestId is present", async () => {
    renderPage({ proposal, authoringRequestId: "req-2" });

    await screen.findByDisplayValue("Sales overview");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(screen.getByTestId("home-route")).toBeInTheDocument();
    });

    expect(mockedPostAuthoringOutcome).toHaveBeenCalledWith("req-2", "rejected");
    expect(mockedApplyDashboardProposal).not.toHaveBeenCalled();
  });

  it("Accept never calls postAuthoringOutcome when authoringRequestId is absent (pre-existing MCP/demo path)", async () => {
    mockedApplyDashboardProposal.mockResolvedValueOnce(appliedProposal);

    renderPage({ proposal });

    await screen.findByDisplayValue("Sales overview");
    fireEvent.click(screen.getByRole("button", { name: "Accept & create" }));

    await waitFor(() => {
      expect(screen.getByTestId("home-route")).toBeInTheDocument();
    });

    expect(mockedPostAuthoringOutcome).not.toHaveBeenCalled();
  });

  it("Reject never calls postAuthoringOutcome when authoringRequestId is absent", async () => {
    renderPage({ proposal });

    await screen.findByDisplayValue("Sales overview");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(screen.getByTestId("home-route")).toBeInTheDocument();
    });

    expect(mockedPostAuthoringOutcome).not.toHaveBeenCalled();
  });

  it("a failed apply does not call postAuthoringOutcome and does not navigate away", async () => {
    mockedApplyDashboardProposal.mockRejectedValueOnce(new Error("boom"));

    renderPage({ proposal, authoringRequestId: "req-3" });

    await screen.findByDisplayValue("Sales overview");
    fireEvent.click(screen.getByRole("button", { name: "Accept & create" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to apply the proposal.")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("home-route")).not.toBeInTheDocument();
    expect(mockedPostAuthoringOutcome).not.toHaveBeenCalled();
  });
});
