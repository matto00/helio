// HEL-1014 — regression guard for the panel-actions button's accessible
// name on the desktop branch. This is a GUARD, not a proof: `App.test.tsx`'s
// two existing, unmodified assertions at line 893 are the proof (RED under
// react-grid-layout 2.2.4 before the `jest.setup.ts` shim, GREEN after). This
// guard exists so a future regression in the same shape fails here too,
// without depending on `App.test.tsx`'s much larger render tree.
//
// Deliberately leaves `PanelGrid` (and therefore `DesktopPanelGrid`,
// `PanelCard`, `ActionsMenu`) completely unmocked, so `useContainerWidth`
// runs for real and the accessible name asserted below is the one the real
// component tree produces — not a mock's stand-in. See
// `widthMeasurementShim.test.tsx` for the companion stub-integrity guard,
// which isolates the width-measurement outcome by mocking `PanelGrid`
// instead; together the two guards cover both halves of the mechanism.

import { screen } from "@testing-library/react";

import { makeOutputPanel } from "./panelFixtures";
import { renderWithStore } from "./renderWithStore";
import { PanelList } from "../features/panels/ui/PanelList";

// HEL-1600 -- stands in for GET /api/outputs/:id, GET /api/outputs/:id/assertion-status, GET /api/outputs/:id/rows, which this test reaches but does not exercise
// (the network guard fails an unmocked request); rejects (a plain Error) in place of the AxiosError network failure.
jest.mock("../features/pipelines/services/outputService", () => ({
  ...jest.requireActual("../features/pipelines/services/outputService"),
  getOutputById: jest.fn(() =>
    Promise.reject(new Error("getOutputById: unmocked request stubbed (HEL-1600)")),
  ),
  getAssertionStatus: jest.fn(() =>
    Promise.reject(new Error("getAssertionStatus: unmocked request stubbed (HEL-1600)")),
  ),
  getOutputRows: jest.fn(() =>
    Promise.reject(new Error("getOutputRows: unmocked request stubbed (HEL-1600)")),
  ),
}));

jest.mock("../features/panels/services/panelService", () => ({
  createPanel: jest.fn(),
  fetchPanels: jest.fn(),
  updatePanelAppearance: jest.fn(),
}));

jest.mock("../features/dashboards/services/dashboardService", () => ({
  createDashboard: jest.fn(),
}));

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const defaultDashboardAppearance = { background: "transparent", gridBackground: "transparent" };
const defaultDashboardLayout = { lg: [], md: [], sm: [], xs: [] };
const defaultPanelAppearance = { background: "transparent", color: "inherit", transparency: 0 };

const dashboardsState = {
  items: [
    {
      id: "dashboard-1",
      name: "Operations",
      meta: defaultMeta,
      appearance: defaultDashboardAppearance,
      layout: defaultDashboardLayout,
    },
  ],
  selectedDashboardId: "dashboard-1",
};

describe("panel-actions accessible name on the desktop branch (HEL-1014) — regression guard", () => {
  it("is reachable via getByRole('button', { name: /panel actions/ }) through the real, unmocked component tree", async () => {
    const panel = makeOutputPanel({
      id: "panel-1",
      dashboardId: "dashboard-1",
      title: "Revenue",
      meta: defaultMeta,
      appearance: defaultPanelAppearance,
    });

    renderWithStore(<PanelList />, {
      dashboards: dashboardsState,
      panels: { items: [panel], loadedDashboardId: "dashboard-1", status: "succeeded" },
    });

    const panelActionsButton = await screen.findByRole("button", { name: /panel actions/ });
    expect(panelActionsButton).toBeInTheDocument();
  });
});
