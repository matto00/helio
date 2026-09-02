// HEL-651: `DesktopPanelGrid` rendered the panel detail modal with a
// non-null-asserted lookup (`panels.find((p) => p.id === detailPanelId)!`).
// When the panel backing an open modal disappears from `panels` (deleted via
// any surface, by any actor, or the parent dashboard being removed), `.find()`
// genuinely returns `undefined`, the `!` lies to TypeScript, and the modal
// renders with `panel === undefined` — `usePanelData` then crashes on
// `panel.id`, caught only by the top-level `ErrorBoundary`.
//
// This suite is the PRIMARY, gated regression coverage (tasks.md 3.1/3.3) —
// unlike the Playwright evidence capture (executor's live-crash probe), this
// runs in `npm test` / CI. `PanelDetailModal` and `PanelCard` are mocked to
// isolate `DesktopPanelGrid`'s own render-guard + auto-close effect (the
// actual fix surface, design.md's Decision), not their internals.

import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";

import { makeOutputPanel } from "../../../../test/panelFixtures";
import { ThemeProvider } from "../../../../theme/ThemeProvider";
import { panelsReducer } from "../../state/panelsSlice";
import { DesktopPanelGrid } from "./DesktopPanelGrid";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import type { Panel } from "../../types/panel";

jest.mock("react-grid-layout", () => {
  const React = require("react");
  return {
    Responsive: jest.fn(({ children }: { children?: import("react").ReactNode }) =>
      React.createElement("div", { "data-testid": "mock-responsive" }, children),
    ),
  };
});

jest.mock("../detailModal/PanelDetailModal", () => ({
  PanelDetailModal: ({ panel, onClose }: { panel: Panel; onClose: () => void }) =>
    require("react").createElement(
      "div",
      { "data-testid": "mock-panel-detail-modal", "data-panel-id": panel.id },
      require("react").createElement("button", { onClick: onClose }, "close"),
    ),
}));

jest.mock("../PanelCard", () => ({
  PanelCard: ({
    panel,
    onCardClick,
  }: {
    panel: Panel;
    onCardClick: (panelId: string, e: unknown) => void;
  }) =>
    require("react").createElement("div", {
      "data-testid": `mock-panel-card-${panel.id}`,
      onClick: (e: unknown) => onCardClick(panel.id, e),
    }),
}));

const emptyLayout: DashboardLayout = { lg: [], md: [], sm: [], xs: [] };

type PanelsStatus = "idle" | "loading" | "succeeded" | "failed";

function makeStore(panels: Panel[], status: PanelsStatus = "succeeded") {
  const seed = panelsReducer(undefined, { type: "@@INIT" });
  const initial = { ...seed, items: panels, status };
  return configureStore({
    reducer: {
      panels: (state = initial, action: UnknownAction) =>
        panelsReducer(state as never, action as never),
    } as never,
  });
}

// A single shared store lets us simulate `panelsStatus` transitions
// (succeeded -> loading -> failed -> succeeded) across re-renders, matching
// how the real `panelsSlice` behaves during a refetch — the store's `status`
// is read directly by `DesktopPanelGrid`'s auto-close effect gate.
function renderWithStore(store: ReturnType<typeof makeStore>, panels: Panel[]) {
  return render(
    <Provider store={store}>
      <ThemeProvider>
        <DesktopPanelGrid
          dashboardId="dash-1"
          layout={emptyLayout}
          panels={panels}
          zoomLevel={1}
          width={1200}
          registerLayoutFlush={() => {}}
        />
      </ThemeProvider>
    </Provider>,
  );
}

describe("DesktopPanelGrid — detail-modal crash guard (HEL-651)", () => {
  it("does not crash and unmounts the modal when its backing panel is removed while open (panelsStatus: succeeded)", () => {
    const panel = makeOutputPanel({ id: "p1" });
    const store = makeStore([panel], "succeeded");
    const { rerender } = renderWithStore(store, [panel]);

    fireEvent.click(screen.getByTestId("mock-panel-card-p1"));
    expect(screen.getByTestId("mock-panel-detail-modal")).toHaveAttribute("data-panel-id", "p1");

    expect(() => {
      rerender(
        <Provider store={store}>
          <ThemeProvider>
            <DesktopPanelGrid
              dashboardId="dash-1"
              layout={emptyLayout}
              panels={[]}
              zoomLevel={1}
              width={1200}
              registerLayoutFlush={() => {}}
            />
          </ThemeProvider>
        </Provider>,
      );
    }).not.toThrow();

    expect(screen.queryByTestId("mock-panel-detail-modal")).not.toBeInTheDocument();
  });

  it("simulates a cross-actor removal (panel absent from panels on first render, panelsStatus: succeeded) without crashing", () => {
    // Covers the "another actor deleted it" / "parent dashboard deleted"
    // cases generically (design.md: no literal cross-tab script is
    // reachable — this simulates the *result* of any external removal).
    const panel = makeOutputPanel({ id: "p1" });
    const store = makeStore([panel], "succeeded");
    const { rerender } = renderWithStore(store, [panel]);
    fireEvent.click(screen.getByTestId("mock-panel-card-p1"));
    expect(screen.getByTestId("mock-panel-detail-modal")).toBeInTheDocument();

    // Cross-actor removal: `panels` no longer contains p1, status remains
    // "succeeded" (a confirmed, known-loaded list without the panel).
    expect(() => {
      rerender(
        <Provider store={store}>
          <ThemeProvider>
            <DesktopPanelGrid
              dashboardId="dash-1"
              layout={emptyLayout}
              panels={[]}
              zoomLevel={1}
              width={1200}
              registerLayoutFlush={() => {}}
            />
          </ThemeProvider>
        </Provider>,
      );
    }).not.toThrow();
    expect(screen.queryByTestId("mock-panel-detail-modal")).not.toBeInTheDocument();
  });

  it("does not crash during a transient loading/failed window, and reopens once the panel is confirmed present again", () => {
    const panel = makeOutputPanel({ id: "p1" });
    const store = makeStore([panel], "succeeded");

    const wrap = (panels: Panel[]) => (
      <Provider store={store}>
        <ThemeProvider>
          <DesktopPanelGrid
            dashboardId="dash-1"
            layout={emptyLayout}
            panels={panels}
            zoomLevel={1}
            width={1200}
            registerLayoutFlush={() => {}}
          />
        </ThemeProvider>
      </Provider>
    );

    const { rerender } = render(wrap([panel]));
    fireEvent.click(screen.getByTestId("mock-panel-card-p1"));
    expect(screen.getByTestId("mock-panel-detail-modal")).toBeInTheDocument();

    // Transient refetch: panelsSlice.status -> "loading", items emptied by
    // the in-flight fetch's optimistic/pending state in some flows, or just
    // the panel momentarily absent from a stale `panels` prop.
    act(() => {
      store.dispatch({
        type: "panels/fetchPanels/pending",
        meta: { arg: "dash-1" },
      } as unknown as UnknownAction);
    });
    expect(() => rerender(wrap([]))).not.toThrow();

    // Transient refetch failure: panelsSlice.status -> "failed", items: [].
    act(() => {
      store.dispatch({
        type: "panels/fetchPanels/rejected",
        meta: { arg: "dash-1" },
      } as unknown as UnknownAction);
    });
    expect(() => rerender(wrap([]))).not.toThrow();

    // Successful reload, panel confirmed still present: the modal reopens
    // for that panel — proof the effect did NOT clear detailPanelId during
    // the transient "loading"/"failed" window above. Dispatch the status
    // flip and the matching `panels` prop update together (as the real app
    // does — `fetchPanels.fulfilled` updates `items`/`status` atomically),
    // so no intermediate render sees "succeeded" + panel-still-absent.
    act(() => {
      store.dispatch({
        type: "panels/fetchPanels/fulfilled",
        payload: [panel],
        meta: { arg: "dash-1" },
      } as unknown as UnknownAction);
      rerender(wrap([panel]));
    });
    expect(screen.getByTestId("mock-panel-detail-modal")).toHaveAttribute("data-panel-id", "p1");
  });
});
