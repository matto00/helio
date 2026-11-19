// HEL-1773 D7: the command palette lists dashboards shared with the user, each marked "Shared" (search results, the
// recents section and the open-a-tab picker); an owned dashboard carries no marker.
import { configureStore } from "@reduxjs/toolkit";
import { act, render, renderHook, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";

import { authReducer } from "../auth/state/authSlice";
import { dashboardsReducer } from "../dashboards/state/dashboardsSlice";
import { outputsReducer } from "../pipelines/state/outputsSlice";
import { pipelinesReducer } from "../pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../sources/state/sourcesSlice";
import { CommandPaletteProvider } from "./CommandPaletteProvider";
import { useSetCommandQuery } from "./hooks";
import { recentHistoryStore } from "./model/recentHistoryStore";
import { useOpenTabActions } from "./useOpenTabActions";
import { useRecentPaletteActions } from "./useRecentPaletteActions";
import { useResourceSearchActions } from "./useResourceSearchActions";

const meta = {
  createdBy: "u",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};
const base = {
  meta,
  appearance: { background: "transparent", gridBackground: "transparent" },
  layout: { lg: [], md: [], sm: [], xs: [] },
};

function buildStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      dashboards: dashboardsReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      outputs: outputsReducer,
    },
    preloadedState: {
      auth: { status: "authenticated", currentUser: { id: "me" } } as never,
      dashboards: {
        items: [
          { id: "own", name: "Zeta board", accessRole: "owner", ownerId: "me", ...base },
          { id: "vw", name: "Zeta shared", accessRole: "viewer", ownerId: "other", ...base },
        ],
        selectedDashboardId: null,
        status: "succeeded" as const,
        error: null,
        hasPendingLayout: false,
      } as never,
    },
  });
}

function wrapperFor(store: ReturnType<typeof buildStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <Provider store={store}>
        <MemoryRouter>
          <CommandPaletteProvider>{children}</CommandPaletteProvider>
        </MemoryRouter>
      </Provider>
    );
  };
}

describe("shared dashboards in the command palette", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
  });
  afterEach(() => jest.useRealTimers());

  it("search results mark the shared dashboard only", () => {
    const store = buildStore();
    function Harness() {
      const setQuery = useSetCommandQuery();
      const { actions } = useResourceSearchActions();
      return (
        <>
          <button onClick={() => setQuery("zeta")}>type</button>
          <ul>
            {actions.map((a) => (
              <li key={a.id}>{`${a.title}|${a.subtitle ?? ""}`}</li>
            ))}
          </ul>
        </>
      );
    }
    render(<Harness />, { wrapper: wrapperFor(store) });
    act(() => screen.getByText("type").click());
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByText("Zeta shared|Shared")).toBeInTheDocument();
    expect(screen.getByText("Zeta board|")).toBeInTheDocument();
  });

  it("the open-a-tab picker marks the shared dashboard only", () => {
    const store = buildStore();
    const { result } = renderHook(() => useOpenTabActions(true), { wrapper: wrapperFor(store) });
    expect(result.current.map((a) => [a.title, a.subtitle])).toEqual([
      ["Zeta board", undefined],
      ["Zeta shared", "Shared"],
    ]);
  });

  it("the recents section marks a shared dashboard", () => {
    const store = buildStore();
    act(() => {
      recentHistoryStore.recordVisit("dashboard", "vw", "Zeta shared");
    });
    const { result } = renderHook(() => useRecentPaletteActions(), { wrapper: wrapperFor(store) });
    expect(result.current.map((a) => [a.title, a.subtitle])).toContainEqual([
      "Zeta shared",
      "Shared",
    ]);
  });
});
