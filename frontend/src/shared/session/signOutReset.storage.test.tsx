// HEL-1634 -- per-user browser storage is cleared on sign-out (design D4), and the two stores that
// keep an in-memory snapshot are cleared and notified, not only their storage key.
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { clearAuth, setAuth } from "../../features/auth/state/authSlice";
import { dashboardSeenStore } from "../../features/commandPalette/model/dashboardSeenStore";
import { recentHistoryStore } from "../../features/commandPalette/model/recentHistoryStore";
import { useChangedDashboardIds } from "../../features/home/hooks/useChangedDashboardIds";
import { fetchHomeSummary } from "../../features/home/services/homeService";
import { loadHomeSummary } from "../../features/home/state/homeSummarySlice";
import { store } from "../../store/store";

jest.mock("../../features/home/services/homeService", () => ({
  fetchHomeSummary: jest.fn(),
}));
jest.mock("../../features/dashboards/tabs/dashboardChangesService", () => ({
  fetchDashboardChanges: jest.fn(() => Promise.resolve({ serverNow: "", items: [] })),
}));

const USER_A = { id: "user-A", email: "a@example.com", tier: "free" } as never;
const USER_B = { id: "user-B", email: "b@example.com", tier: "free" } as never;

beforeEach(() => {
  store.dispatch(clearAuth());
  window.localStorage.clear();
  window.sessionStorage.clear();
  store.dispatch(setAuth({ user: USER_A }));
});

describe("helio.recentVisits", () => {
  test("recents of A are gone from the store snapshot and from storage after clearAuth", () => {
    const onChange = jest.fn();
    const unsubscribe = recentHistoryStore.subscribe(onChange);
    recentHistoryStore.recordVisit("dashboard", "dash-A", "A's private board");
    expect(window.localStorage.getItem("helio.recentVisits")).toContain("dash-A");
    onChange.mockClear();
    store.dispatch(clearAuth());
    expect(recentHistoryStore.getEntries()).toEqual([]);
    expect(window.localStorage.getItem("helio.recentVisits")).toBeNull();
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    recentHistoryStore.recordVisit("dashboard", "dash-B", "B's board");
    expect(onChange).toHaveBeenCalled();
    expect(recentHistoryStore.getEntries().map((e) => e.id)).toEqual(["dash-B"]);
    unsubscribe();
  });
});

describe("helio.dashboardSeen", () => {
  test("view stamps of A are gone from the store snapshot and from storage after clearAuth", () => {
    const onChange = jest.fn();
    const unsubscribe = dashboardSeenStore.subscribe(onChange);
    dashboardSeenStore.recordViewed("dash-A", 1000);
    expect(window.localStorage.getItem("helio.dashboardSeen")).toContain("dash-A");
    onChange.mockClear();
    store.dispatch(clearAuth());
    expect(dashboardSeenStore.getAll()).toEqual({});
    expect(window.localStorage.getItem("helio.dashboardSeen")).toBeNull();
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    dashboardSeenStore.recordViewed("dash-B", 2000);
    expect(onChange).toHaveBeenCalled();
    unsubscribe();
  });

  test("the Home shelf shows no changed dot from A's view stamp for the next user", async () => {
    dashboardSeenStore.recordViewed("dash-shared", Date.parse("2026-01-01T00:00:00Z"));
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>{children}</Provider>
    );
    (fetchHomeSummary as jest.Mock).mockResolvedValue({
      serverNow: "2026-01-03T00:00:00Z",
      dashboardChanges: [
        {
          dashboardId: "dash-shared",
          contentUpdatedAt: "2026-01-02T00:00:00Z",
          dataUpdatedAt: null,
        },
      ],
    });
    await act(async () => {
      await store.dispatch(loadHomeSummary() as never);
    });
    const { result } = renderHook(() => useChangedDashboardIds(), { wrapper });
    expect(result.current.has("dash-shared")).toBe(true); // A really did see a dot
    act(() => {
      store.dispatch(clearAuth());
      store.dispatch(setAuth({ user: USER_B }));
    });
    await act(async () => {
      await store.dispatch(loadHomeSummary() as never);
    });
    expect(result.current.has("dash-shared")).toBe(false);
  });

  test("B's Home summary request carries none of A's viewed dashboard ids", async () => {
    dashboardSeenStore.recordViewed("dash-A", 1000);
    store.dispatch(clearAuth());
    store.dispatch(setAuth({ user: USER_B }));
    (fetchHomeSummary as jest.Mock).mockClear();
    (fetchHomeSummary as jest.Mock).mockResolvedValue({
      serverNow: "2026-01-03T00:00:00Z",
      dashboardChanges: [],
    });
    await act(async () => {
      await store.dispatch(loadHomeSummary() as never);
    });
    expect(fetchHomeSummary).toHaveBeenCalledTimes(1);
    expect((fetchHomeSummary as jest.Mock).mock.calls[0][0]).toEqual([]);
  });
});

describe("sessionStorage helio.refinement.conversationId.*", () => {
  test("every refinement conversation id of A is removed, and unrelated keys are kept", () => {
    window.sessionStorage.setItem("helio.refinement.conversationId.dash-A", "conv-A");
    window.sessionStorage.setItem("helio.refinement.conversationId.dash-A2", "conv-A2");
    window.sessionStorage.setItem("helio.auth.returnTo", "/dashboards/x");
    store.dispatch(clearAuth());
    expect(window.sessionStorage.getItem("helio.refinement.conversationId.dash-A")).toBeNull();
    expect(window.sessionStorage.getItem("helio.refinement.conversationId.dash-A2")).toBeNull();
    expect(window.sessionStorage.getItem("helio.auth.returnTo")).toBe("/dashboards/x");
  });
});
