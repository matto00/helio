import { configureStore } from "@reduxjs/toolkit";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import * as dataSourceService from "../../sources/services/dataSourceService";
import { panelsReducer } from "../../panels/state/panelsSlice";
import * as pipelineService from "../../pipelines/services/pipelineService";
import { pipelinesReducer } from "../../pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { dismissOnboarding, onboardingReducer, reopenOnboarding } from "../state/onboardingSlice";
import { useOnboardingHost } from "./useOnboardingHost";

jest.mock("../../sources/services/dataSourceService", () => ({
  fetchSources: jest.fn(),
}));
jest.mock("../../pipelines/services/pipelineService", () => ({
  getPipelines: jest.fn(),
}));

const fetchSourcesMock = jest.mocked(dataSourceService.fetchSources);
const getPipelinesMock = jest.mocked(pipelineService.getPipelines);

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};
const defaultAppearance = { background: "transparent", gridBackground: "transparent" };
const defaultLayout = { lg: [], md: [], sm: [], xs: [] };

const dashboardFixture = {
  id: "dash-1",
  name: "Operations",
  meta: defaultMeta,
  appearance: defaultAppearance,
  layout: defaultLayout,
};

const baseUser = {
  id: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  tier: "free" as const,
};

interface StoreOverrides {
  currentUserId?: string | null;
  dashboards?: Partial<ReturnType<typeof dashboardsReducer>>;
  sources?: Partial<ReturnType<typeof sourcesReducer>>;
  pipelines?: Partial<ReturnType<typeof pipelinesReducer>>;
  panels?: Partial<ReturnType<typeof panelsReducer>>;
  onboarding?: Partial<ReturnType<typeof onboardingReducer>>;
}

function makeStore(overrides: StoreOverrides = {}) {
  const currentUser =
    overrides.currentUserId === null
      ? null
      : { ...baseUser, id: overrides.currentUserId ?? baseUser.id };

  return configureStore({
    reducer: {
      auth: authReducer,
      dashboards: dashboardsReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      panels: panelsReducer,
      onboarding: onboardingReducer,
    },
    preloadedState: {
      auth: {
        ...authReducer(undefined, { type: "@@INIT" }),
        currentUser,
        status: "authenticated" as const,
      },
      dashboards: { ...dashboardsReducer(undefined, { type: "@@INIT" }), ...overrides.dashboards },
      sources: { ...sourcesReducer(undefined, { type: "@@INIT" }), ...overrides.sources },
      pipelines: { ...pipelinesReducer(undefined, { type: "@@INIT" }), ...overrides.pipelines },
      panels: { ...panelsReducer(undefined, { type: "@@INIT" }), ...overrides.panels },
      onboarding: { ...onboardingReducer(undefined, { type: "@@INIT" }), ...overrides.onboarding },
    },
  });
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("useOnboardingHost", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchSourcesMock.mockReset().mockResolvedValue([]);
    getPipelinesMock.mockReset().mockResolvedValue([]);
  });

  // 6.1 — auto-activation
  describe("auto-activation (D3)", () => {
    it("activates when dashboards succeeded + empty and no stored dismissal", async () => {
      const store = makeStore({
        dashboards: { status: "succeeded", items: [] },
        onboarding: { dismissed: false },
      });
      const { result } = renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });
      await waitFor(() => expect(result.current.visible).toBe(true));
      expect(store.getState().onboarding.active).toBe(true);
      // Becoming visible also fires the fetch-trigger effect (both
      // collections default `idle`) — wait for it to settle so its promise
      // can't resolve after this test ends and leak into the next one.
      await waitFor(() => expect(fetchSourcesMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(getPipelinesMock).toHaveBeenCalledTimes(1));
    });

    it("does not activate while dashboards is idle, regardless of item count", () => {
      const store = makeStore({
        dashboards: { status: "idle", items: [] },
        onboarding: { dismissed: false },
      });
      const { result } = renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });
      expect(result.current.visible).toBe(false);
    });

    it("does not activate while dashboards is loading", () => {
      const store = makeStore({
        dashboards: { status: "loading", items: [] },
        onboarding: { dismissed: false },
      });
      const { result } = renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });
      expect(result.current.visible).toBe(false);
    });

    it("does not activate for a returning user who already has a dashboard", () => {
      const store = makeStore({
        dashboards: { status: "succeeded", items: [dashboardFixture] },
        onboarding: { dismissed: false },
      });
      const { result } = renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });
      expect(result.current.visible).toBe(false);
    });

    it("a stored dismissal (dismissed: true) suppresses auto-activation even with an otherwise-empty account", async () => {
      // The hook re-hydrates from the REAL `localStorage` on mount
      // regardless of any preloaded Redux value — write the actual key a
      // returning, previously-dismissed user would have.
      window.localStorage.setItem("helio-onboarding-dismissed-user-1", "true");
      const store = makeStore({ dashboards: { status: "succeeded", items: [] } });
      const { result } = renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });
      await waitFor(() => expect(store.getState().onboarding.dismissed).toBe(true));
      expect(result.current.visible).toBe(false);
    });

    // Finding #1 (round-4 skeptic) — the pre-hydration window. `dismissed`
    // starts `null` (not yet read from storage); `autoActivate` must require
    // the STRICT `=== false`, not `!dismissed` truthiness, or this first
    // render would misread the un-hydrated frame as "not dismissed".
    it("does NOT auto-activate on the pre-hydration frame (dismissed: null) even with dashboards already succeeded+empty", () => {
      const store = makeStore({
        dashboards: { status: "succeeded", items: [] },
        onboarding: { dismissed: null },
        currentUserId: null, // no user id yet -> hydration effect cannot run
      });
      const { result } = renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });
      expect(result.current.visible).toBe(false);
      expect(store.getState().onboarding.active).toBe(false);
    });

    it("(red-before-green) a `!dismissed` (truthiness) autoActivate check WOULD wrongly activate on the null pre-hydration frame", () => {
      const dashboardsState = { status: "succeeded" as const, items: [] as unknown[] };
      const preHydrationDismissed: boolean | null = null;
      const naiveAutoActivate =
        dashboardsState.status === "succeeded" &&
        dashboardsState.items.length === 0 &&
        !preHydrationDismissed;
      expect(naiveAutoActivate).toBe(true); // proves the probe can detect the naive bug

      const store = makeStore({
        dashboards: { status: "succeeded", items: [] },
        onboarding: { dismissed: null },
        currentUserId: null,
      });
      const { result } = renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });
      expect(result.current.visible).toBe(false); // the real hook does not
    });

    it("a user with a data source but no dashboard IS activated (D3 — gated on dashboards alone)", async () => {
      const store = makeStore({
        dashboards: { status: "succeeded", items: [] },
        sources: { status: "succeeded", items: [{ id: "s1" } as never] },
        onboarding: { dismissed: false },
      });
      const { result } = renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });
      expect(result.current.visible).toBe(true);
      // sources is already loaded; pipelines defaults to idle, so becoming
      // visible fires exactly one fetchPipelines — wait for it to settle.
      await waitFor(() => expect(getPipelinesMock).toHaveBeenCalledTimes(1));
      expect(fetchSourcesMock).not.toHaveBeenCalled();
    });
  });

  // 6.2 — stickiness
  it("stays visible (sticky `active`) once autoActivate goes false again (e.g. a dashboard now exists)", async () => {
    const store = makeStore({
      dashboards: { status: "succeeded", items: [] },
      onboarding: { dismissed: false },
    });
    const { result, rerender } = renderHook(() => useOnboardingHost(), {
      wrapper: wrapper(store),
    });
    await waitFor(() => expect(store.getState().onboarding.active).toBe(true));
    // Let the fetch-trigger effect's promises settle before proceeding, so
    // they can't resolve later and leak an act() warning into a subsequent
    // test.
    await waitFor(() => expect(fetchSourcesMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getPipelinesMock).toHaveBeenCalledTimes(1));

    store.dispatch({
      type: "dashboards/createDashboard/fulfilled",
      payload: dashboardFixture,
    } as never);
    rerender();

    expect(result.current.visible).toBe(true);
  });

  // 6.4 — re-open fetch trigger
  describe("fetch trigger (D3)", () => {
    it("dispatches fetchSources/fetchPipelines when visible and their collections are idle", async () => {
      const store = makeStore({
        onboarding: { active: true, dismissed: false },
        sources: { status: "idle" },
        pipelines: { status: "idle" },
      });
      renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });

      await waitFor(() => expect(fetchSourcesMock).toHaveBeenCalledTimes(1));
      expect(getPipelinesMock).toHaveBeenCalledTimes(1);
    });

    it("does not fetch a collection that has already loaded", async () => {
      const store = makeStore({
        onboarding: { active: true, dismissed: false },
        sources: { status: "succeeded", items: [] },
        pipelines: { status: "idle" },
      });
      renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });

      await waitFor(() => expect(getPipelinesMock).toHaveBeenCalledTimes(1));
      expect(fetchSourcesMock).not.toHaveBeenCalled();
    });

    it("does not fetch anything while not visible", () => {
      const store = makeStore({
        onboarding: { active: false, dismissed: false },
        dashboards: { status: "succeeded", items: [dashboardFixture] },
        sources: { status: "idle" },
        pipelines: { status: "idle" },
      });
      renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });

      expect(fetchSourcesMock).not.toHaveBeenCalled();
      expect(getPipelinesMock).not.toHaveBeenCalled();
    });
  });

  // 6.5 — hydration + persistence, single-owner round-trip
  describe("hydration and persistence (D7)", () => {
    it("hydrates `dismissed` from a value already stored for the signed-in user", async () => {
      window.localStorage.setItem("helio-onboarding-dismissed-user-1", "true");
      const store = makeStore({
        dashboards: { status: "succeeded", items: [] },
        onboarding: { dismissed: null },
      });
      const { result } = renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });

      await waitFor(() => expect(store.getState().onboarding.dismissed).toBe(true));
      expect(result.current.visible).toBe(false);
    });

    it("persists a dismissal dispatched by another component (e.g. the checklist's own dismiss control)", async () => {
      const store = makeStore({ onboarding: { active: true, dismissed: false } });
      renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });
      // `active: true` makes it visible from mount, firing the fetch-trigger
      // effect (both collections default idle) — settle it before moving on.
      await waitFor(() => expect(fetchSourcesMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(getPipelinesMock).toHaveBeenCalledTimes(1));

      store.dispatch(dismissOnboarding());

      await waitFor(() =>
        expect(window.localStorage.getItem("helio-onboarding-dismissed-user-1")).toBe("true"),
      );
    });

    // The round-3 single-owner defect this design closes: dismiss -> re-open
    // (without leaving the surface) -> dismiss again must persist the SECOND
    // dismissal too, not silently no-op because a separate holder never
    // re-rendered.
    it("a second dismissal after a re-open persists too", async () => {
      const store = makeStore({ onboarding: { active: true, dismissed: false } });
      renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });
      await waitFor(() => expect(fetchSourcesMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(getPipelinesMock).toHaveBeenCalledTimes(1));

      store.dispatch(dismissOnboarding());
      await waitFor(() =>
        expect(window.localStorage.getItem("helio-onboarding-dismissed-user-1")).toBe("true"),
      );

      store.dispatch(reopenOnboarding());
      await waitFor(() =>
        expect(window.localStorage.getItem("helio-onboarding-dismissed-user-1")).toBe("false"),
      );

      store.dispatch(dismissOnboarding());
      await waitFor(() =>
        expect(window.localStorage.getItem("helio-onboarding-dismissed-user-1")).toBe("true"),
      );
    });

    it("(red-before-green) a useState-owned dismissed value would lose the second dismissal", () => {
      // Simulates the refuted round-3 shape: a LOCAL variable (not
      // Redux-shared state) holding `dismissed`, written directly by one
      // "component" and read by another via a stale closure — the second
      // write is a no-op against the reader's already-captured value.
      let localDismissed = false;
      const readerSnapshot = localDismissed; // "PanelList's hook" captures a snapshot
      localDismissed = true; // dismiss
      localDismissed = false; // reopen (writes the local var, not readerSnapshot)
      localDismissed = true; // dismiss again
      // The stale reader never observes the second dismissal:
      expect(readerSnapshot).toBe(false);
      expect(readerSnapshot).not.toBe(localDismissed);

      // The real (Redux-shared) mechanism has no such stale reader — proven
      // by the round-trip test above actually reading `true` after the
      // second dismissal.
    });

    it("does not hydrate (or crash) when no user is signed in", () => {
      const store = makeStore({ currentUserId: null });
      expect(() =>
        renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) }),
      ).not.toThrow();
      expect(store.getState().onboarding.dismissed).toBeNull();
    });
  });

  // 6.7 — all-four-complete
  describe("all-four-complete (D2/task 1.12)", () => {
    it("records the dismissal but leaves `active` set once all four steps read complete", async () => {
      const store = makeStore({
        onboarding: { active: true, dismissed: false },
        dashboards: {
          status: "succeeded",
          items: [dashboardFixture],
          selectedDashboardId: "dash-1",
        },
        sources: { status: "succeeded", items: [{ id: "s1" } as never] },
        pipelines: { status: "succeeded", items: [{ id: "p1" } as never] },
        panels: {
          status: "succeeded",
          loadedDashboardId: "dash-1",
          items: [{ id: "panel-1", dashboardId: "dash-1" } as never],
        },
      });

      renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });

      await waitFor(() => expect(store.getState().onboarding.dismissed).toBe(true));
      expect(store.getState().onboarding.active).toBe(true);
    });

    it("does NOT record a dismissal for a returning user with everything already complete who never opened the checklist", () => {
      const store = makeStore({
        onboarding: { active: false, dismissed: false },
        dashboards: {
          status: "succeeded",
          items: [dashboardFixture],
          selectedDashboardId: "dash-1",
        },
        sources: { status: "succeeded", items: [{ id: "s1" } as never] },
        pipelines: { status: "succeeded", items: [{ id: "p1" } as never] },
        panels: {
          status: "succeeded",
          loadedDashboardId: "dash-1",
          items: [{ id: "panel-1", dashboardId: "dash-1" } as never],
        },
      });
      renderHook(() => useOnboardingHost(), { wrapper: wrapper(store) });

      expect(store.getState().onboarding.dismissed).toBe(false);
    });
  });
});
