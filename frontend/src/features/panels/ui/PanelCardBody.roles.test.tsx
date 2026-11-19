// HEL-1773 D5/D6, reworked by HEL-1780 D1/D3: a panel card body reads through the route its OWN dashboard's role allows. On a
// dashboard the caller does not own it shows the viewer control bar (distinct values through the per-panel route), reads its
// rows through the per-panel route and makes no Output-route request; the run-event refresh (HEL-1786) stays off. The owner's
// body is unchanged.
import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { makeOutputPanel } from "../../../test/panelFixtures";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { ownedDashboard } from "../../../test/seedOwnedDashboard";
import {
  fetchPublicDistinctValues,
  fetchPublicOutputMeta,
  fetchPublicPanelRows,
} from "../../dashboards/services/publicDashboardService";
import type { DashboardAccessRole } from "../../dashboards/types/dashboard";
import { authReducer } from "../../auth/state/authSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import * as outputService from "../../pipelines/services/outputService";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import { getOutputId } from "../state/panelNarrowing";
import { panelsReducer } from "../state/panelsSlice";
import type { Panel } from "../types/panel";
import { PanelCardBody } from "./PanelCardBody";

jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(),
  getFilterCapabilities: jest.fn(),
  getDistinctValues: jest.fn(),
  getOutputMeta: jest.fn(),
}));
jest.mock("../../dashboards/services/publicDashboardService");
jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));

const CONTROL = { id: "c1", kind: "dropdown" as const, column: "region", label: "Region" };
const panel = makeOutputPanel({
  id: "panel-1",
  dashboardId: "dash-1",
  config: { outputId: "output-1", controls: [CONTROL] },
});

function Harness({ p }: { p: Panel }) {
  const panelData = usePanelData(p);
  return (
    <PanelCardBody
      panel={p}
      frozen={false}
      outputId={getOutputId(p)}
      data={panelData.data}
      rawRows={panelData.rawRows}
      headers={panelData.headers}
      isLoading={panelData.isLoading}
      error={panelData.error}
      errorKind={panelData.errorKind}
      noData={panelData.noData}
      neverMaterialized={panelData.neverMaterialized}
      rowsTruncated={panelData.rowsTruncated}
      refresh={panelData.refresh}
    />
  );
}

function renderBody(role: DashboardAccessRole) {
  const seed = panelsReducer(undefined, { type: "@@INIT" } as UnknownAction);
  const store = configureStore({
    reducer: {
      panels: panelsReducer,
      toasts: toastsReducer,
      auth: authReducer,
      dashboards: dashboardsReducer,
    } as never,
    preloadedState: {
      dashboards: {
        ...dashboardsReducer(undefined, { type: "@@INIT" } as UnknownAction),
        items: [{ ...ownedDashboard("dash-1"), accessRole: role }],
      },
      panels: { ...seed, items: [panel] },
      toasts: { items: [] },
      auth: authReducer(undefined, { type: "@@INIT" } as UnknownAction),
    } as never,
  });
  render(
    <MemoryRouter>
      <Provider store={store}>
        <Harness p={panel} />
      </Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  const output = {
    id: "output-1",
    pipelineId: "pipeline-1",
    ownerId: "u1",
    name: "Sales",
    kind: "table",
    config: {},
    schema: [{ name: "region", type: "string" }],
    createdAt: "",
    updatedAt: "",
  };
  jest.mocked(outputService.getOutputById).mockResolvedValue(output);
  jest.mocked(outputService.getOutputRows).mockResolvedValue({
    items: [{ region: "East" }],
    total: 1,
    offset: 0,
    limit: 200,
    materialized: true,
  });
  jest.mocked(outputService.getDistinctValues).mockResolvedValue({ values: [] } as never);
  jest.mocked(fetchPublicPanelRows).mockResolvedValue({
    items: [{ region: "East" }],
    total: 1,
    offset: 0,
    limit: 200,
  });
  jest.mocked(fetchPublicOutputMeta).mockResolvedValue({
    kind: "table",
    config: {},
    schema: [{ name: "region", type: "string" }],
    ownerId: null,
  });
  jest.mocked(fetchPublicDistinctValues).mockResolvedValue({ column: "region", values: [] });
});

describe("PanelCardBody by role", () => {
  it("an owner has the viewer control bar and the run-event refresh, through the Output routes", async () => {
    renderBody("owner");
    await waitFor(() => expect(screen.getByText("East")).toBeInTheDocument());
    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(usePanelRunRefresh).toHaveBeenLastCalledWith("output-1", expect.any(Function));
    expect(fetchPublicPanelRows).not.toHaveBeenCalled();
  });

  it.each(["viewer", "editor"] as const)(
    "a %s has the control bar through the per-panel routes, no run-event refresh and no Output-route read",
    async (role) => {
      renderBody(role);
      await waitFor(() => expect(screen.getByText("East")).toBeInTheDocument());
      expect(screen.getByText("Region")).toBeInTheDocument();
      expect(usePanelRunRefresh).toHaveBeenLastCalledWith(null, expect.any(Function));
      expect(fetchPublicPanelRows).toHaveBeenCalled();
      expect(outputService.getOutputRows).not.toHaveBeenCalled();
      expect(outputService.getDistinctValues).not.toHaveBeenCalled();
      expect(outputService.getFilterCapabilities).not.toHaveBeenCalled();
      expect(outputService.getAssertionStatus).not.toHaveBeenCalled();
    },
  );
});
