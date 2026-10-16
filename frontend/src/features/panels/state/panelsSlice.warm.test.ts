import { configureStore } from "@reduxjs/toolkit";

import { outputPanel, settledWindow } from "../../../test/warmFixtures";
import { setServerOffsetMs, resetServerClock } from "../../dashboards/tabs/serverClock";
import {
  fetchPanelPage,
  fetchPanels,
  paginationHydrated,
  panelsReducer,
  panelsRestored,
  restoreFinished,
  restoreStarted,
  selectDataPoint,
  setCrossFilter,
} from "./panelsSlice";

jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn().mockResolvedValue({ items: [], total: 0, materialized: true }),
}));

const init = { type: "@@init" };

describe("panelsSlice warm-cache reducers (HEL-1575 D4/D5)", () => {
  it("panelsRestored lands succeeded with the items and applies fetchPanels.pending's resets", () => {
    let state = panelsReducer(undefined, init);
    state = panelsReducer(
      state,
      selectDataPoint({ panelId: "p", dimension: "d", value: "v" } as never),
    );
    state = panelsReducer(
      state,
      setCrossFilter({ panelId: "p", dimension: "d", value: "v", series: undefined } as never),
    );
    state = panelsReducer(state, restoreStarted("a"));
    const items = [outputPanel("p1", "a", "o1")];
    state = panelsReducer(state, panelsRestored({ dashboardId: "a", items }));
    expect(state.items).toBe(items);
    expect(state.loadedDashboardId).toBe("a");
    expect(state.status).toBe("succeeded");
    expect(state.staleDashboardId).toBeNull();
    expect(state.interactionState).toEqual({});
    expect(state.crossFilter).toBeNull();
    expect(state.restoringDashboardId).toBeNull();
  });

  it("restoreStarted / restoreFinished toggle the skeleton flag", () => {
    let state = panelsReducer(undefined, restoreStarted("a"));
    expect(state.restoringDashboardId).toBe("a");
    state = panelsReducer(state, restoreFinished());
    expect(state.restoringDashboardId).toBeNull();
  });

  it("paginationHydrated adds windows but never clobbers an existing one, and never touches latestFetchRequestId", () => {
    let state = panelsReducer(undefined, init);
    const live = { ...settledWindow("o1", 9), rows: [{ live: true }] };
    state = panelsReducer(state, paginationHydrated({ p1: live }));
    const before = state.latestFetchRequestId;
    state = panelsReducer(
      state,
      paginationHydrated({ p1: settledWindow("o1", 1), p2: settledWindow("o2", 1) }),
    );
    expect(state.paginationState.p1.rows).toEqual([{ live: true }]);
    expect(state.paginationState.p2).toBeDefined();
    expect(state.latestFetchRequestId).toBe(before);
  });

  it("an in-flight window is not clobbered by a hydrate either", () => {
    const store = configureStore({ reducer: { panels: panelsReducer } });
    void store.dispatch(
      fetchPanelPage({ panelId: "p1", outputId: "o1", page: 0, pageSize: 50 }) as never,
    );
    expect(store.getState().panels.paginationState.p1.isLoadingMore).toBe(true);
    store.dispatch(paginationHydrated({ p1: settledWindow("o1", 1) }));
    expect(store.getState().panels.paginationState.p1.isLoadingMore).toBe(true);
  });

  describe("per-window capturedAt (design D4: server time at the START of the latest page-0 request)", () => {
    afterEach(() => resetServerClock());

    it("is stamped in server time on a page-0 request and kept through fulfilled", async () => {
      setServerOffsetMs(60_000);
      const store = configureStore({ reducer: { panels: panelsReducer } });
      const before = Date.now() + 60_000;
      const promise = store.dispatch(
        fetchPanelPage({ panelId: "p1", outputId: "o1", page: 0, pageSize: 50 }) as never,
      );
      const pendingAt = store.getState().panels.paginationState.p1.capturedAt as number;
      expect(pendingAt).toBeGreaterThanOrEqual(before);
      expect(pendingAt).toBeLessThanOrEqual(Date.now() + 60_000);
      await promise;
      expect(store.getState().panels.paginationState.p1.capturedAt).toBe(pendingAt);
    });

    it("a refresh moves it forward; a load-more (page > 0) leaves it alone", async () => {
      const store = configureStore({ reducer: { panels: panelsReducer } });
      await store.dispatch(
        fetchPanelPage({ panelId: "p1", outputId: "o1", page: 0, pageSize: 50 }) as never,
      );
      const first = store.getState().panels.paginationState.p1.capturedAt as number;
      await new Promise((r) => setTimeout(r, 5));
      await store.dispatch(
        fetchPanelPage({ panelId: "p1", outputId: "o1", page: 1, pageSize: 50 }) as never,
      );
      expect(store.getState().panels.paginationState.p1.capturedAt).toBe(first);
      await store.dispatch(
        fetchPanelPage({ panelId: "p1", outputId: "o1", page: 0, pageSize: 50 }) as never,
      );
      expect(store.getState().panels.paginationState.p1.capturedAt as number).toBeGreaterThan(
        first,
      );
    });
  });

  it("fetchPanels is unaffected: a normal load still records its dashboard", () => {
    const state = panelsReducer(undefined, fetchPanels.pending("r", "a"));
    expect(state.loadedDashboardId).toBe("a");
    expect(state.status).toBe("loading");
  });
});
