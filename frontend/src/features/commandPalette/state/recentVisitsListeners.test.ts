import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit";

import {
  dashboardsReducer,
  fetchDashboards,
  dashboardRemoved,
  createDashboard,
} from "../../dashboards/state/dashboardsSlice";
import { pipelinesReducer } from "../../pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { createRecentHistoryStore } from "../model/recentHistoryStore";
import { addRecentVisitsListeners, registerDashboardVisitListener } from "./recentVisitsListeners";

describe("registerDashboardVisitListener — task 3.1", () => {
  it("records a visit when fetchDashboards.fulfilled auto-selects with no prior selection", () => {
    const listenerMiddleware = createListenerMiddleware();
    const historyStore = createRecentHistoryStore(`test.${Math.random()}`);
    registerDashboardVisitListener(listenerMiddleware.startListening as never, historyStore);
    const store = configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        sources: sourcesReducer,
        pipelines: pipelinesReducer,
      },
      middleware: (getDefault) => getDefault().prepend(listenerMiddleware.middleware),
    });

    store.dispatch({
      type: fetchDashboards.fulfilled.type,
      payload: [{ id: "d1", name: "First", meta: {}, appearance: {}, layout: {} }],
    });

    expect(historyStore.getEntries()).toEqual([
      expect.objectContaining({ kind: "dashboard", id: "d1" }),
    ]);
  });

  // skeptic-final-1.md CR1 — the whole fix: the dashboard's title must be persisted onto the
  // entry at record time (`state.dashboards.items` is read in the SAME effect that found
  // `nextId`), so the palette can render this row on `/` without depending on a later fetch.
  it("persists the dashboard's title onto the recorded entry", () => {
    const listenerMiddleware = createListenerMiddleware();
    const historyStore = createRecentHistoryStore(`test.${Math.random()}`);
    registerDashboardVisitListener(listenerMiddleware.startListening as never, historyStore);
    const store = configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        sources: sourcesReducer,
        pipelines: pipelinesReducer,
      },
      middleware: (getDefault) => getDefault().prepend(listenerMiddleware.middleware),
    });

    store.dispatch({
      type: fetchDashboards.fulfilled.type,
      payload: [{ id: "d1", name: "My Dashboard", meta: {}, appearance: {}, layout: {} }],
    });

    expect(historyStore.getEntries()[0]).toMatchObject({ id: "d1", title: "My Dashboard" });
  });

  it("records createDashboard.fulfilled — even the palette's OWN 'New dashboard' action", () => {
    const listenerMiddleware = createListenerMiddleware();
    const historyStore = createRecentHistoryStore(`test.${Math.random()}`);
    registerDashboardVisitListener(listenerMiddleware.startListening as never, historyStore);
    const store = configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        sources: sourcesReducer,
        pipelines: pipelinesReducer,
      },
      middleware: (getDefault) => getDefault().prepend(listenerMiddleware.middleware),
    });

    store.dispatch({
      type: createDashboard.fulfilled.type,
      payload: { id: "d2", name: "New one", meta: {}, appearance: {}, layout: {} },
    });

    expect(historyStore.getEntries().map((e) => e.id)).toContain("d2");
  });

  // The anti-regression for history-wipe (task 3.1 / round-2 CR2): a transition to `null`
  // (deselection) must record NOTHING, so the read-side shape validation in
  // `recentHistoryStore.ts` never sees a null-id entry that would discard the whole blob.
  it("does NOT record a transition to null (deselection), and leaves existing history intact", () => {
    const listenerMiddleware = createListenerMiddleware();
    const historyStore = createRecentHistoryStore(`test.${Math.random()}`);
    historyStore.recordVisit("dashboard", "d1");
    registerDashboardVisitListener(listenerMiddleware.startListening as never, historyStore);
    const store = configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        sources: sourcesReducer,
        pipelines: pipelinesReducer,
      },
      preloadedState: {
        dashboards: {
          items: [{ id: "d1", name: "First", meta: {}, appearance: {}, layout: {} } as never],
          selectedDashboardId: "d1",
          status: "succeeded" as const,
          error: null,
          hasPendingLayout: false,
        },
      },
      middleware: (getDefault) => getDefault().prepend(listenerMiddleware.middleware),
    });

    store.dispatch(dashboardRemoved("d1"));

    expect(store.getState().dashboards.selectedDashboardId).toBeNull();
    expect(historyStore.getEntries()).toEqual([
      expect.objectContaining({ kind: "dashboard", id: "d1" }),
    ]);
  });

  // FAILABLE BY MUTATION (per the ticket's own rule): reverting to a listener keyed on the
  // `setSelectedDashboardId` ACTION rather than the state transition must turn the FIRST test in
  // this describe block red, since `fetchDashboards.fulfilled` never dispatches that action.
  it("[mutation guard] an action-only listener on setSelectedDashboardId misses fetchDashboards.fulfilled", () => {
    const listenerMiddleware = createListenerMiddleware();
    const historyStore = createRecentHistoryStore(`test.${Math.random()}`);
    // The reverted (buggy) shape this guards against.
    listenerMiddleware.startListening({
      predicate: (action) => action.type === "dashboards/setSelectedDashboardId",
      effect: (action) => {
        const payload = (action as unknown as { payload: string | null }).payload;
        if (payload !== null) historyStore.recordVisit("dashboard", payload);
      },
    });
    const store = configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        sources: sourcesReducer,
        pipelines: pipelinesReducer,
      },
      middleware: (getDefault) => getDefault().prepend(listenerMiddleware.middleware),
    });

    store.dispatch({
      type: fetchDashboards.fulfilled.type,
      payload: [{ id: "d1", name: "First", meta: {}, appearance: {}, layout: {} }],
    });

    // Confirms the mutation actually goes red: the action-only listener records nothing here,
    // proving the state-transition predicate (asserted in the FIRST test above) is what makes
    // this case pass, not an accident of shared setup.
    expect(historyStore.getEntries()).toEqual([]);
  });
});

describe("addRecentVisitsListeners — pruning (task 4.1, design.md D4)", () => {
  it("prunes a kind's entries once its list status transitions to succeeded", () => {
    const listenerMiddleware = createListenerMiddleware();
    const historyStore = createRecentHistoryStore(`test.${Math.random()}`);
    historyStore.recordVisit("source", "gone");
    historyStore.recordVisit("source", "s1");
    addRecentVisitsListeners(listenerMiddleware.startListening as never, historyStore);
    const store = configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        sources: sourcesReducer,
        pipelines: pipelinesReducer,
      },
      middleware: (getDefault) => getDefault().prepend(listenerMiddleware.middleware),
    });

    store.dispatch({
      type: "sources/fetchSources/fulfilled",
      payload: [{ id: "s1", name: "Kept" }],
    });

    expect(historyStore.getEntries().map((e) => e.id)).toEqual(["s1"]);
  });

  // The anti-regression for "an MRU that deletes your history on a cold load" (task 4.1):
  // idle/loading/failed must all RETAIN, since none of them is evidence of deletion.
  it.each(["idle", "loading", "failed"])("does NOT prune while status is %s", (status) => {
    const listenerMiddleware = createListenerMiddleware();
    const historyStore = createRecentHistoryStore(`test.${Math.random()}`);
    historyStore.recordVisit("source", "s1");
    addRecentVisitsListeners(listenerMiddleware.startListening as never, historyStore);
    const store = configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        sources: sourcesReducer,
        pipelines: pipelinesReducer,
      },
      middleware: (getDefault) => getDefault().prepend(listenerMiddleware.middleware),
    });

    if (status === "loading") {
      store.dispatch({ type: "sources/fetchSources/pending" });
    } else if (status === "failed") {
      store.dispatch({ type: "sources/fetchSources/rejected", payload: "boom" });
    }
    // "idle" is the store's initial status — no dispatch needed.

    expect(historyStore.getEntries().map((e) => e.id)).toEqual(["s1"]);
  });
});
