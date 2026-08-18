import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { pipelinesReducer } from "../state/pipelinesSlice";
import { applyPipelineProposal } from "../services/pipelineProposalService";
import { PipelineProposalReviewPage } from "./PipelineProposalReviewPage";
import type { PipelineProposal, PipelineProposalApplyResponse } from "../types/pipelineProposal";

jest.mock("../services/pipelineProposalService", () => ({
  applyPipelineProposal: jest.fn(),
}));

const mockedApplyPipelineProposal = jest.mocked(applyPipelineProposal);

beforeAll(() => {
  // jsdom does not implement <dialog> showModal/close natively (PipelineProposalReview.tsx renders
  // a native <dialog>) — mirrors ProposalReviewPage.test.tsx's own stub.
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

const proposal: PipelineProposal = {
  pipelineName: "Sales pipeline",
  source: { sourceId: "src-1" },
  outputDataTypeName: "SalesMetrics",
  steps: [],
};

const appliedResponse: PipelineProposalApplyResponse = {
  pipeline: {
    id: "p-new",
    name: "Sales pipeline",
    sourceDataSourceId: "src-1",
    sourceDataSourceName: "Sales API",
    outputDataTypeName: "SalesMetrics",
    outputDataTypeId: "dt-1",
    lastRunStatus: "succeeded",
    lastRunAt: "2026-01-01T00:00:00Z",
    lastRunRowCount: 0,
  },
  outputDataTypeId: "dt-1",
  run: { rows: [], rowCount: 0 },
};

function makeStore() {
  return configureStore({ reducer: { pipelines: pipelinesReducer } });
}

/** Renders a route probe alongside the page so a test can assert navigation happened without
 *  mocking react-router internals — mirrors ProposalReviewPage.test.tsx's own HomeProbe. */
function RouteProbe() {
  const location = useLocation();
  return <div data-testid="route-probe">{location.pathname}</div>;
}

function renderPage(routeState?: { proposal: PipelineProposal }) {
  return render(
    <Provider store={makeStore()}>
      <MemoryRouter
        initialEntries={[{ pathname: "/pipeline-proposals/review", state: routeState ?? null }]}
      >
        <Routes>
          <Route path="/pipeline-proposals/review" element={<PipelineProposalReviewPage />} />
          <Route path="/pipelines/:id" element={<RouteProbe />} />
          <Route path="/" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PipelineProposalReviewPage", () => {
  // F-002: `config/env`'s `IS_DEV` is mocked `false` under Jest — this exercises the same
  // "no location.state" entry a production user would actually hit. This must never reach a
  // live, applyable proposal (or an Accept dispatch) synthesized with no explicit hand-off.
  it("shows a 'nothing to review' empty state when no router state is supplied", async () => {
    renderPage();

    await screen.findByText("Nothing to review");
    expect(mockedApplyPipelineProposal).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back to dashboards/i }));
    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toHaveTextContent("/");
    });
  });

  it("renders location.state.proposal's source/steps/output", async () => {
    renderPage({ proposal });

    await screen.findByText("Sales pipeline");
    expect(screen.getByText("SalesMetrics")).toBeInTheDocument();
  });

  it("Accept dispatches applyPipelineProposal and navigates to the created pipeline's detail page", async () => {
    mockedApplyPipelineProposal.mockResolvedValueOnce(appliedResponse);

    renderPage({ proposal });

    await screen.findByRole("button", { name: /accept & create/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & create/i }));

    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toHaveTextContent("/pipelines/p-new");
    });
    expect(mockedApplyPipelineProposal).toHaveBeenCalledWith(proposal);
  });

  it("a failed apply displays the error inline and does not navigate away", async () => {
    mockedApplyPipelineProposal.mockRejectedValueOnce(new Error("boom"));

    renderPage({ proposal });

    await screen.findByRole("button", { name: /accept & create/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & create/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to apply the pipeline proposal.")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("route-probe")).not.toBeInTheDocument();
  });

  it("Reject navigates away without applying", async () => {
    renderPage({ proposal });

    await screen.findByRole("button", { name: /reject/i });
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));

    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toHaveTextContent("/");
    });
    expect(mockedApplyPipelineProposal).not.toHaveBeenCalled();
  });
});
