// HEL-1358 — the public viewer's chart panel says it is truncated, from the counts the public rows
// endpoint already returns (`total`, 200-row page). Real path: fetchPublicPanelRows ->
// usePublicPanelData -> PanelContent -> ChartOutputPanel -> ChartRenderer.

import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";

import { ThemeProvider } from "../../../theme/ThemeProvider";

import { PublicDashboardViewerPage } from "./PublicDashboardViewerPage";
import { authReducer } from "../../auth/state/authSlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import * as publicDashboardService from "../services/publicDashboardService";
import * as historyService from "../../panels/history/outputHistoryService";
import { resetHistoryCache } from "../../panels/history/outputHistoryCache";
import type { OutputPanel } from "../../panels/types/panel";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: () => <div data-testid="echarts" />,
}));
jest.mock("../../panels/ui/echartsCore", () => ({ __esModule: true, default: {} }));
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

const chartPanel: OutputPanel = {
  id: "panel-1",
  dashboardId: "dash-1",
  title: "Revenue",
  meta: { lastUpdated: "2026-01-01T00:00:00Z" } as never,
  appearance: { background: "transparent", color: "inherit", transparency: 0 } as never,
  type: "output",
  config: { outputId: "out-1", controls: [] },
};

function renderAt(path: string) {
  const store = configureStore({ reducer: { auth: authReducer, panels: panelsReducer } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Provider store={store}>
        <ThemeProvider>
          <Routes>
            <Route path="/dashboards/:dashboardId/panels" element={<PublicDashboardViewerPage />} />
          </Routes>
        </ThemeProvider>
      </Provider>
    </MemoryRouter>,
  );
}

const PAGE = [
  { day: "Mon", amount: 5 },
  { day: "Tue", amount: 6 },
];

beforeEach(() => {
  jest.clearAllMocks();
  resetHistoryCache();
  fetchPanels.mockResolvedValue([chartPanel]);
  fetchMeta.mockResolvedValue({
    kind: "chart",
    config: { chartType: "line", fieldMapping: { xAxis: "day", yAxis: "amount" } },
    schema: [],
    ownerId: null,
  });
});

describe("PublicDashboardViewerPage chart truncation note (HEL-1358)", () => {
  it("names both counts when the public page holds fewer rows than the total", async () => {
    fetchRows.mockResolvedValue({ items: PAGE, total: 1234, offset: 0, limit: 200 });
    renderAt("/dashboards/dash-1/panels?token=t");
    expect(await screen.findByText(/Based on the first 2 of 1,234 rows\./)).toBeInTheDocument();
  });

  it("shows no note when the page holds every row", async () => {
    fetchRows.mockResolvedValue({ items: PAGE, total: 2, offset: 0, limit: 200 });
    renderAt("/dashboards/dash-1/panels?token=t");
    await screen.findByTestId("echarts");
    expect(screen.queryByText(/Based on the first/)).toBeNull();
  });
});
