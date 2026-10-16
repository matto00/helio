// HEL-1576 D8 / task 4.2 + 4.3 -- Tidy layout goes through the REAL `useLayoutSave`:
//  * opening a dashboard whose saved layout has gaps sends no layout write (constraint C1);
//  * a tidy is one history entry that `useLayoutSave` classifies as pending, so exactly ONE PATCH goes
//    out on the next flush (red-first: `pushLayoutSnapshot` + `setDashboardLayoutLocally` alone lands
//    in class 4 -- re-baselined as server truth, never PATCHed);
//  * one undo restores every breakpoint exactly, and that restore is persisted by the same flush.
import { act } from "@testing-library/react";
import { Responsive } from "react-grid-layout";

import { updateDashboardLayout as updateDashboardLayoutRequest } from "../../../dashboards/services/dashboardService";
import { areDashboardLayoutsEqual } from "../../../dashboards/state/dashboardLayout";
import { applyLayoutTidy, applyLayoutUndo } from "../../../layout/state/layoutHistoryThunks";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import type { AppDispatch } from "../../../../store/store";
import { AUTO_SAVE_INTERVAL_MS } from "../../hooks/usePanelUpdatesFlush";
import { PanelGrid } from "./PanelGrid";

// HEL-1600 -- stands in for the output reads this test reaches but does not exercise.
jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputById: jest.fn(() =>
    Promise.reject(new Error("getOutputById: unmocked request stubbed (HEL-1600)")),
  ),
  getAssertionStatus: jest.fn(() =>
    Promise.reject(new Error("getAssertionStatus: unmocked request stubbed (HEL-1600)")),
  ),
}));
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

const WIDTH = 900;
const MockResponsive = jest.mocked(Responsive);
const updateDashboardLayoutMock = jest.mocked(updateDashboardLayoutRequest);

const panels = ["a", "b"].map((id) =>
  makeOutputPanel({ id, dashboardId: "d1", title: id.toUpperCase() }),
);
const item = (panelId: string, x: number, y: number, w: number) => ({ panelId, x, y, w, h: 5 });
// lg and sm are authored with a gap above b; md and xs are unauthored (derived, nothing stored).
const gappy: DashboardLayout = {
  lg: [item("a", 0, 0, 6), item("b", 0, 12, 6)],
  md: [],
  sm: [item("a", 0, 0, 3), item("b", 0, 10, 3)],
  xs: [],
};

function Connected() {
  const layout = useAppSelector((s) => s.dashboards.items[0].layout);
  return <PanelGrid dashboardId="d1" layout={layout} panels={panels} width={WIDTH} />;
}

function setup() {
  const ctx = renderWithStore(<Connected />, {
    dashboards: { items: [{ id: "d1", name: "D", layout: gappy }] },
    panels: { items: panels, status: "succeeded", loadedDashboardId: "d1" },
  });
  const dispatch = ctx.store.dispatch as unknown as AppDispatch;
  const storeLayout = () => ctx.store.getState().dashboards.items[0].layout;
  const flush = async () => {
    await act(async () => {
      jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 100);
    });
  };
  return { ...ctx, dispatch, storeLayout, flush };
}

describe("DesktopPanelGrid -- Tidy layout persistence (HEL-1576)", () => {
  let server: DashboardLayout;
  beforeEach(() => {
    jest.useFakeTimers();
    MockResponsive.mockClear();
    server = gappy;
    updateDashboardLayoutMock.mockReset();
    updateDashboardLayoutMock.mockImplementation(async (_id, patch) => {
      server = { ...server, ...patch };
      return { id: "d1", name: "D", layout: server } as never;
    });
  });
  afterEach(() => jest.useRealTimers());

  it("C1: opening a dashboard with gaps and letting the auto-save tick run sends no layout write", async () => {
    const { flush, storeLayout } = setup();
    await flush();
    await flush();
    expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    expect(storeLayout()).toBe(gappy);
  });

  it("a tidy is pending and sends exactly one PATCH of only the breakpoints that moved", async () => {
    const { dispatch, flush, storeLayout } = setup();
    act(() => {
      expect(dispatch(applyLayoutTidy("d1"))).toBe(true);
    });
    expect(storeLayout().lg).toEqual([item("a", 0, 0, 6), item("b", 0, 5, 6)]);
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    const sent = updateDashboardLayoutMock.mock.calls[0][1];
    expect(Object.keys(sent).sort()).toEqual(["lg", "sm"]);
    expect(sent.lg).toEqual([item("a", 0, 0, 6), item("b", 0, 5, 6)]);
    expect(sent.sm).toEqual([item("a", 0, 0, 3), item("b", 0, 5, 3)]);
    // The unauthored breakpoints are untouched: nothing was written for them.
    expect(storeLayout().md).toEqual([]);
    expect(storeLayout().xs).toEqual([]);
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
  });

  it("one undo restores every breakpoint exactly and persists the restore", async () => {
    const { dispatch, flush, storeLayout } = setup();
    act(() => void dispatch(applyLayoutTidy("d1")));
    await flush();
    act(() => {
      expect(dispatch(applyLayoutUndo("d1"))).toBe(true);
    });
    expect(areDashboardLayoutsEqual(storeLayout(), gappy)).toBe(true);
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(2);
    const restored = updateDashboardLayoutMock.mock.calls[1][1];
    expect(restored.lg).toEqual(gappy.lg);
    expect(restored.sm).toEqual(gappy.sm);
  });

  it("nothing to tidy: the thunk returns false and dispatches nothing", () => {
    const { dispatch, store } = setup();
    act(() => void dispatch(applyLayoutTidy("d1")));
    const before = store.getState();
    expect(dispatch(applyLayoutTidy("d1"))).toBe(false);
    expect(store.getState()).toBe(before);
  });
});
