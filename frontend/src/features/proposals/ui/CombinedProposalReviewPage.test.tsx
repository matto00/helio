import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { connectorsReducer } from "../../connectors/state/connectorsSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { combinedProposalsReducer } from "../state/combinedProposalsSlice";
import { applyCombinedProposal } from "../services/combinedProposalService";
import { CombinedProposalReviewPage } from "./CombinedProposalReviewPage";
import type { CombinedProposal, CombinedProposalApplyResponse } from "../types/combinedProposal";

jest.mock("../services/combinedProposalService", () => ({
  applyCombinedProposal: jest.fn(),
}));

// HEL-829: the page now fetches the connector list to detect unresolved
// connector references — mocked the same way ConnectorsPage.test.tsx mocks
// it, so this suite never issues a real network call.
jest.mock("../../connectors/services/connectorEntityService", () => ({
  fetchConnectors: jest.fn().mockResolvedValue([]),
}));

const mockedApplyCombinedProposal = jest.mocked(applyCombinedProposal);

beforeAll(() => {
  // jsdom does not implement <dialog> showModal/close natively (CombinedProposalReview.tsx renders
  // a native <dialog>) — mirrors ProposalReviewPage.test.tsx's own stub.
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

const proposal: CombinedProposal = {
  pipeline: {
    pipelineName: "Sales pipeline",
    source: { type: "static", name: "Demo source", config: {} },
    steps: [],
    outputs: [{ kind: "table", name: "SalesMetrics" }],
  },
  dashboard: {
    dashboardName: "Sales overview",
    panels: [{ title: "Total", type: "output", dataTypeId: "$pipelineOutput" }],
  },
};

const defaultMeta = {
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};

const appliedResponse: CombinedProposalApplyResponse = {
  pipeline: {
    pipeline: {
      id: "p-new",
      name: "Sales pipeline",
      sourceDataSourceId: "src-1",
      sourceDataSourceName: "Demo source",
      outputDataTypeName: "SalesMetrics",
      outputDataTypeId: "dt-1",
      lastRunStatus: "succeeded",
      lastRunAt: "2026-01-01T00:00:00Z",
      lastRunRowCount: 0,
    },
    outputs: [{ id: "dt-1", name: "SalesMetrics", kind: "table" }],
    run: { rows: [], rowCount: 0 },
  },
  dashboard: {
    dashboard: {
      id: "dash-1",
      name: "Sales overview",
      meta: defaultMeta,
      appearance: { background: "transparent", gridBackground: "transparent" },
      layout: { lg: [], md: [], sm: [], xs: [] },
    },
    panels: [],
  },
};

function makeStore() {
  return configureStore({
    reducer: {
      combinedProposals: combinedProposalsReducer,
      dashboards: dashboardsReducer,
      connectors: connectorsReducer,
    },
  });
}

/** Renders a route probe alongside the page so a test can assert navigation happened without
 *  mocking react-router internals — mirrors ProposalReviewPage.test.tsx's own HomeProbe. */
function RouteProbe() {
  const location = useLocation();
  return <div data-testid="route-probe">{location.pathname}</div>;
}

function renderPage(routeState?: { proposal: CombinedProposal }) {
  const store = makeStore();
  const result = render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[{ pathname: "/combined-proposals/review", state: routeState ?? null }]}
      >
        <Routes>
          <Route path="/combined-proposals/review" element={<CombinedProposalReviewPage />} />
          <Route path="/" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { ...result, store };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("CombinedProposalReviewPage", () => {
  // F-002: `config/env`'s `IS_DEV` is mocked `false` under Jest — this exercises the same
  // "no location.state" entry a production user would actually hit.
  it("shows a 'nothing to review' empty state when no router state is supplied", async () => {
    renderPage();

    await screen.findByText("Nothing to review");
    expect(mockedApplyCombinedProposal).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back to dashboards/i }));
    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toBeInTheDocument();
    });
  });

  it("renders location.state.proposal's nested pipeline + dashboard proposals", async () => {
    renderPage({ proposal });

    await screen.findByText(/Pipeline — Sales pipeline/);
    expect(screen.getByText(/Dashboard — Sales overview/)).toBeInTheDocument();
  });

  it("Accept dispatches applyCombinedProposal and navigates to / with the new dashboard selected", async () => {
    mockedApplyCombinedProposal.mockResolvedValueOnce(appliedResponse);

    const { store } = renderPage({ proposal });

    await screen.findByRole("button", { name: /accept & create/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & create/i }));

    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toBeInTheDocument();
    });
    expect(mockedApplyCombinedProposal).toHaveBeenCalledWith(proposal);
    expect(store.getState().dashboards.selectedDashboardId).toBe("dash-1");
  });

  it("a failed apply displays the error inline and does not navigate away", async () => {
    mockedApplyCombinedProposal.mockRejectedValueOnce(new Error("boom"));

    renderPage({ proposal });

    await screen.findByRole("button", { name: /accept & create/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & create/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to apply the combined proposal.")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("route-probe")).not.toBeInTheDocument();
  });

  it("Reject navigates away without applying", async () => {
    renderPage({ proposal });

    await screen.findByRole("button", { name: /reject/i });
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));

    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toBeInTheDocument();
    });
    expect(mockedApplyCombinedProposal).not.toHaveBeenCalled();
  });
});
