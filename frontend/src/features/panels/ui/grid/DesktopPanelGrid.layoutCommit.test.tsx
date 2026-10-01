// HEL-1028 — a drag/resize commits its final layout into the store at stop so the
// `layouts` prop moves with every interaction and undo/redo visibly revert.
// Mirrors real RGL order: onDragStart -> onDragStop -> onLayoutChange (stop BEFORE change).
import { act } from "@testing-library/react";
import { Responsive } from "react-grid-layout";

import { updateDashboardLayout as updateDashboardLayoutRequest } from "../../../dashboards/services/dashboardService";
import { setDashboardLayoutLocally } from "../../../dashboards/state/dashboardsSlice";
import { redoLayout, undoLayout } from "../../../layout/state/layoutHistorySlice";
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

const MockResponsive = jest.mocked(Responsive);
const updateDashboardLayoutMock = jest.mocked(updateDashboardLayoutRequest);

const panel = makeOutputPanel({ id: "panel-1", dashboardId: "d1", title: "Revenue" });
const panels = [panel];

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
  return <PanelGrid dashboardId="d1" layout={layout} panels={panels} width={1280} />;
}

type Handlers = {
  onDragStart: () => void;
  onDragStop: () => void;
  onResizeStart: () => void;
  onResizeStop: () => void;
  onLayoutChange: (current: unknown, all: ReturnType<typeof rglAt>) => void;
  layouts: ReturnType<typeof rglAt>;
};
const props = () =>
  MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0] as unknown as Handlers;

function setup() {
  const ctx = renderWithStore(<Connected />, {
    dashboards: { items: [{ id: "d1", name: "D", layout: layoutAt(0) }] },
    panels: { items: [panel] },
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
      props().onLayoutChange(undefined, rglAt(x));
    });
  };
  const undo = () => {
    const s = store.getState();
    const past = s.layoutHistory.byDashboard.d1.past;
    const current = s.dashboards.items[0].layout;
    dispatchAct(undoLayout({ dashboardId: "d1", currentLayout: current }));
    dispatchAct(setDashboardLayoutLocally({ dashboardId: "d1", layout: past[past.length - 1] }));
  };
  const redo = () => {
    const s = store.getState();
    const target = s.layoutHistory.byDashboard.d1.future[0];
    const current = s.dashboards.items[0].layout;
    dispatchAct(redoLayout({ dashboardId: "d1", currentLayout: current }));
    dispatchAct(setDashboardLayoutLocally({ dashboardId: "d1", layout: target }));
  };
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
    updateDashboardLayoutMock.mockImplementation(async (_id, layout) => ({ layout }) as never);
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
    expect(updateDashboardLayoutMock).toHaveBeenCalledWith("d1", layoutAt(4));
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
    expect(updateDashboardLayoutMock).toHaveBeenCalledWith("d1", layoutAt(4));
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
    act(() => props().onLayoutChange(undefined, rglAt(4)));
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
      props().onLayoutChange(undefined, rglAt(0));
    });
    expect(storeLg()).toBe(0);
  });

  it("the flag does not leak: a layout change after the commit does not write the store", () => {
    const { storeLg, drag } = setup();
    drag(4);
    act(() => props().onLayoutChange(undefined, rglAt(6)));
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

  it("drag then a non-interaction store change before flush: drag stays visible but is re-baselined (documented choice, HEL-1028 task 1.4)", async () => {
    const { store, storeLg, drag, dispatchAct, flush } = setup();
    drag(4);
    // panel create: layout written on top of the dragged store layout
    dispatchAct(
      setDashboardLayoutLocally({
        dashboardId: "d1",
        layout: { ...layoutAt(4), lg: [item(4), { panelId: "other", x: 8, y: 0, w: 4, h: 5 }] },
      }),
    );
    expect(storeLg()).toBe(4); // still visible
    await flush();
    // the create re-baselines exactly like any non-interaction change today: no PATCH
    expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    expect(store.getState().dashboards.hasPendingLayout).toBeFalsy();
  });
});
