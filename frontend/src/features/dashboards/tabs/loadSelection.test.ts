// HEL-1624: on a page load `selectedDashboardId` goes straight from null to the load target. The test records every value the
// selection takes through the whole load: the thunk's fulfilled write, the DashboardRoute effect (simulated: it dispatches
// setSelectedDashboardId(id) as soon as the id is in the list) and hydrateTabs with its warm wait.

import { dash, makeTabsStore, testUser } from "../../../test/tabsTestStore";
import type { DashboardTabsWire } from "./tabTypes";
import type { Dashboard } from "../types/dashboard";
import { fetchDashboards as fetchDashboardsRequest } from "../services/dashboardService";
import { fetchDashboards, setSelectedDashboardId } from "../state/dashboardsSlice";
import { fetchDashboardChanges } from "./dashboardChangesService";
import { clearWarmState } from "./warm/warmCache";

jest.mock("../services/dashboardService", () => ({
  ...jest.requireActual("../services/dashboardService"),
  fetchDashboards: jest.fn(),
}));
jest.mock("./dashboardChangesService", () => ({ fetchDashboardChanges: jest.fn() }));
jest.mock("../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../panels/services/panelService", () => ({ fetchPanels: jest.fn() }));

const listMock = jest.mocked(fetchDashboardsRequest);
const changesMock = jest.mocked(fetchDashboardChanges);

const shared = (id: string): Dashboard => ({ ...dash(id), accessRole: "editor" });
let userSeq = 0;

async function loadAndRecord(args: {
  path: string;
  list: Dashboard[];
  tabs?: DashboardTabsWire;
  noUser?: boolean;
}) {
  window.history.pushState({}, "", args.path);
  listMock.mockResolvedValue(args.list);
  changesMock.mockResolvedValue({ serverNow: new Date().toISOString(), items: [] });
  // a fresh user id per case: the hydration trigger remembers the user it already started for
  const harness = makeTabsStore({
    dashboards: [],
    dashboardsStatus: "idle",
    selected: null,
    hydrated: false,
    user: args.noUser ? null : testUser(args.tabs, `load-user-${++userSeq}`),
  });
  const seen: Array<string | null> = [harness.getState().dashboards.selectedDashboardId];
  const deepLink = /^\/dashboards\/([^/]+)\/?$/.exec(args.path)?.[1] ?? null;
  harness.store.subscribe(() => {
    const state = harness.getState();
    const value = state.dashboards.selectedDashboardId;
    if (value !== seen[seen.length - 1]) seen.push(value);
    // DashboardRoute's effect: select the routed dashboard once it is known
    if (
      deepLink !== null &&
      state.dashboards.items.some((d) => d.id === deepLink) &&
      value !== deepLink
    ) {
      harness.dispatch(setSelectedDashboardId(deepLink));
    }
  });
  await harness.dispatch(fetchDashboards());
  // let the hydration trigger listener run hydrateTabs to completion
  for (let i = 0; i < 200 && !harness.getState().dashboardTabs.hydrated; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { seen, harness };
}

const onlyNullAnd = (seen: Array<string | null>, target: string | null) =>
  seen.filter((v) => v !== null && v !== target);

describe("HEL-1624 load selection never passes through another dashboard", () => {
  beforeEach(async () => {
    await clearWarmState();
    jest.clearAllMocks();
  });
  afterEach(() => window.history.pushState({}, "", "/"));

  const list = [dash("A"), dash("B"), dash("C"), dash("D"), dash("E")];

  it("RED on main: deep link to a non-landing dashboard", async () => {
    const { seen, harness } = await loadAndRecord({ path: "/dashboards/B", list });
    expect(harness.getState().dashboards.selectedDashboardId).toBe("B");
    expect(onlyNullAnd(seen, "B")).toEqual([]);
  });

  it("RED on main: saved active tab that is not the landing default", async () => {
    const { seen, harness } = await loadAndRecord({
      path: "/dashboards",
      list,
      tabs: { tabs: [{ id: "A" }, { id: "C" }], activeId: "C" },
    });
    expect(harness.getState().dashboards.selectedDashboardId).toBe("C");
    expect(onlyNullAnd(seen, "C")).toEqual([]);
  });

  it("RED on main: surviving saved tabs with none active select the most recently viewed", async () => {
    const { seen, harness } = await loadAndRecord({
      path: "/dashboards",
      list,
      tabs: {
        tabs: [
          { id: "D", lastViewedAt: "2026-01-01T00:00:00Z" },
          { id: "E", lastViewedAt: "2026-02-01T00:00:00Z" },
        ],
        activeId: "gone",
      },
    });
    expect(harness.getState().dashboards.selectedDashboardId).toBe("E");
    expect(onlyNullAnd(seen, "E")).toEqual([]);
  });

  it("RED on main: a stored empty tab set stays null throughout", async () => {
    const { seen, harness } = await loadAndRecord({
      path: "/dashboards",
      list,
      tabs: { tabs: [], activeId: null },
    });
    expect(harness.getState().dashboards.selectedDashboardId).toBeNull();
    expect(seen.filter((v) => v !== null)).toEqual([]);
  });

  it("RED on main: grantee deep link to a shared dashboard while the user owns A", async () => {
    const { seen, harness } = await loadAndRecord({
      path: "/dashboards/S",
      list: [dash("A"), shared("S")],
    });
    expect(harness.getState().dashboards.selectedDashboardId).toBe("S");
    expect(onlyNullAnd(seen, "S")).toEqual([]);
  });

  it("GUARD (mutation: make getMostRecentDashboardId return the second item): no saved tabs selects the landing default", async () => {
    const { seen, harness } = await loadAndRecord({ path: "/dashboards", list });
    expect(harness.getState().dashboards.selectedDashboardId).toBe("A");
    expect(onlyNullAnd(seen, "A")).toEqual([]);
  });

  it("GUARD (not reachable in production: a signed-in user always exists when the list resolves): null currentUser applies the deep link and the landing default", async () => {
    const deep = await loadAndRecord({ path: "/dashboards/B", list, noUser: true });
    expect(deep.harness.getState().dashboards.selectedDashboardId).toBe("B");
    const landing = await loadAndRecord({ path: "/dashboards", list, noUser: true });
    expect(landing.harness.getState().dashboards.selectedDashboardId).toBe("A");
  });
});
