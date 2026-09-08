// HEL-1014 — stub-integrity guard for the jsdom `getComputedStyle` width shim
// added to `jest.setup.ts`. This is a GUARD, not a proof: it exists to fail
// loudly if the shim (or the product's width-driven desktop/phone branch it
// protects) regresses, not to establish the root cause — that's
// `App.test.tsx:893`, which is left unmodified. See files-modified.md for the
// RED/GREEN and mutation-proof transcripts.
//
// Renders the REAL, unmocked `react-grid-layout` `useContainerWidth` hook
// (via the real `PanelList`) against the real DOM node it measures in
// production — `.panel-list__zoom-container`, which carries an inline
// PERCENTAGE width (`PanelList.tsx`'s `zoomContainerStyle`). A bare `div`
// would pass here vacuously (no percentage-width ambiguity to resolve) —
// that's precisely the mistake the withdrawn D2 approach made — so this
// deliberately asserts against the actual `.panel-list__zoom-container` node
// instead of a synthetic fixture.
//
// `PanelGrid` is mocked here (capturing the `width` prop it receives) so the
// only `useContainerWidth()` call in this tree is `PanelList`'s own — same
// isolation technique as `PanelList.gridWidthSharing.test.tsx`. The sibling
// accessible-name regression guard (`panelActionsAccessibleName.test.tsx`)
// leaves `PanelGrid`/`PanelCard`/`ActionsMenu` unmocked instead, so together
// the two guards cover both halves: the measurement outcome, and what the
// real component tree does with it.

import { makeOutputPanel } from "./panelFixtures";
import { renderWithStore } from "./renderWithStore";
import { panelGridConfig } from "../features/panels/ui/grid/panelGridConfig";
import { PanelList } from "../features/panels/ui/PanelList";

const capturedGridWidths: number[] = [];

jest.mock("../features/panels/ui/grid/PanelGrid", () => {
  const React = require("react") as typeof import("react");
  return {
    PanelGrid: React.forwardRef(function MockPanelGrid(
      { width }: { width: number },
      _ref: unknown,
    ) {
      capturedGridWidths.push(width);
      return React.createElement("div", { "data-testid": "mock-panel-grid" });
    }),
  };
});

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

beforeEach(() => {
  capturedGridWidths.length = 0;
});

describe("width-measurement shim (HEL-1014) — stub-integrity guard", () => {
  it("react-grid-layout's real useContainerWidth reports a desktop-representative width for the inline-percentage-width .panel-list__zoom-container node", () => {
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

    const zoomContainer = document.querySelector(".panel-list__zoom-container");
    expect(zoomContainer).not.toBeNull();
    // Sanity: this node really does carry the inline PERCENTAGE width the
    // regression depends on, not a resolved px value a browser would already
    // report correctly without any shim.
    expect((zoomContainer as HTMLElement).style.width).toMatch(/%$/);

    expect(capturedGridWidths.length).toBeGreaterThan(0);
    const measuredWidth = capturedGridWidths[capturedGridWidths.length - 1];
    expect(measuredWidth).toBeGreaterThanOrEqual(panelGridConfig.breakpoints.sm);
  });
});
