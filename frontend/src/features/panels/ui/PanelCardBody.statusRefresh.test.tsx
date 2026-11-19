// HEL-1786 D3/D4: a grantee's card re-reads its rows through the per-panel route when the dashboard panel-status route
// reports newer committed data for that panel (the run-finish refresh), never through an Output or pipeline route.
// (copied scaffolding from PanelCardBody.roles.test.tsx)
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
import { getOutputId } from "../state/panelNarrowing";
import { panelsReducer } from "../state/panelsSlice";
import type { Panel } from "../types/panel";
import { PanelCardBody } from "./PanelCardBody";
import { fetchDashboardPanelStatus } from "../services/panelStatusService";
import { refreshPanelStatusNow, resetPanelStatusStoreForTests } from "../state/panelStatusStore";
import { act } from "@testing-library/react";

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
jest.mock("../services/panelStatusService");

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

const statusMock = jest.mocked(fetchDashboardPanelStatus);
const status = (dataUpdatedAt: string, lastRunAt = "2026-11-10T10:00:00Z") => ({
  items: [
    {
      panelId: "panel-1",
      lastRunAt,
      runStatus: "succeeded" as const,
      dataUpdatedAt,
      invalid: false,
    },
  ],
  sources: ["Sales"],
});

describe("PanelCardBody run-finish refresh in panel scope", () => {
  it.each(["viewer", "editor"] as const)(
    "a %s's panel re-reads its rows when the status route reports newer data, and not before",
    async (role) => {
      resetPanelStatusStoreForTests();
      statusMock.mockResolvedValue(status("2026-11-10T10:00:01Z"));
      renderBody(role);
      await waitFor(() => expect(screen.getByText("East")).toBeInTheDocument());
      await act(async () => {
        await Promise.resolve();
      });
      const baseline = jest.mocked(fetchPublicPanelRows).mock.calls.length;
      // (this harness never scopes the Output to its panel, so the initial meta read may use the Output route; the run-finish
      // refresh itself must add no Output-route call)
      const outputByIdCalls = jest.mocked(outputService.getOutputById).mock.calls.length;

      // The run row advanced but no data was committed yet: no refresh.
      statusMock.mockResolvedValue(status("2026-11-10T10:00:01Z", "2026-11-10T10:05:00Z"));
      await act(async () => {
        refreshPanelStatusNow("dash-1");
        await Promise.resolve();
      });
      expect(fetchPublicPanelRows).toHaveBeenCalledTimes(baseline);

      statusMock.mockResolvedValue(status("2026-11-10T10:05:01Z", "2026-11-10T10:05:00Z"));
      await act(async () => {
        refreshPanelStatusNow("dash-1");
        await Promise.resolve();
      });
      await waitFor(() => expect(fetchPublicPanelRows).toHaveBeenCalledTimes(baseline + 1));
      expect(outputService.getOutputRows).not.toHaveBeenCalled();
      expect(outputService.getOutputById).toHaveBeenCalledTimes(outputByIdCalls);
    },
  );

  it("the owner's panel never reads the status route", async () => {
    resetPanelStatusStoreForTests();
    renderBody("owner");
    await waitFor(() => expect(screen.getByText("East")).toBeInTheDocument());
    expect(statusMock).not.toHaveBeenCalled();
  });
});
