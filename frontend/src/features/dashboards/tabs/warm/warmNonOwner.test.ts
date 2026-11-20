// HEL-1773 D6 (inverted by HEL-1783): a dashboard the caller does not own USED to be neither kept in, nor restored from, the
// warm cache. It is now kept (panel list + row windows only, `readScope: "panel"`) and restored through the per-panel routes;
// `warmSharedDashboard.test.ts` holds the full matrix.
import { fetchPanels as fetchPanelsRequest } from "../../../panels/services/panelService";
import { dash, makeTabsStore, tab } from "../../../../test/tabsTestStore";
import { outputPanel } from "../../../../test/warmFixtures";
import { resetOutputFreshness } from "../../../panels/state/outputFreshness";
import type { DashboardChange } from "../tabTypes";
import { clearWarmState, getListEntry, setListEntry, setWarmStoreForTests } from "./warmCache";
import { captureTab } from "./warmCapture";
import { showDashboardPanels } from "./showDashboardPanels";
import { MemoryWarmStore } from "./warmStore";

jest.mock("../../../panels/services/panelService", () => ({ fetchPanels: jest.fn() }));
jest.mock("../dashboardChangesService", () => ({ fetchDashboardChanges: jest.fn() }));
jest.mock("../../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));

const fetchPanelsMock = jest.mocked(fetchPanelsRequest);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const panelsA = [outputPanel("pa1", "a", "o1")];
const panelsB = [outputPanel("pb1", "b", "o9")];

function signal(id: string): DashboardChange {
  return { dashboardId: id, contentUpdatedAt: ago(60 * 60_000), dataUpdatedAt: null, outputs: [] };
}

function scene(accessRole: "owner" | "viewer") {
  const harness = makeTabsStore({
    dashboards: [{ ...dash("a"), accessRole }, dash("b")],
    tabs: [tab("a", ago(60_000)), tab("b", ago(1_000))],
    activeId: "a",
    selected: "a",
    panels: { items: panelsB, loadedDashboardId: "b" },
    changeSignals: { a: signal("a") },
  });
  // "a" was captured 30 min ago as part of leaving it.
  setListEntry("a", {
    panels: panelsA,
    contentCapturedAt: Date.now() - 30 * 60_000,
    readScope: accessRole === "owner" ? "output" : "panel",
  });
  return harness;
}

beforeEach(async () => {
  await clearWarmState();
  resetOutputFreshness();
  setWarmStoreForTests(new MemoryWarmStore());
  fetchPanelsMock.mockReset();
  fetchPanelsMock.mockImplementation(async (id) => (id === "a" ? panelsA : panelsB));
});

describe("warm cache and a dashboard the caller does not own", () => {
  it("restores an owned dashboard's warm tab with no request (the control)", async () => {
    const { dispatch } = scene("owner");
    await dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).not.toHaveBeenCalled();
  });

  it("restores a shared dashboard's warm tab with no request (inverted from HEL-1773)", async () => {
    const { dispatch } = scene("viewer");
    await dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).not.toHaveBeenCalled();
  });

  it.each(["owner", "editor"] as const)("a %s dashboard's loaded panels are captured", (role) => {
    const { getState } = makeTabsStore({
      dashboards: [{ ...dash("a"), accessRole: role }],
      tabs: [tab("a", ago(1_000))],
      activeId: "a",
      selected: "a",
      panels: { items: panelsA, loadedDashboardId: "a" },
    });
    // A prior entry holding no panels: a capture replaces its panels with the loaded ones.
    setListEntry("a", { panels: [], contentCapturedAt: 1 });
    captureTab(getState, "a", { retain: false });
    expect(getListEntry("a")?.panels).toEqual(panelsA);
  });
});
