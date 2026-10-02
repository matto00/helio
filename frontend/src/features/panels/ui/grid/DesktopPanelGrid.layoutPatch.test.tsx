// HEL-1071 — the client never PATCHes a breakpoint the server would reject: only changed breakpoints
// go on the wire, and a changed-and-invalid one (an undo back to a stored-bad snapshot) is replaced by
// the layout the user actually sees. The save baseline follows what the server stored.
import { act } from "@testing-library/react";
import { Responsive } from "react-grid-layout";

import { updateDashboardLayout as updateDashboardLayoutRequest } from "../../../dashboards/services/dashboardService";
import { isLayoutValid } from "../../../dashboards/state/breakpointLayout";
import { setDashboardLayoutLocally } from "../../../dashboards/state/dashboardsSlice";
import { redoLayout, undoLayout } from "../../../layout/state/layoutHistorySlice";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
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

// A container 900 wide is the `sm` breakpoint (6 columns).
const SM_WIDTH = 900;
const SM_COLS = 6;
const MockResponsive = jest.mocked(Responsive);
const updateDashboardLayoutMock = jest.mocked(updateDashboardLayoutRequest);

const panels = ["a", "b"].map((id) =>
  makeOutputPanel({ id, dashboardId: "d1", title: id.toUpperCase() }),
);
const item = (panelId: string, x: number, y: number) => ({ panelId, x, y, w: 3, h: 5 });
// sm is stored-bad: both panels share a cell (what an agent-built dashboard looked like).
const storedBad: DashboardLayout = {
  lg: [
    { panelId: "a", x: 0, y: 0, w: 6, h: 5 },
    { panelId: "b", x: 6, y: 0, w: 6, h: 5 },
  ],
  md: [],
  sm: [item("a", 0, 0), item("b", 0, 0)],
  xs: [],
};

type RglItem = { i: string; x: number; y: number; w: number; h: number };
type Handlers = {
  onDragStart: () => void;
  onDragStop: () => void;
  onLayoutChange: (current: RglItem[] | undefined, all: unknown) => void;
};
const props = () =>
  MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0] as unknown as Handlers;

function Connected() {
  const layout = useAppSelector((s) => s.dashboards.items[0].layout);
  return <PanelGrid dashboardId="d1" layout={layout} panels={panels} width={SM_WIDTH} />;
}

function setup(panelsStatus: "succeeded" | "idle" = "succeeded") {
  const ctx = renderWithStore(<Connected />, {
    dashboards: { items: [{ id: "d1", name: "D", layout: storedBad }] },
    panels: { items: panels, status: panelsStatus },
  });
  const { store } = ctx;
  const dispatchAct = (a: Parameters<typeof store.dispatch>[0]) =>
    act(() => void store.dispatch(a));
  const storeLayout = () => store.getState().dashboards.items[0].layout;
  const flush = async () => {
    await act(async () => {
      jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 100);
    });
  };
  // The user repairs sm by dragging b out of a's cell.
  const dragBRight = () => {
    act(() => props().onDragStart());
    act(() => {
      props().onDragStop();
      props().onLayoutChange(
        [
          { i: "a", x: 0, y: 0, w: 3, h: 5 },
          { i: "b", x: 3, y: 0, w: 3, h: 5 },
        ],
        undefined,
      );
    });
  };
  const undo = () => {
    const past = store.getState().layoutHistory.byDashboard.d1.past;
    dispatchAct(undoLayout({ dashboardId: "d1", currentLayout: storeLayout() }));
    dispatchAct(setDashboardLayoutLocally({ dashboardId: "d1", layout: past[past.length - 1] }));
  };
  const redo = () => {
    const target = store.getState().layoutHistory.byDashboard.d1.future[0];
    dispatchAct(redoLayout({ dashboardId: "d1", currentLayout: storeLayout() }));
    dispatchAct(setDashboardLayoutLocally({ dashboardId: "d1", layout: target }));
  };
  return { ...ctx, storeLayout, flush, dragBRight, undo, redo };
}

describe("DesktopPanelGrid — layout PATCH never carries an invalid changed breakpoint (HEL-1071)", () => {
  let server: DashboardLayout;
  beforeEach(() => {
    jest.useFakeTimers();
    MockResponsive.mockClear();
    server = storedBad;
    updateDashboardLayoutMock.mockReset();
    // The server merges the (partial) PATCH into what it stored and answers with the full layout.
    updateDashboardLayoutMock.mockImplementation(async (_id, patch) => {
      server = { ...server, ...patch };
      return { id: "d1", name: "D", layout: server } as never;
    });
  });
  afterEach(() => jest.useRealTimers());

  it("repairing the stored-bad breakpoint sends only that breakpoint, valid", async () => {
    const { dragBRight, flush } = setup();
    dragBRight();
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    const sent = updateDashboardLayoutMock.mock.calls[0][1];
    expect(Object.keys(sent)).toEqual(["sm"]);
    expect(sent.sm).toEqual([item("a", 0, 0), item("b", 3, 0)]);
  });

  it("undo to the stored-bad snapshot persists the displayed (resolved) breakpoint, not the bad one", async () => {
    const { dragBRight, undo, flush, storeLayout } = setup();
    dragBRight();
    await flush();

    undo();
    // The authored store layout is the bad snapshot again ...
    expect(storeLayout().sm).toEqual(storedBad.sm);
    await flush();

    // ... but what is persisted is what the user sees: a valid, repaired sm. lg is unchanged, so absent.
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(2);
    const sent = updateDashboardLayoutMock.mock.calls[1][1];
    expect(Object.keys(sent)).toEqual(["sm"]);
    expect(isLayoutValid(sent.sm ?? [], SM_COLS)).toBe(true);
    expect(sent.sm).not.toEqual(storedBad.sm);
    // The store converged on the server's answer (the repaired breakpoint).
    expect(storeLayout().sm).toEqual(sent.sm);
  });

  it("undo-to-bad, save, redo, undo-to-bad again is accepted every time", async () => {
    const { dragBRight, undo, redo, flush } = setup();
    dragBRight();
    await flush();
    undo();
    await flush();
    redo();
    await flush();
    undo();
    await flush();
    const sentBodies = updateDashboardLayoutMock.mock.calls.map((call) => call[1]);
    expect(sentBodies.length).toBeGreaterThanOrEqual(3);
    for (const body of sentBodies) {
      expect(isLayoutValid(body.sm ?? [], SM_COLS)).toBe(true);
    }
  });

  it("does not substitute from an empty panel list: panels not loaded sends the breakpoint as authored", async () => {
    const { dragBRight, undo, flush } = setup("idle");
    dragBRight();
    await flush();
    undo();
    await flush();
    // Nothing wiped: the unloaded case never fabricates an (empty) resolved breakpoint.
    const sent =
      updateDashboardLayoutMock.mock.calls[updateDashboardLayoutMock.mock.calls.length - 1][1];
    expect(sent.sm).toEqual(storedBad.sm);
  });
});
