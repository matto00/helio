// HEL-1191 design.md D6 (task 5.3) — a cross-filter cannot be set on a public dashboard
// (`PublicDashboardViewerPage` renders no `PanelCard`, `PanelInspectView` or `CrossFilterIndicator`),
// and even if one were somehow present in Redux the public content path must neither narrow client-side
// nor put anything but control-scoped ops on the public rows request (that route's allowed-column set
// is a security boundary and is deliberately not widened).

import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";

import { PublicDashboardViewerPage } from "./PublicDashboardViewerPage";
import { authReducer } from "../../auth/state/authSlice";
import { panelsReducer, setCrossFilter } from "../../panels/state/panelsSlice";
import * as publicDashboardService from "../services/publicDashboardService";
import type { OutputPanel } from "../../panels/types/panel";

jest.mock("../services/publicDashboardService", () => ({
  fetchPublicDashboardPanels: jest.fn(),
  fetchPublicPanelRows: jest.fn(),
  fetchPublicOutputMeta: jest.fn(),
  fetchPublicDistinctValues: jest.fn(),
}));

const fetchPublicDashboardPanels = jest.mocked(publicDashboardService.fetchPublicDashboardPanels);
const fetchPublicPanelRows = jest.mocked(publicDashboardService.fetchPublicPanelRows);
const fetchPublicOutputMeta = jest.mocked(publicDashboardService.fetchPublicOutputMeta);

const panel: OutputPanel = {
  id: "panel-1",
  dashboardId: "dash-1",
  title: "Sales by region",
  meta: { lastUpdated: "2026-01-01T00:00:00Z" } as never,
  appearance: { background: "transparent", color: "inherit", transparency: 0 } as never,
  type: "output",
  config: { outputId: "out-1", controls: [] },
};

describe("PublicDashboardViewerPage — HEL-1191 cross-filter isolation", () => {
  it("never narrows client-side and sends only control-scoped ops, even with a cross-filter in Redux", async () => {
    fetchPublicDashboardPanels.mockResolvedValueOnce([panel]);
    fetchPublicOutputMeta.mockResolvedValue({
      kind: "table",
      config: { columnOrder: ["region"] },
      schema: [{ name: "region", type: "string" }],
      ownerId: null,
    });
    fetchPublicPanelRows.mockResolvedValue({
      items: [{ region: "east" }, { region: "west" }],
      total: 2,
      offset: 0,
      limit: 200,
    });
    const store = configureStore({ reducer: { auth: authReducer, panels: panelsReducer } });
    store.dispatch(
      setCrossFilter({ panelId: "other", dimension: "region", value: "east", series: "" }),
    );

    render(
      <MemoryRouter initialEntries={["/dashboards/dash-1/panels?token=valid-token"]}>
        <Provider store={store}>
          <Routes>
            <Route path="/dashboards/:dashboardId/panels" element={<PublicDashboardViewerPage />} />
          </Routes>
        </Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("east")).toBeInTheDocument());
    expect(screen.getByText("west")).toBeInTheDocument();
    expect(screen.queryByText(/loaded rows match/)).not.toBeInTheDocument();
    for (const call of fetchPublicPanelRows.mock.calls) {
      const filter = call[call.length - 1] as { ops?: unknown[] } | undefined;
      expect(filter?.ops ?? []).toEqual([]);
    }
  });
});
