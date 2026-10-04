// HEL-1028 — a drag/resize commits its final layout into the store at stop so the
// `layouts` prop moves with every interaction and undo/redo visibly revert.
// Mirrors real RGL order: onDragStart -> onDragStop -> onLayoutChange (stop BEFORE change).
import { act } from "@testing-library/react";
import { Responsive } from "react-grid-layout";

import { updateDashboardLayout as updateDashboardLayoutRequest } from "../../../dashboards/services/dashboardService";
import { setDashboardLayoutLocally } from "../../../dashboards/state/dashboardsSlice";
import { pushLayoutSnapshot } from "../../../layout/state/layoutHistorySlice";
import { applyLayoutRedo, applyLayoutUndo } from "../../../layout/state/layoutHistoryThunks";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import { AUTO_SAVE_INTERVAL_MS } from "../../hooks/usePanelUpdatesFlush";
import { PanelGrid } from "./PanelGrid";

jest.mock("react-grid-layout", () => {
  const React = require("react");
  return {
    Responsive: jest.fn(({ children }: { children?: import("react").ReactNode }) =>
      React.createElement("div", { "data-testid": "mock-responsive" }, children),
    ),
  };
});
jest.mock("react-grid-layout/core", () => ({
  ...jest.requireActual("react-grid-layout/core"),
  noCompactor: {},
  createScaledStrategy: jest.fn((scale: number) => ({ __scale: scale })),
}));
jest.mock("../../hooks/usePanelData", () => ({
  usePanelData: () => ({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    noData: true,
    refresh: jest.fn(),
  }),
}));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelsBatch: jest.fn().mockResolvedValue({ panels: [] }),
}));
jest.mock("../../../dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

// A container >= 1440 is the `lg` breakpoint, the one these interactions edit (HEL-1023: an edit
// rewrites the active breakpoint only).
const LG_WIDTH = 1600;
const MockResponsive = jest.mocked(Responsive);
const updateDashboardLayoutMock = jest.mocked(updateDashboardLayoutRequest);

const panel = makeOutputPanel({ id: "panel-1", dashboardId: "d1", title: "Revenue" });
const otherPanel = makeOutputPanel({ id: "other", dashboardId: "d1", title: "Created" });
let panels = [panel];

const item = (x: number, w = 4) => ({ panelId: "panel-1", x, y: 0, w, h: 5 });
const layoutAt = (x: number) => ({
  lg: [item(x)],
  md: [item(0)],
  sm: [item(0, 3)],
  xs: [item(0, 2)],
});
const rglAt = (x: number) => ({
  lg: [{ i: "panel-1", x, y: 0, w: 4, h: 5 }],
  md: [{ i: "panel-1", x: 0, y: 0, w: 4, h: 5 }],
  sm: [{ i: "panel-1", x: 0, y: 0, w: 3, h: 5 }],
  xs: [{ i: "panel-1", x: 0, y: 0, w: 2, h: 5 }],
});

function Connected() {
  const layout = useAppSelector((s) => s.dashboards.items[0].layout);
  return <PanelGrid dashboardId="d1" layout={layout} panels={panels} width={LG_WIDTH} />;
}

type Handlers = {
  onDragStart: () => void;
  onDragStop: () => void;
  onResizeStart: () => void;
  onResizeStop: () => void;
  onLayoutChange: (current: ReturnType<typeof rglAt>["lg"] | undefined, all: unknown) => void;
  layouts: ReturnType<typeof rglAt>;
};
const props = () =>
  MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0] as unknown as Handlers;

function setup(withOther = false) {
  panels = withOther ? [panel, otherPanel] : [panel];
  const ctx = renderWithStore(<Connected />, {
    dashboards: { items: [{ id: "d1", name: "D", layout: layoutAt(0) }] },
    panels: { items: panels, status: "succeeded" },
  });
  const store = ctx.store;
  const storeLg = () => store.getState().dashboards.items[0].layout.lg[0].x;
  const dispatchAct = (a: Parameters<typeof store.dispatch>[0]) =>
    act(() => void store.dispatch(a));
  const drag = (x: number, via: "drag" | "resize" = "drag") => {
    act(() => (via === "drag" ? props().onDragStart() : props().onResizeStart()));
    // Real RGL order: stop first, then the layout change carrying the final layout.
    act(() => {
      if (via === "drag") props().onDragStop();
      else props().onResizeStop();
      props().onLayoutChange(rglAt(x).lg, undefined);
    });
  };
  const undo = () => act(() => void store.dispatch(applyLayoutUndo("d1") as never));
  const redo = () => act(() => void store.dispatch(applyLayoutRedo("d1") as never));
  const flush = async () => {
    await act(async () => {
      jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 100);
    });
  };
  return { store, storeLg, drag, undo, redo, flush, dispatchAct };
}

describe("DesktopPanelGrid — interaction commit (HEL-1028)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockResponsive.mockClear();
    updateDashboardLayoutMock.mockReset();
    // The server answers a (partial) PATCH with the full stored layout.
    updateDashboardLayoutMock.mockImplementation(
      async (_id, layout) => ({ layout: { ...layoutAt(0), ...layout } }) as never,
    );
  });
  afterEach(() => jest.useRealTimers());

  it("commits the dragged layout to the store at stop and moves the layouts prop", () => {
    const { storeLg, drag } = setup();
    expect(props().layouts.lg[0].x).toBe(0);
    drag(4);
    expect(storeLg()).toBe(4);
    expect(props().layouts.lg[0].x).toBe(4);
  });

  it("commits a resize the same way", () => {
    const { storeLg, drag } = setup();
    drag(2, "resize");
    expect(storeLg()).toBe(2);
  });

  it("drag then flush sends exactly one PATCH with the dragged layout", async () => {
    const { drag, flush, store } = setup();
    drag(4);
    expect(store.getState().dashboards.hasPendingLayout).toBe(true);
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    expect(updateDashboardLayoutMock).toHaveBeenCalledWith("d1", { lg: layoutAt(4).lg });
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
  });

  it("drag, undo: the store and layouts prop return to the pre-drag layout immediately", () => {
    const { storeLg, drag, undo } = setup();
    drag(4);
    undo();
    expect(storeLg()).toBe(0);
    expect(props().layouts.lg[0].x).toBe(0);
  });

  it("drag, undo, redo: redo reapplies the dropped layout (redo stack holds the displayed layout)", () => {
    const { storeLg, drag, undo, redo, store } = setup();
    drag(4);
    undo();
    expect(store.getState().layoutHistory.byDashboard.d1.future[0].lg[0].x).toBe(4);
    redo();
    expect(storeLg()).toBe(4);
    expect(props().layouts.lg[0].x).toBe(4);
  });

  it("drag, undo, redo, flush sends exactly one PATCH with the dragged layout", async () => {
    const { drag, undo, redo, flush } = setup();
    drag(4);
    undo();
    redo();
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    expect(updateDashboardLayoutMock).toHaveBeenCalledWith("d1", { lg: layoutAt(4).lg });
  });

  it("drag, undo, flush sends nothing and clears the pending flag", async () => {
    const { drag, undo, flush, store } = setup();
    drag(4);
    expect(store.getState().dashboards.hasPendingLayout).toBe(true);
    undo();
    expect(store.getState().dashboards.hasPendingLayout).toBe(false);
    await flush();
    expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    expect(store.getState().dashboards.hasPendingLayout).toBe(false);
  });

  it("a drag that moved nothing (stop with no layout change) does not commit", async () => {
    const { storeLg, flush } = setup();
    act(() => props().onDragStart());
    act(() => props().onDragStop());
    act(() => {
      jest.advanceTimersByTime(1); // zero-delay timer disarms the flag
    });
    // a later, unrelated layout change must not be committed by a leaked flag
    act(() => props().onLayoutChange(rglAt(4).lg, undefined));
    // The live layout is still staged for auto-save exactly as before; only the store write
    // must not leak.
    expect(storeLg()).toBe(0);
    await flush();
  });

  it("a stop that moved nothing but is followed by an equal layout change commits nothing", () => {
    const { storeLg } = setup();
    act(() => props().onDragStart());
    act(() => {
      props().onDragStop();
      props().onLayoutChange(rglAt(0).lg, undefined);
    });
    expect(storeLg()).toBe(0);
  });

  it("the flag does not leak: a layout change after the commit does not write the store", () => {
    const { storeLg, drag } = setup();
    drag(4);
    act(() => props().onLayoutChange(rglAt(6).lg, undefined));
    expect(storeLg()).toBe(4);
  });

  it("a panel-create style store layout change re-baselines: no PATCH, no pending", async () => {
    const { store, dispatchAct, flush } = setup();
    dispatchAct(
      setDashboardLayoutLocally({
        dashboardId: "d1",
        layout: { ...layoutAt(0), lg: [item(0), { panelId: "other", x: 4, y: 0, w: 4, h: 5 }] },
      }),
    );
    await flush();
    expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    expect(store.getState().dashboards.hasPendingLayout).toBeFalsy();
  });

  // HEL-1230 (D4): what a panel create writes — the store layout plus the server's placement in EVERY
  // breakpoint (`createPanel`), never a replacement of the pending edit.
  const placed = (base: ReturnType<typeof layoutAt>, x = 8) => {
    const other = { panelId: "other", x, y: 0, w: 4, h: 5 };
    return {
      lg: [...base.lg, other],
      md: [...base.md, other],
      sm: [...base.sm, other],
      xs: [...base.xs, other],
    };
  };
  const created = (base: ReturnType<typeof layoutAt>, x?: number) =>
    setDashboardLayoutLocally({ dashboardId: "d1", layout: placed(base, x) });

  it("drag then a panel create before flush: the drag stays pending and the flush PATCHes it with the placement", async () => {
    const { store, storeLg, drag, dispatchAct, flush } = setup();
    drag(4);
    dispatchAct(created(layoutAt(4)));
    expect(storeLg()).toBe(4); // still visible
    expect(store.getState().dashboards.hasPendingLayout).toBe(true);
    await flush();
    // exactly one PATCH, and only the breakpoint that differs from the (placement-extended) baseline
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    expect(updateDashboardLayoutMock).toHaveBeenCalledWith("d1", { lg: placed(layoutAt(4)).lg });
  });

  it("resize then a panel create before flush stays pending and is flushed", async () => {
    const { store, drag, dispatchAct, flush } = setup();
    drag(2, "resize");
    dispatchAct(created(layoutAt(2)));
    expect(store.getState().dashboards.hasPendingLayout).toBe(true);
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    expect(updateDashboardLayoutMock).toHaveBeenCalledWith("d1", { lg: placed(layoutAt(2)).lg });
  });

  it("an undo/redo then a panel create stays pending and is flushed", async () => {
    const { store, drag, undo, redo, dispatchAct, flush } = setup();
    drag(4);
    undo();
    redo(); // the redone drag is the pending local edit
    dispatchAct(created(layoutAt(4)));
    expect(store.getState().dashboards.hasPendingLayout).toBe(true);
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    expect(updateDashboardLayoutMock).toHaveBeenCalledWith("d1", { lg: placed(layoutAt(4)).lg });
  });

  it("a panel create with no pending edit sends no PATCH and does not mark pending", async () => {
    const { store, dispatchAct, flush } = setup();
    dispatchAct(created(layoutAt(0)));
    expect(store.getState().dashboards.hasPendingLayout).toBeFalsy();
    await flush();
    expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
  });

  it("drag onto the cell the server then places the new panel in: the flushed PATCH is valid, never overlapping", async () => {
    const { drag, dispatchAct, flush } = setup(true);
    drag(8); // panel-1 now occupies lg x 8..12
    dispatchAct(created(layoutAt(8), 8)); // the server placed "other" at the same cell (its pre-drag view)
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    const sent = updateDashboardLayoutMock.mock.calls[0][1].lg ?? [];
    expect(sent).toHaveLength(2);
    for (const a of sent) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(12);
      for (const b of sent) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it("a no-op undo (target is the reference-identical current layout) cannot capture a later server layout (HEL-1230, D2)", async () => {
    const { store, undo, dispatchAct, flush } = setup();
    // A zero-move drag pushes a snapshot of the very layout object the store holds: the undo's
    // `setDashboardLayoutLocally` then writes the same reference, so the store layout never changes
    // but the history revision is bumped and left stale.
    const current = store.getState().dashboards.items[0].layout;
    dispatchAct(pushLayoutSnapshot({ dashboardId: "d1", layout: current }));
    undo();
    expect(store.getState().dashboards.items[0].layout).toBe(current);
    expect(store.getState().layoutHistory.byDashboard.d1.revision).toBe(1);
    // A server/external layout then lands: it must re-baseline, not be read as the undo's write.
    dispatchAct(setDashboardLayoutLocally({ dashboardId: "d1", layout: layoutAt(8) }));
    await flush();
    expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    expect(store.getState().dashboards.hasPendingLayout).toBeFalsy();
  });
});
