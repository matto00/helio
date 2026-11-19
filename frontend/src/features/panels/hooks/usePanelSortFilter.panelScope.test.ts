// HEL-1780 D4(e): in panel read scope a change that leaves the SERVER part of the window's query as it is (a sort or filter
// on a non-control column, a quick search) sends NO request -- the loaded rows (every page) stay and only the recorded
// intent moves. A change to the server part, an absent window, or a failed page 0 still dispatches. Owner scope never skips.
import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { fetchPublicPanelRows } from "../../dashboards/services/publicDashboardService";
import { getOutputRows } from "../../pipelines/services/outputService";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { fetchPanelPage, fetchPanels } from "../state/panelThunks";
import { panelsReducer } from "../state/panelsSlice";
import { usePanelSortFilter } from "./usePanelSortFilter";
import type { Dashboard } from "../../dashboards/types/dashboard";

jest.mock("../../dashboards/services/publicDashboardService");
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
}));

const publicRows = jest.mocked(fetchPublicPanelRows);
const outputRows = jest.mocked(getOutputRows);

const meta = {
  createdBy: "u",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};
const dash = (id: string, accessRole: "owner" | "viewer"): Dashboard => ({
  id,
  name: id,
  meta,
  appearance: { background: "transparent", gridBackground: "transparent" },
  layout: { lg: [], md: [], sm: [], xs: [] },
  accessRole,
});

const panel = makeOutputPanel({
  id: "p1",
  dashboardId: "d1",
  config: {
    outputId: "out-1",
    controls: [{ id: "c1", kind: "dropdown", column: "team", label: "Team" }],
  },
});

function makeStore(role: "owner" | "viewer") {
  const store = configureStore({
    reducer: {
      panels: panelsReducer,
      dashboards: dashboardsReducer,
      auth: authReducer,
      toasts: toastsReducer,
    },
  });
  const dispatch = store.dispatch as unknown as (a: unknown) => unknown;
  dispatch({ type: "dashboards/fetchDashboards/fulfilled", payload: [dash("d1", role)] });
  dispatch(fetchPanels.fulfilled([panel], "r", "d1"));
  return store;
}

const ARG = { panelId: "p1", dashboardId: "d1", outputId: "out-1" };

/** A window with two pages loaded, as after one "Load more". */
async function loadTwoPages(store: ReturnType<typeof makeStore>): Promise<void> {
  const dispatch = store.dispatch as unknown as (a: unknown) => Promise<unknown>;
  await dispatch(fetchPanelPage({ ...ARG, page: 0, pageSize: 2 }));
  await dispatch(fetchPanelPage({ ...ARG, page: 1, pageSize: 2 }));
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, children);
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(400);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function rowsOf(store: ReturnType<typeof makeStore>) {
  return store.getState().panels.paginationState["p1"];
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  let n = 0;
  const page = () => ({ items: [{ a: n++ }, { a: n++ }], total: 40, offset: 0, limit: 2 });
  publicRows.mockImplementation(async () => page());
  outputRows.mockImplementation(async () => ({ ...page(), materialized: true }));
});
afterEach(() => jest.useRealTimers());

describe("usePanelSortFilter in panel read scope: a client-only change dispatches nothing (D4(e))", () => {
  it("(i) a sort on a non-control column keeps both loaded pages and sends no request", async () => {
    const store = makeStore("viewer");
    await loadTwoPages(store);
    publicRows.mockClear();
    const { result } = renderHook(() => usePanelSortFilter("p1", "d1", "out-1", null), {
      wrapper: wrapper(store),
    });
    act(() => result.current.handleSortChange("amount", "asc"));
    await settle();
    expect(publicRows).not.toHaveBeenCalled();
    expect(rowsOf(store).rows).toHaveLength(4);
    // the new intent is recorded, so Load more and replay carry it
    expect(rowsOf(store).lastQuery?.sort).toEqual({ column: "amount", direction: "asc" });
  });

  it("(ii) a quick search keeps both loaded pages and sends no request", async () => {
    const store = makeStore("viewer");
    await loadTwoPages(store);
    publicRows.mockClear();
    const { result } = renderHook(() => usePanelSortFilter("p1", "d1", "out-1", null), {
      wrapper: wrapper(store),
    });
    act(() => result.current.handleFilterChange({ quick: "east" }));
    await settle();
    expect(publicRows).not.toHaveBeenCalled();
    expect(rowsOf(store).rows).toHaveLength(4);
    expect(rowsOf(store).lastQuery?.filter?.quick).toBe("east");
  });

  it("(iii) a column filter on a non-control column sends no request", async () => {
    const store = makeStore("viewer");
    await loadTwoPages(store);
    publicRows.mockClear();
    const { result } = renderHook(() => usePanelSortFilter("p1", "d1", "out-1", null), {
      wrapper: wrapper(store),
    });
    act(() => result.current.handleFilterChange({ columns: { amount: "9" } }));
    await settle();
    expect(publicRows).not.toHaveBeenCalled();
    expect(rowsOf(store).rows).toHaveLength(4);
  });

  it("a sort on a CONTROL column changes the server part, so it dispatches page 0", async () => {
    const store = makeStore("viewer");
    await loadTwoPages(store);
    publicRows.mockClear();
    const { result } = renderHook(() => usePanelSortFilter("p1", "d1", "out-1", null), {
      wrapper: wrapper(store),
    });
    act(() => result.current.handleSortChange("team", "asc"));
    await settle();
    expect(publicRows).toHaveBeenCalledTimes(1);
    expect(publicRows.mock.calls[0][5]).toEqual({ column: "team", direction: "asc" });
  });

  it("with no window yet (nothing loaded) it dispatches, whatever the column", async () => {
    const store = makeStore("viewer");
    const { result } = renderHook(() => usePanelSortFilter("p1", "d1", "out-1", null), {
      wrapper: wrapper(store),
    });
    act(() => result.current.handleSortChange("amount", "asc"));
    await settle();
    expect(publicRows).toHaveBeenCalledTimes(1);
    // ...and the request still names no non-control column
    expect(publicRows.mock.calls[0][5]).toBeUndefined();
  });

  it("when page 0 last failed it dispatches, so a client-only change is not a silent no-op over a broken window", async () => {
    const store = makeStore("viewer");
    await loadTwoPages(store);
    publicRows.mockRejectedValueOnce(new Error("boom"));
    await (store.dispatch as unknown as (a: unknown) => Promise<unknown>)(
      fetchPanelPage({ ...ARG, page: 0, pageSize: 2 }),
    );
    expect(rowsOf(store).lastFetchOk).toBe(false);
    publicRows.mockClear();
    const { result } = renderHook(() => usePanelSortFilter("p1", "d1", "out-1", null), {
      wrapper: wrapper(store),
    });
    act(() => result.current.handleSortChange("amount", "asc"));
    await settle();
    expect(publicRows).toHaveBeenCalledTimes(1);
  });

  it("owner scope never skips: the same change dispatches page 0 to the Output route", async () => {
    const store = makeStore("owner");
    await loadTwoPages(store);
    outputRows.mockClear();
    const { result } = renderHook(() => usePanelSortFilter("p1", "d1", "out-1", null), {
      wrapper: wrapper(store),
    });
    act(() => result.current.handleSortChange("amount", "asc"));
    await settle();
    expect(outputRows).toHaveBeenCalledTimes(1);
    expect(publicRows).not.toHaveBeenCalled();
  });
});
