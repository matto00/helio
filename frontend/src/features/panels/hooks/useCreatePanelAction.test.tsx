import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { panelsReducer } from "../state/panelsSlice";
import { useCreatePanelAction } from "./useCreatePanelAction";

function makeStore(selectedDashboardId: string | null) {
  return configureStore({
    reducer: { panels: panelsReducer, dashboards: dashboardsReducer },
    preloadedState: {
      dashboards: {
        items: [],
        selectedDashboardId,
        status: "idle" as const,
        error: null,
        hasPendingLayout: false,
      },
    },
  });
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

// HEL-548 D5/D5a/workspace-create-actions — a pure flag-flip create action:
// it cannot fail and is never in flight, since PanelCreationModal owns its
// own submission.
describe("useCreatePanelAction", () => {
  it("reports no failure and no in-flight state", () => {
    const store = makeStore("dashboard-1");
    const { result } = renderHook(() => useCreatePanelAction(), { wrapper: wrapper(store) });

    expect(result.current.error).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  it("invoking the descriptor's onClick opens the PanelCreationModal flow (sets panelCreationModalOpen) when a dashboard is selected", () => {
    const store = makeStore("dashboard-1");
    const { result } = renderHook(() => useCreatePanelAction(), { wrapper: wrapper(store) });

    expect(store.getState().panels.panelCreationModalOpen).toBe(false);
    act(() => result.current.cta.onClick());
    expect(store.getState().panels.panelCreationModalOpen).toBe(true);
  });

  // workspace-create-actions spec — "An unmet precondition still blocks the
  // action": with no dashboard selected there is nothing to add a panel to,
  // so the descriptor is disabled and its onClick is a no-op — the same
  // "unavailable" behavior the flag had as local useState, preserved across
  // the D5a lift into Redux.
  it("the panel action stays unavailable with no dashboard selected", () => {
    const store = makeStore(null);
    const { result } = renderHook(() => useCreatePanelAction(), { wrapper: wrapper(store) });

    expect(result.current.cta.disabled).toBe(true);
    act(() => result.current.cta.onClick());
    expect(store.getState().panels.panelCreationModalOpen).toBe(false);
  });
});
