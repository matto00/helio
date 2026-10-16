// HEL-1575 x HEL-1572 seam: an accent/appearance preference write returns the FULL server preferences, which now
// carry `dashboardTabs`. `updateUserPreferences.fulfilled` merges that response into `auth.currentUser.preferences`.
// The in-memory tab set (the dashboardTabs slice) is the live source after hydration, so a stale server copy in that
// response must neither revert it nor start a second hydration or a tabs write.

import { updateUserPreferences } from "../../auth/state/authSlice";
import { dash, makeTabsStore, tab, testUser } from "../../../test/tabsTestStore";
import { hydrateTabs } from "./hydrateTabs";
import { openTabInBackground } from "./dashboardTabsSlice";
import { resetTabsListenerState } from "./dashboardTabsListeners";
import { scheduleTabsWrite } from "./tabsPersistence";

jest.mock("./tabsPersistence", () => ({
  ...jest.requireActual("./tabsPersistence"),
  scheduleTabsWrite: jest.fn(),
  cancelTabsWrite: jest.fn(),
}));
jest.mock("./hydrateTabs", () => ({
  ...jest.requireActual("./hydrateTabs"),
  hydrateTabs: jest.fn(() => () => Promise.resolve()),
}));
jest.mock("./dashboardChangesService", () => ({
  fetchDashboardChanges: jest
    .fn()
    .mockResolvedValue({ serverNow: "2026-01-01T00:00:00Z", items: [] }),
}));
jest.mock("../../panels/services/panelService", () => ({
  fetchPanels: jest.fn().mockResolvedValue([]),
}));
jest.mock("../services/dashboardService", () => ({ fetchDashboards: jest.fn() }));

const D = [dash("a"), dash("b"), dash("c")];
const hydrateMock = jest.mocked(hydrateTabs);
const scheduleMock = jest.mocked(scheduleTabsWrite);

beforeEach(() => {
  hydrateMock.mockClear();
  scheduleMock.mockReset();
  resetTabsListenerState();
});

describe("an accent/appearance save response carrying dashboardTabs", () => {
  const staleServerTabs = { tabs: [{ id: "a" }], activeId: "a" };
  const response = {
    accentColor: "#3b82f6",
    zoomLevels: {},
    typeStyle: "serif" as const,
    density: "compact" as const,
    dashboardTabs: staleServerTabs,
  };

  it("does not revert a newer in-memory tab set and starts no write or hydration", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a"), tab("b")],
      activeId: "a",
      selected: "a",
      user: testUser(staleServerTabs),
    });
    dispatch(openTabInBackground("c"));
    const tabsBefore = getState().dashboardTabs;
    expect(tabsBefore.tabs.map((t) => t.id)).toEqual(["a", "c", "b"]);
    scheduleMock.mockClear();

    dispatch(updateUserPreferences.fulfilled(response, "r", { fields: ["accentColor"], user: {} }));

    expect(getState().dashboardTabs).toBe(tabsBefore);
    expect(getState().dashboardTabs.hydrated).toBe(true);
    expect(hydrateMock).not.toHaveBeenCalled();
    expect(scheduleMock).not.toHaveBeenCalled();
    // The appearance keys of the response still land beside the (server) tab copy.
    const prefs = getState().auth.currentUser?.preferences;
    expect(prefs?.typeStyle).toBe("serif");
    expect(prefs?.density).toBe("compact");
    expect(prefs?.accentColor).toBe("#3b82f6");
  });

  it("does not start a second hydration after hydration, even for a user change in preferences only", () => {
    const { dispatch } = makeTabsStore({
      dashboards: D,
      tabs: [tab("b")],
      activeId: "b",
      selected: "b",
    });
    dispatch(updateUserPreferences.fulfilled(response, "r", { fields: ["accentColor"], user: {} }));
    dispatch(
      updateUserPreferences.fulfilled(response, "r2", { fields: ["accentColor"], user: {} }),
    );
    expect(hydrateMock).not.toHaveBeenCalled();
  });
});
