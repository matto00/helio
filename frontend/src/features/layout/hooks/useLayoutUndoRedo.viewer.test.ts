// HEL-1782 D2: the layout undo/redo shortcuts do nothing on a dashboard the caller cannot edit. The history is SEEDED
// (an editor downgraded mid-session keeps its layout history), otherwise an empty history makes undo a no-op anyway and
// the test would pass without the guard.
import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer, fetchDashboards } from "../../dashboards/state/dashboardsSlice";
import type { DashboardAccessRole, DashboardLayout } from "../../dashboards/types/dashboard";
import { layoutHistoryReducer, pushLayoutSnapshot } from "../state/layoutHistorySlice";
import { useLayoutUndoRedo } from "./useLayoutUndoRedo";

const meta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};
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

function setup(accessRole: DashboardAccessRole) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
    } as never,
  });
  store.dispatch(
    fetchDashboards.fulfilled(
      [
        {
          id: dashboardId,
          name: "Shared board",
          meta,
          appearance: { background: "transparent", gridBackground: "transparent" },
          layout: layoutB,
          accessRole,
          ownerId: accessRole === "owner" ? "me" : "other",
        },
      ],
      "req",
      undefined,
    ),
  );
  store.dispatch(pushLayoutSnapshot({ dashboardId, layout: layoutA }));
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(Provider, { store } as never, children);
  renderHook(() => useLayoutUndoRedo(dashboardId), { wrapper });
  const layout = () =>
    (
      store.getState() as never as {
        dashboards: { items: Array<{ id: string; layout: DashboardLayout }> };
      }
    ).dashboards.items.find((d) => d.id === dashboardId)?.layout;
  return { layout };
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "z",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe("useLayoutUndoRedo by role (HEL-1782)", () => {
  it("a viewer's undo and redo apply nothing and leave the browser default alone, even with history", () => {
    const { layout } = setup("viewer");
    const undo = press({});
    expect(undo.defaultPrevented).toBe(false);
    expect(layout()).toEqual(layoutB);
    const redo = press({ shiftKey: true });
    expect(redo.defaultPrevented).toBe(false);
    expect(layout()).toEqual(layoutB);
  });

  it("an editor with the same history IS undone (the viewer test is not vacuous)", () => {
    const { layout } = setup("editor");
    const undo = press({});
    expect(undo.defaultPrevented).toBe(true);
    expect(layout()).toEqual(layoutA);
  });
});
