// HEL-1327 — page-level guard for the public dashboard's metric history source.
//
// `PublicDashboardViewerPage` builds `historySource = {variant: "public", dashboardId, token}` and
// passes it to `PanelContent`, which selects the public, summary-only history route
// (`fetchPublicOutputHistory`) over the authenticated one (`fetchOutputHistory`). Only
// `PanelContent.metricHistory.test.tsx` covered that route, and it injects the prop directly, so a
// page that dropped the prop would still pass every test. These tests render the REAL page.

import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";

import { PublicDashboardViewerPage } from "./PublicDashboardViewerPage";
import { authReducer } from "../../auth/state/authSlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import * as publicDashboardService from "../services/publicDashboardService";
import * as historyService from "../../panels/history/outputHistoryService";
import { resetHistoryCache } from "../../panels/history/outputHistoryCache";
import { resetComparisonStore } from "../../panels/history/metricComparisonStore";
import {
  HEAD_AT,
  BASE_AT,
  METRIC_CONFIG,
  makeHistory,
  metricPoint,
} from "../../panels/history/historyFixtures";
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

const fetchPublicDashboardPanelsMock = jest.mocked(
  publicDashboardService.fetchPublicDashboardPanels,
);
const fetchPublicPanelRowsMock = jest.mocked(publicDashboardService.fetchPublicPanelRows);
const fetchPublicOutputMetaMock = jest.mocked(publicDashboardService.fetchPublicOutputMeta);
const fetchOutputHistoryMock = jest.mocked(historyService.fetchOutputHistory);
const fetchPublicOutputHistoryMock = jest.mocked(historyService.fetchPublicOutputHistory);

// panel.id ("panel-1") deliberately differs from config.outputId ("out-1"): the public route is
// panel-scoped, so the second argument tells a panel-scoped read from an output-scoped one.
const metricPanel: OutputPanel = {
  id: "panel-1",
  dashboardId: "dash-1",
  title: "Revenue",
  meta: { lastUpdated: "2026-01-01T00:00:00Z" } as never,
  appearance: { background: "transparent", color: "inherit", transparency: 0 } as never,
  type: "output",
  config: { outputId: "out-1", controls: [] },
};

// Distinct payloads per route: 2,222 / 11% can only come from the PUBLIC response, 1,204 / 12%
// only from the authenticated one, so the DOM proves which response flowed through.
const PUBLIC_HISTORY = makeHistory({
  current: { capturedAt: HEAD_AT, rowCount: 10, value: 2222 },
  baseline: { capturedAt: BASE_AT, rowCount: 10, value: 2000 },
  delta: 222,
  pct: 11.0,
  sparkline: [
    { capturedAt: BASE_AT, value: 2000 },
    { capturedAt: HEAD_AT, value: 2222 },
  ],
  points: [metricPoint(HEAD_AT, 2222), metricPoint(BASE_AT, 2000)],
});

function renderAt(path: string, authenticatedUserId?: string) {
  const store = configureStore({
    reducer: { auth: authReducer, panels: panelsReducer },
    preloadedState: authenticatedUserId
      ? {
          auth: {
            currentUser: {
              id: authenticatedUserId,
              email: "owner@helio.test",
              displayName: null,
              avatarUrl: null,
              createdAt: "2026-01-01T00:00:00Z",
              tier: "free",
            },
            status: "authenticated",
            submitStatus: "idle",
            mfaChallenge: null,
          } as never,
        }
      : undefined,
  });
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
  // The history cache and comparison store are module-level; both cases share the public key
  // `publicHistoryKey("dash-1", "panel-1")`, so without a reset the second case would depend on
  // the first one's cache entry.
  resetHistoryCache();
  resetComparisonStore();
  fetchPublicDashboardPanelsMock.mockReset().mockResolvedValue([metricPanel]);
  fetchPublicOutputMetaMock.mockReset().mockResolvedValue({
    kind: "metric",
    config: METRIC_CONFIG,
    schema: [{ name: "amount", type: "integer" }],
    ownerId: null,
  });
  fetchPublicPanelRowsMock.mockReset().mockResolvedValue({
    items: [{ amount: 400 }, { amount: 500 }],
    total: 2,
    offset: 0,
    limit: 200,
  });
  fetchPublicOutputHistoryMock.mockReset().mockResolvedValue(PUBLIC_HISTORY);
  fetchOutputHistoryMock.mockReset().mockResolvedValue(makeHistory());
});

describe("PublicDashboardViewerPage — metric history source (HEL-1327)", () => {
  it.each([
    ["an anonymous viewer", undefined],
    ["a signed-in owner opening their own share link", "owner-user-id"],
  ])("%s reads the public history route, never the authenticated one", async (_label, userId) => {
    renderAt("/dashboards/dash-1/panels?token=tok", userId);

    // The route choice first: the public route with the PANEL id and the page's token, and the
    // authenticated route never.
    await waitFor(() =>
      expect(fetchPublicOutputHistoryMock).toHaveBeenCalledWith("dash-1", "panel-1", "tok"),
    );
    expect(fetchPublicOutputHistoryMock).toHaveBeenCalledTimes(1);
    expect(fetchOutputHistoryMock).not.toHaveBeenCalled();

    // The public response flows to the DOM (headline and delta exist only in PUBLIC_HISTORY).
    expect(await screen.findByText("2,222")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^up 11%/ })).toHaveTextContent("▲ 11% vs 7d");
  });
});
