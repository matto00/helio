import { fetchDashboardChanges } from "./dashboardChangesService";
import { refreshChangeSignals } from "./refreshChangeSignals";
import { dash, makeTabsStore, tab } from "../../../test/tabsTestStore";
import { getServerOffsetMs, resetServerClock } from "./serverClock";
import { httpClient } from "../../../services/httpClient";

jest.mock("./dashboardChangesService", () => ({
  ...jest.requireActual("./dashboardChangesService"),
  fetchDashboardChanges: jest.fn(),
}));
jest.mock("../../panels/services/panelService", () => ({ fetchPanels: jest.fn() }));

const changesMock = jest.mocked(fetchDashboardChanges);

describe("refreshChangeSignals (HEL-1575 D7)", () => {
  beforeEach(() => {
    changesMock.mockReset();
    resetServerClock();
  });

  it("requests the signals for every open tab and records them with the server clock offset", async () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: [dash("a"), dash("b")],
      tabs: [tab("a"), tab("b")],
      activeId: "a",
      selected: "a",
    });
    const serverNow = new Date(Date.now() + 30_000).toISOString();
    changesMock.mockResolvedValue({
      serverNow,
      items: [{ dashboardId: "a", contentUpdatedAt: serverNow, dataUpdatedAt: null, outputs: [] }],
    });
    await dispatch(refreshChangeSignals(undefined));
    expect(changesMock).toHaveBeenCalledWith(["a", "b"]);
    expect(getState().dashboardTabs.changeSignals.a.contentUpdatedAt).toBe(serverNow);
    expect(Math.abs(getState().dashboardTabs.serverOffsetMs - 30_000)).toBeLessThan(1_000);
    expect(getServerOffsetMs()).toBe(getState().dashboardTabs.serverOffsetMs);
  });

  it("asks for only the given ids (a tab addition fetches the new ids)", async () => {
    const { dispatch } = makeTabsStore({
      dashboards: [dash("a")],
      tabs: [tab("a")],
      activeId: "a",
    });
    changesMock.mockResolvedValue({ serverNow: new Date().toISOString(), items: [] });
    await dispatch(refreshChangeSignals(["z"]));
    expect(changesMock).toHaveBeenCalledWith(["z"]);
  });

  it("makes no request with no tabs, and a failure leaves the signals as they were", async () => {
    const empty = makeTabsStore({});
    await empty.dispatch(refreshChangeSignals(undefined));
    expect(changesMock).not.toHaveBeenCalled();

    const { dispatch, getState } = makeTabsStore({
      dashboards: [dash("a")],
      tabs: [tab("a")],
      activeId: "a",
      changeSignals: {
        a: { dashboardId: "a", contentUpdatedAt: "x", dataUpdatedAt: null, outputs: [] },
      },
    });
    changesMock.mockRejectedValue(new Error("503"));
    const result = await dispatch(refreshChangeSignals(undefined));
    expect(result.payload).toBe(false);
    expect(getState().dashboardTabs.changeSignals.a.contentUpdatedAt).toBe("x");
  });

  it("never issues a panel or rows request: only the changes endpoint", async () => {
    const get = jest.spyOn(httpClient, "get");
    const actual = jest.requireActual("./dashboardChangesService");
    changesMock.mockImplementation(actual.fetchDashboardChanges);
    get.mockResolvedValue({ data: { serverNow: new Date().toISOString(), items: [] } });
    const { dispatch } = makeTabsStore({
      dashboards: [dash("a")],
      tabs: [tab("a")],
      activeId: "a",
    });
    await dispatch(refreshChangeSignals(undefined));
    expect(get.mock.calls.map((c) => c[0])).toEqual(["/api/dashboard-changes"]);
    expect(get.mock.calls[0][1]).toEqual({ params: { ids: "a" } });
    get.mockRestore();
  });

  it("normalises missing keys in a response into nulls (nothing is read as a time)", async () => {
    const get = jest.spyOn(httpClient, "get");
    const actual = jest.requireActual("./dashboardChangesService");
    get.mockResolvedValue({
      data: { serverNow: "2026-01-01T00:00:00Z", items: [{ dashboardId: "a" }] },
    });
    const result = await actual.fetchDashboardChanges(["a"]);
    expect(result.items[0]).toEqual({
      dashboardId: "a",
      contentUpdatedAt: null,
      dataUpdatedAt: null,
      outputs: [],
    });
    get.mockRestore();
  });
});
