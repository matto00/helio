import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";

import { PublicDashboardViewerPage } from "./PublicDashboardViewerPage";
import { authReducer } from "../../auth/state/authSlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { resetProvenanceCache } from "../../panels/provenance/provenanceCache";
import * as provenanceService from "../../panels/provenance/provenanceService";
import * as publicDashboardService from "../services/publicDashboardService";
import type { OutputPanel } from "../../panels/types/panel";

// HEL-1207 A1 — the public viewer's provenance row: public endpoint + token, no link/ids.

jest.mock("../services/publicDashboardService", () => ({
  fetchPublicDashboardPanels: jest.fn(),
  fetchPublicPanelRows: jest.fn(),
  fetchPublicOutputMeta: jest.fn(),
  fetchPublicDistinctValues: jest.fn(),
}));
jest.mock("../../panels/provenance/provenanceService", () => ({
  fetchOutputProvenance: jest.fn(),
  fetchPublicProvenance: jest.fn(),
}));

const panel: OutputPanel = {
  id: "panel-1",
  dashboardId: "dash-1",
  title: "Sales by region",
  meta: { lastUpdated: "2026-01-01T00:00:00Z" } as never,
  appearance: { background: "transparent", color: "inherit", transparency: 0 } as never,
  type: "output",
  config: { outputId: "out-1", controls: [] },
};

beforeEach(() => {
  resetProvenanceCache();
  jest.mocked(publicDashboardService.fetchPublicDashboardPanels).mockResolvedValue([panel]);
  jest.mocked(publicDashboardService.fetchPublicOutputMeta).mockResolvedValue({
    kind: "table",
    config: {},
    schema: [{ name: "region", type: "string" }],
    ownerId: null,
  });
  jest
    .mocked(publicDashboardService.fetchPublicPanelRows)
    .mockResolvedValue({ items: [{ region: "east" }], total: 1, offset: 0, limit: 200 });
  jest
    .mocked(provenanceService.fetchPublicProvenance)
    .mockReset()
    .mockResolvedValue({
      pipeline: { name: "Weekly sales" },
      sources: [{ name: "Orders CSV", kind: "csv" }],
      nodePath: ["filter"],
      lastRun: { status: "succeeded", completedAt: "2026-09-29T10:00:00Z", rowCount: 3 },
      assertions: { defined: true, passed: 2, failed: 0, warned: 0 },
    });
  jest.mocked(provenanceService.fetchOutputProvenance).mockReset();
});

function renderViewer() {
  const store = configureStore({ reducer: { auth: authReducer, panels: panelsReducer } });
  render(
    <MemoryRouter initialEntries={["/dashboards/dash-1/panels?token=share-tok"]}>
      <Provider store={store}>
        <Routes>
          <Route path="/dashboards/:dashboardId/panels" element={<PublicDashboardViewerPage />} />
        </Routes>
      </Provider>
    </MemoryRouter>,
  );
}

describe("PublicDashboardViewerPage provenance (HEL-1207)", () => {
  it("opens the public variant lazily with the share token; no link, ids or authenticated call", async () => {
    renderViewer();
    await waitFor(() => expect(screen.getByText("east")).toBeInTheDocument());
    expect(provenanceService.fetchPublicProvenance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Data provenance" }));
    expect(await screen.findByText("Weekly sales")).toBeInTheDocument();
    expect(provenanceService.fetchPublicProvenance).toHaveBeenCalledWith(
      "dash-1",
      "panel-1",
      "share-tok",
    );
    expect(provenanceService.fetchOutputProvenance).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Open pipeline" })).toBeNull();
    expect(screen.getByText("Filter rows")).toBeInTheDocument();
  });
});
