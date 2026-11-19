// HEL-1780 D1: the one routing rule. Owner of the panel's OWN dashboard -> `output`; every other case, including a dashboard
// the store does not hold and a switch in flight (selected dashboard != the panel's), -> `panel`.
import { configureStore } from "@reduxjs/toolkit";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import type { RootState } from "../../../store/store";
import { ownedDashboard } from "../../../test/seedOwnedDashboard";
import { panelReadScopeFor, usePanelReadScope } from "./panelReadScope";

function storeWith(
  dashboards: Array<{ id: string; accessRole?: "owner" | "editor" | "viewer" }>,
  selected: string | null = null,
) {
  const base = dashboardsReducer(undefined, { type: "@@INIT" });
  return configureStore({
    reducer: { dashboards: dashboardsReducer, auth: authReducer },
    preloadedState: {
      dashboards: {
        ...base,
        items: dashboards.map((d) => ({ ...ownedDashboard(d.id), accessRole: d.accessRole })),
        selectedDashboardId: selected,
      },
    },
  });
}

describe("panelReadScopeFor", () => {
  it.each([
    ["owner", "output"],
    ["editor", "panel"],
    ["viewer", "panel"],
  ] as const)("a %s of the panel's dashboard reads through `%s` scope", (role, kind) => {
    const store = storeWith([{ id: "d", accessRole: role }]);
    expect(panelReadScopeFor(store.getState() as unknown as RootState, "d", "p").kind).toBe(kind);
  });

  it("a dashboard the store does not hold is `panel` scope (fail-closed)", () => {
    const store = storeWith([]);
    const scope = panelReadScopeFor(store.getState() as unknown as RootState, "ghost", "p");
    expect(scope).toEqual({ kind: "panel", dashboardId: "ghost", panelId: "p" });
  });
});

describe("usePanelReadScope", () => {
  function wrap(store: ReturnType<typeof storeWith>) {
    return function Wrapper({ children }: PropsWithChildren) {
      return <Provider store={store}>{children}</Provider>;
    };
  }

  it("follows the panel's own dashboard, not the selected one (shared panel while an owned dashboard is selected)", () => {
    const store = storeWith(
      [
        { id: "own", accessRole: "owner" },
        { id: "shared", accessRole: "viewer" },
      ],
      "own",
    );
    const shared = renderHook(() => usePanelReadScope({ id: "p1", dashboardId: "shared" }), {
      wrapper: wrap(store),
    });
    expect(shared.result.current).toEqual({ kind: "panel", dashboardId: "shared", panelId: "p1" });
    const own = renderHook(() => usePanelReadScope({ id: "p2", dashboardId: "own" }), {
      wrapper: wrap(store),
    });
    expect(own.result.current.kind).toBe("output");
  });

  it("the reverse: an owned panel while a shared dashboard is selected still reads the Output routes", () => {
    const store = storeWith(
      [
        { id: "own", accessRole: "owner" },
        { id: "shared", accessRole: "editor" },
      ],
      "shared",
    );
    const own = renderHook(() => usePanelReadScope({ id: "p2", dashboardId: "own" }), {
      wrapper: wrap(store),
    });
    expect(own.result.current.kind).toBe("output");
  });

  it("returns a stable value across re-renders", () => {
    const store = storeWith([{ id: "shared", accessRole: "viewer" }]);
    const { result, rerender } = renderHook(
      () => usePanelReadScope({ id: "p1", dashboardId: "shared" }),
      { wrapper: wrap(store) },
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
