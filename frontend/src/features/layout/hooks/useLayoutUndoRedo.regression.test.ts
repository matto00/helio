import { configureStore } from "@reduxjs/toolkit";
import { renderHook, act } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { dashboardsReducer, fetchDashboards } from "../../dashboards/state/dashboardsSlice";
import { layoutHistoryReducer, pushLayoutSnapshot } from "../state/layoutHistorySlice";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import { useLayoutUndoRedo } from "./useLayoutUndoRedo";

// HEL-510 tasks.md 3.3 — REGRESSION GUARD, labelled as such: `mod+shift+z` must trigger redo and
// NEVER undo.
//
// evaluation-1.md CR1 — the original single-case version of this file dispatched mod+shift+z
// only AFTER a real undo had already consumed the undo target, so `useLayoutUndoRedo.ts`'s own
// `!undoTarget` early return absorbed the mutated scenario and the test stayed green under the
// exact mutation it claimed to catch. The discriminating case below instead dispatches
// mod+shift+z while an UNDO target exists and NO redo target exists: redo's own `!redoTarget`
// guard makes it a no-op either way, so the only way the layout changes is if undo incorrectly
// fired. Verified by running the mutation (flip `shortcuts.ts`'s `layout-undo` combo from
// `shift: false` to `shift` omitted) and confirming this specific test goes red.

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};
const defaultAppearance = { background: "transparent", gridBackground: "transparent" };
const layoutA: DashboardLayout = {
  lg: [{ panelId: "a", x: 0, y: 0, w: 2, h: 2 }],
  md: [],
  sm: [],
  xs: [],
};
const layoutB: DashboardLayout = {
  lg: [{ panelId: "b", x: 2, y: 0, w: 2, h: 2 }],
  md: [],
  sm: [],
  xs: [],
};
const dashboardId = "dash-1";

function makeStore() {
  const store = configureStore({
    reducer: {
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
    } as never,
  });

  store.dispatch(
    fetchDashboards.fulfilled(
      [
        {
          id: dashboardId,
          name: "Test Dashboard",
          meta: defaultMeta,
          appearance: defaultAppearance,
          layout: layoutB,
        },
      ],
      "req",
      undefined,
    ),
  );

  return store;
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, children);
  };
}

function getLayout(store: ReturnType<typeof makeStore>): DashboardLayout | undefined {
  const state = store.getState() as never as {
    dashboards: { items: Array<{ id: string; layout: DashboardLayout }> };
  };
  return state.dashboards.items.find((d) => d.id === dashboardId)?.layout;
}

describe("useLayoutUndoRedo — REGRESSION GUARD (mod+shift+z)", () => {
  // The discriminating case (evaluation-1.md CR1): an undo target exists, NO redo target
  // exists, and mod+shift+z is dispatched. Correct behavior: nothing changes (redo's own
  // `!redoTarget` guard no-ops; undo must NOT fire because it requires `shift: false` and this
  // event holds Shift). If `layout-undo`'s `shift: false` were weakened to `shift` omitted,
  // undo would ALSO match this event and incorrectly apply, changing the layout — that is what
  // this assertion is positioned to catch.
  it("mod+shift+z changes nothing when only an undo target exists (must not fall through to undo)", () => {
    const store = makeStore();
    store.dispatch(pushLayoutSnapshot({ dashboardId, layout: layoutA }));

    renderHook(() => useLayoutUndoRedo(dashboardId), { wrapper: wrapper(store) });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });

    expect(getLayout(store)).toEqual(layoutB);
  });

  // Behavior verification (not itself the mutation-discriminating proof above): a real
  // undo-then-redo sequence lands back where it started.
  it("mod+shift+z redoes after a real undo, restoring the pre-undo layout", () => {
    const store = makeStore();
    store.dispatch(pushLayoutSnapshot({ dashboardId, layout: layoutA }));

    renderHook(() => useLayoutUndoRedo(dashboardId), { wrapper: wrapper(store) });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
      );
    });
    expect(getLayout(store)).toEqual(layoutA); // undo landed

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });

    expect(getLayout(store)).toEqual(layoutB);
  });
});
