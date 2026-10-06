// HEL-1326 — the public viewer's metric panel under a viewer-control filter shows the metric over
// the FULL filtered set returned with the public rows response (`metric`), not an aggregate of the
// loaded rows. Real path: fetchPublicPanelRows -> usePublicPanelData -> PanelContent -> MetricOutputPanel.

import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";

import { PublicDashboardViewerPage } from "./PublicDashboardViewerPage";
import { authReducer } from "../../auth/state/authSlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import * as publicDashboardService from "../services/publicDashboardService";
import * as historyService from "../../panels/history/outputHistoryService";
import { resetHistoryCache } from "../../panels/history/outputHistoryCache";
import type { OutputPanel } from "../../panels/types/panel";

jest.mock("../services/publicDashboardService", () => ({
  fetchPublicDashboardPanels: jest.fn(),
  fetchPublicPanelRows: jest.fn(),
  fetchPublicOutputMeta: jest.fn(),
  fetchPublicDistinctValues: jest.fn(),
}));
jest.mock("../../panels/history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchPublicOutputHistory: jest.fn(),
}));
jest.mock("../../panels/services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

const fetchPanels = jest.mocked(publicDashboardService.fetchPublicDashboardPanels);
const fetchRows = jest.mocked(publicDashboardService.fetchPublicPanelRows);
const fetchMeta = jest.mocked(publicDashboardService.fetchPublicOutputMeta);
const fetchDistinct = jest.mocked(publicDashboardService.fetchPublicDistinctValues);
const fetchPublicHistory = jest.mocked(historyService.fetchPublicOutputHistory);

const metricPanel: OutputPanel = {
  id: "panel-1",
  dashboardId: "dash-1",
  title: "Revenue",
  meta: { lastUpdated: "2026-01-01T00:00:00Z" } as never,
  appearance: { background: "transparent", color: "inherit", transparency: 0 } as never,
  type: "output",
  config: {
    outputId: "out-1",
    controls: [{ id: "c1", kind: "dropdown", column: "region", label: "Region" }],
  },
};

function renderAt(path: string) {
  const store = configureStore({ reducer: { auth: authReducer, panels: panelsReducer } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Provider store={store}>
        <Routes>
          <Route path="/dashboards/:dashboardId/panels" element={<PublicDashboardViewerPage />} />
        </Routes>
      </Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetHistoryCache();
  fetchPanels.mockResolvedValue([metricPanel]);
  fetchMeta.mockResolvedValue({
    kind: "metric",
    config: { fieldMapping: {}, aggregation: { value: "amount", agg: "sum" }, format: "integer" },
    schema: [{ name: "amount", type: "integer" }],
    ownerId: null,
  });
  fetchDistinct.mockResolvedValue({ column: "region", values: [] });
  fetchPublicHistory.mockResolvedValue({
    compare: null,
    current: null,
    baseline: null,
    delta: null,
    pct: null,
    availableFrom: null,
    sparkline: [],
    points: [],
  });
});

const PAGE = [
  { amount: 700, region: "east" },
  { amount: 1000, region: "east" },
];

describe("PublicDashboardViewerPage metric headline under a viewer filter (HEL-1326)", () => {
  it("shows the full-filtered-set metric from the public rows response, not the loaded rows' sum (RED on main: shows 1,700)", async () => {
    fetchRows.mockResolvedValue({
      items: PAGE,
      total: 500,
      offset: 0,
      limit: 200,
      metric: { field: "amount", agg: "sum", value: 4200 },
    });
    renderAt("/dashboards/dash-1/panels?token=t&p.panel-1.c1=east");
    expect(await screen.findByText("4,200")).toBeInTheDocument();
    expect(screen.queryByText("1,700")).toBeNull();
  });

  it("GUARD: an unfiltered response has no `metric`, so the loaded-rows value stands", async () => {
    fetchRows.mockResolvedValue({ items: PAGE, total: 2, offset: 0, limit: 200 });
    renderAt("/dashboards/dash-1/panels?token=t");
    expect(await screen.findByText("1,700")).toBeInTheDocument();
  });
});
