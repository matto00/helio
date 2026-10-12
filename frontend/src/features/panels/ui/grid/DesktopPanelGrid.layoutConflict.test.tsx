// HEL-1457 (D7c, invariant I1) — a 409 on a layout save is rebased onto the other writer's layout and retried
// once. A drag made while that retry is in flight must never be saved under a version that already includes the
// other writer's panel while lacking it. A fake server enforces the precondition exactly as the real one does.
import { act } from "@testing-library/react";
import { Responsive } from "react-grid-layout";

import { fetchPanels as fetchPanelsRequest } from "../../services/panelService";
import { updateDashboardLayout as updateDashboardLayoutRequest } from "../../../dashboards/services/dashboardService";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
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

const LG_WIDTH = 1600;
const MockResponsive = jest.mocked(Responsive);
const patchMock = jest.mocked(updateDashboardLayoutRequest);
const fetchPanelsMock = jest.mocked(fetchPanelsRequest);

const panel = makeOutputPanel({ id: "panel-1", dashboardId: "d1", title: "Revenue" });
const own = (x: number) => ({ panelId: "panel-1", x, y: 0, w: 4, h: 5 });
const theirs = { panelId: "panel-2", x: 0, y: 5, w: 4, h: 5 };
const everyBreakpoint = (...items: ReturnType<typeof own>[]): DashboardLayout => ({
  lg: items,
  md: items.map((i) => ({ ...i, w: 4 })),
  sm: items.map((i) => ({ ...i, x: 0, w: 3 })),
  xs: items.map((i) => ({ ...i, x: 0, w: 2 })),
});
const rglLg = (x: number) => [{ i: "panel-1", x, y: 0, w: 4, h: 5 }];

function Connected() {
  const dashboard = useAppSelector((s) => s.dashboards.items[0]);
  return (
    <PanelGrid
      dashboardId="d1"
      layout={dashboard.layout}
      layoutVersion={dashboard.layoutVersion}
      panels={[panel]}
      width={LG_WIDTH}
    />
  );
}

type Handlers = {
  onDragStart: () => void;
  onDragStop: () => void;
  onLayoutChange: (current: ReturnType<typeof rglLg> | undefined, all: unknown) => void;
};
const props = () =>
  MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0] as unknown as Handlers;

type Call = { layout: Partial<DashboardLayout>; expected: number | undefined };

function setup(other: typeof theirs = theirs) {
  // The server already holds another writer's panel-2 at version 2; this tab last saw version 1.
  const server = { layout: everyBreakpoint(own(0), other), version: 2 };
  const snapshot = () => ({
    id: "d1",
    name: "D",
    layout: JSON.parse(JSON.stringify(server.layout)) as DashboardLayout,
    layoutVersion: server.version,
  });
  const calls: Call[] = [];
  const gate: { release: (() => void) | null; hold: boolean } = { release: null, hold: false };
  patchMock.mockImplementation(async (_id, layout, expected) => {
    calls.push({ layout, expected });
    if (expected !== undefined && expected !== server.version) {
      throw {
        isAxiosError: true,
        response: { status: 409, data: { message: "stale", dashboard: snapshot() } },
      };
    }
    if (gate.hold) {
      await new Promise<void>((resolve) => (gate.release = resolve));
    }
    server.layout = { ...server.layout, ...layout };
    server.version += 1;
    return snapshot() as never;
  });
  const { store } = renderWithStore(<Connected />, {
    dashboards: {
      items: [{ id: "d1", name: "D", layout: everyBreakpoint(own(0)), layoutVersion: 1 }],
    },
    panels: { items: [panel], status: "succeeded" },
  });
  const dashboard = () => store.getState().dashboards.items[0];
  const drag = (x: number) => {
    act(() => props().onDragStart());
    act(() => {
      props().onDragStop();
      props().onLayoutChange(rglLg(x), undefined);
    });
  };
  const flush = async () => {
    await act(async () => {
      jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 100);
    });
  };
  return { server, calls, gate, dashboard, drag, flush, store };
}

describe("DesktopPanelGrid — layout save 409 (HEL-1457)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockResponsive.mockClear();
    patchMock.mockReset();
    fetchPanelsMock.mockReset();
    fetchPanelsMock.mockResolvedValue([panel]);
  });
  afterEach(() => jest.useRealTimers());

  it("a stale save is rebased onto the other writer's layout and retried, with no error", async () => {
    const { server, calls, dashboard, drag, flush, store } = setup();
    drag(4);
    await flush();
    expect(calls.map((c) => c.expected)).toEqual([1, 2]);
    expect(calls[1].layout.lg?.map((i) => i.panelId)).toEqual(["panel-1", "panel-2"]);
    expect(server.layout.lg).toEqual([own(4), theirs]);
    expect(dashboard().layout.lg).toEqual([own(4), theirs]);
    expect(dashboard().layoutVersion).toBe(3);
    expect(store.getState().dashboards.hasPendingLayout).toBe(false);
    expect(fetchPanelsMock).toHaveBeenCalledWith("d1");
    await flush();
    expect(calls).toHaveLength(2); // nothing left to save
  });

  it("a drag made during the 409 round trip is never saved under a version that includes the other writer's panel without it", async () => {
    const { server, calls, gate, dashboard, drag, flush, store } = setup();
    gate.hold = true;
    drag(4);
    await flush(); // request 0 conflicts, the rebased retry (request 1) is now in flight
    expect(calls.map((c) => c.expected)).toEqual([1, 2]);

    drag(8); // newer local edit while the retry is in flight
    gate.hold = false;
    await act(async () => gate.release?.());
    expect(dashboard().layout.lg[0].x).toBe(8);
    expect(dashboard().layoutVersion).toBe(1); // the store keeps the version its local layout derives from
    expect(store.getState().dashboards.hasPendingLayout).toBe(true);

    await flush();
    const later = calls.slice(2);
    expect(later.map((c) => c.expected)).toEqual([1, 3]); // old version first, so it conflicts and rebases
    expect(later[1].layout.lg).toEqual([own(8), theirs]);
    expect(server.layout.lg).toEqual([own(8), theirs]);
    for (const call of calls) {
      if (call.expected === 3)
        expect(call.layout.lg?.some((i) => i.panelId === "panel-2")).toBe(true);
    }
  });

  describe("when the rebase is invalid and the fresh server layout is shown", () => {
    // panel-2 sits where the dragged panel-1 lands, so the rebased breakpoint overlaps and is not retried.
    const blocker = { panelId: "panel-2", x: 2, y: 0, w: 4, h: 5 };

    it("loads the panels the fresh layout names", async () => {
      const { calls, drag, flush } = setup(blocker);
      drag(4);
      await flush();
      expect(calls).toHaveLength(1); // rejected, never retried
      expect(fetchPanelsMock).toHaveBeenCalledWith("d1");
    });

    it("never drops the item of a panel this tab has not loaded when the next drag rebuilds the breakpoint", async () => {
      const { calls, server, drag, flush } = setup(blocker);
      drag(4);
      await flush();
      drag(8);
      await flush();
      const last = calls[calls.length - 1];
      expect(last.expected).toBe(2);
      expect(last.layout.lg?.map((i) => i.panelId).sort()).toEqual(["panel-1", "panel-2"]);
      expect(server.layout.lg.find((i) => i.panelId === "panel-2")).toEqual(blocker);
    });
  });
});
