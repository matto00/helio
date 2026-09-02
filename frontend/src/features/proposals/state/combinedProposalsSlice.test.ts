import { applyCombinedProposal, combinedProposalsReducer } from "./combinedProposalsSlice";
import * as combinedProposalService from "../services/combinedProposalService";
import { dashboardUpserted, setSelectedDashboardId } from "../../dashboards/state/dashboardsSlice";
import type { CombinedProposal, CombinedProposalApplyResponse } from "../types/combinedProposal";

jest.mock("../services/combinedProposalService", () => ({
  applyCombinedProposal: jest.fn(),
}));

const applyCombinedProposalMock = jest.mocked(combinedProposalService.applyCombinedProposal);

const sampleProposal: CombinedProposal = {
  pipeline: {
    pipelineName: "Demo pipeline",
    source: { type: "static", name: "Demo source", config: {} },
    steps: [],
    outputs: [{ kind: "table", name: "Demo output" }],
  },
  dashboard: {
    dashboardName: "Demo dashboard",
    panels: [{ title: "Total", type: "output", outputId: "$pipelineOutput" }],
  },
};

const defaultMeta = {
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};

const sampleApplyResponse: CombinedProposalApplyResponse = {
  pipeline: {
    pipeline: {
      id: "p-1",
      name: "Demo pipeline",
      sourceDataSourceId: "ds-1",
      sourceDataSourceName: "Demo source",
      lastRunStatus: "succeeded",
      lastRunAt: "2026-01-01T00:00:00Z",
      lastRunRowCount: 2,
    },
    outputs: [{ id: "dt-1", name: "Demo output", kind: "table" }],
    run: { rows: [], rowCount: 2 },
  },
  dashboard: {
    dashboard: {
      id: "dash-1",
      name: "Demo dashboard",
      meta: defaultMeta,
      appearance: { background: "transparent", gridBackground: "transparent" },
      layout: { lg: [], md: [], sm: [], xs: [] },
    },
    panels: [],
  },
};

describe("combinedProposalsSlice", () => {
  it("sets applying on pending", () => {
    const nextState = combinedProposalsReducer(
      undefined,
      applyCombinedProposal.pending("req-1", sampleProposal),
    );
    expect(nextState.applying).toBe(true);
    expect(nextState.error).toBeNull();
  });

  it("clears applying on fulfilled", () => {
    const nextState = combinedProposalsReducer(
      { applying: true, error: null },
      applyCombinedProposal.fulfilled(sampleApplyResponse, "req-1", sampleProposal),
    );
    expect(nextState.applying).toBe(false);
  });

  it("sets error on rejected", () => {
    const nextState = combinedProposalsReducer(
      { applying: true, error: null },
      applyCombinedProposal.rejected(
        new Error("boom"),
        "req-1",
        sampleProposal,
        "Failed to apply the combined proposal.",
      ),
    );
    expect(nextState.applying).toBe(false);
    expect(nextState.error).toBe("Failed to apply the combined proposal.");
  });
});

describe("applyCombinedProposal thunk", () => {
  beforeEach(() => {
    applyCombinedProposalMock.mockReset();
  });

  // HEL-739 design.md D7 (skeptic round 1 CR1 fix): a successful apply must dispatch BOTH
  // dashboardUpserted AND setSelectedDashboardId — dashboardUpserted alone never selects the new
  // dashboard, so PanelList ("/") would keep showing whatever was previously selected.
  it("dispatches BOTH dashboardUpserted AND setSelectedDashboardId on success", async () => {
    applyCombinedProposalMock.mockResolvedValueOnce(sampleApplyResponse);

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = applyCombinedProposal(sampleProposal);

    await thunk(dispatch, getState, undefined);

    expect(applyCombinedProposalMock).toHaveBeenCalledWith(sampleProposal);
    expect(dispatch).toHaveBeenCalledWith(
      dashboardUpserted(sampleApplyResponse.dashboard.dashboard),
    );
    expect(dispatch).toHaveBeenCalledWith(
      setSelectedDashboardId(sampleApplyResponse.dashboard.dashboard.id),
    );

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "combinedProposals/applyCombinedProposal/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual(sampleApplyResponse);
  });

  it("dispatches rejected — and neither dashboard action — on service error", async () => {
    applyCombinedProposalMock.mockRejectedValueOnce(new Error("server error"));

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = applyCombinedProposal(sampleProposal);

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const rejectedCall = calls.find(
      ([action]) => action.type === "combinedProposals/applyCombinedProposal/rejected",
    );
    expect(rejectedCall).toBeDefined();
    expect(rejectedCall?.[0].payload).toBe("Failed to apply the combined proposal.");
    expect(calls.some(([action]) => action.type === dashboardUpserted.type)).toBe(false);
    expect(calls.some(([action]) => action.type === setSelectedDashboardId.type)).toBe(false);
  });
});
