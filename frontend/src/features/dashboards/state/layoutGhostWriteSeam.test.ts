// HEL-1456 client half of the ghost-write seam. A store layout can still hold a deleted panel's item;
// the client sends it back as authored (`buildLayoutPatch` never strips), and the SERVER drops it. This
// proves the body the client builds from such a layout, and that the thunk adopts the ghost-free response.
// The shared fixture is also PATCHed to the real route by the backend DashboardLayoutGhostSeamSpec.
import fs from "node:fs";
import path from "node:path";
import { configureStore } from "@reduxjs/toolkit";

import { updateDashboardLayout as updateDashboardLayoutRequest } from "../services/dashboardService";
import { buildLayoutPatch } from "./layoutPatch";
import { resolveDashboardLayout } from "./dashboardLayout";
import { dashboardsReducer, updateDashboardLayout } from "./dashboardsSlice";
import type { Dashboard, DashboardLayout } from "../types/dashboard";
import type { Panel } from "../../panels/types/panel";

jest.mock("../services/dashboardService", () => ({
  ...jest.requireActual("../services/dashboardService"),
  updateDashboardLayout: jest.fn(),
}));

interface GhostFixture {
  panels: string[];
  ghost: string;
  stored: DashboardLayout;
  local: DashboardLayout;
  patch: Partial<DashboardLayout>;
  expectedStored: DashboardLayout;
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../../../shared-test-fixtures/layout-ghost-write-seam.json"),
    "utf8",
  ),
) as GhostFixture;

const updateMock = jest.mocked(updateDashboardLayoutRequest);
const panels = fixture.panels.map((id) => ({ id }) as Panel);
const dashboard = (layout: DashboardLayout): Dashboard => ({
  id: "d1",
  name: "D",
  meta: { createdBy: "u", createdAt: "2026-03-14T00:00:00Z", lastUpdated: "2026-03-14T00:00:00Z" },
  appearance: { background: "transparent", gridBackground: "transparent" },
  layout,
});
const hasGhost = (layout: Partial<DashboardLayout>) =>
  Object.values(layout).some((items) => items.some((i) => i.panelId === fixture.ghost));

describe("layout PATCH from a ghost-bearing store layout (shared with the backend DashboardLayoutGhostSeamSpec)", () => {
  it("the fixture's local and stored layouts really hold the ghost, and the expected result does not", () => {
    expect(hasGhost(fixture.stored)).toBe(true);
    expect(hasGhost(fixture.local)).toBe(true);
    expect(hasGhost(fixture.expectedStored)).toBe(false);
  });

  it("builds the PATCH body the backend seam spec sends", () => {
    const resolved = resolveDashboardLayout(panels, fixture.local);
    expect(buildLayoutPatch(fixture.local, fixture.stored, resolved)).toEqual(fixture.patch);
  });

  it("adopts the ghost-free response layout and clears the pending flag", async () => {
    updateMock.mockResolvedValue(dashboard(fixture.expectedStored));
    const store = configureStore({
      reducer: { dashboards: dashboardsReducer },
      preloadedState: {
        dashboards: {
          items: [dashboard(fixture.local)],
          selectedDashboardId: "d1",
          status: "succeeded" as const,
          error: null,
          hasPendingLayout: true,
        },
      },
    });

    await store.dispatch(
      updateDashboardLayout({
        dashboardId: "d1",
        layout: fixture.patch,
        sentLayout: fixture.local,
      }),
    );

    expect(updateMock).toHaveBeenCalledWith("d1", fixture.patch, undefined);
    expect(store.getState().dashboards.items[0].layout).toEqual(fixture.expectedStored);
    expect(store.getState().dashboards.hasPendingLayout).toBe(false);
  });
});
