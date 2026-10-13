// HEL-1525 — an own panel create/duplicate response carries the dashboard's new layoutVersion. The tab adopts it
// only when it is exactly one past the version its layout derives from (invariant I1), so a create followed by a
// drag saves once with no 409, while a concurrent writer's change in between still produces a 409 and a rebase.
// A fake server enforces the precondition exactly as the real one does.
import { act } from "@testing-library/react";
import { Responsive } from "react-grid-layout";

import {
  createPanel as createPanelRequest,
  duplicatePanel as duplicatePanelRequest,
  fetchPanels as fetchPanelsRequest,
} from "../../services/panelService";
import { updateDashboardLayout as updateDashboardLayoutRequest } from "../../../dashboards/services/dashboardService";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import { AUTO_SAVE_INTERVAL_MS } from "../../hooks/usePanelUpdatesFlush";
import { createPanel, duplicatePanel } from "../../state/panelThunks";
import type { Panel } from "../../types/panel";
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
  duplicatePanel: jest.fn(),
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
const createMock = jest.mocked(createPanelRequest);
const duplicateMock = jest.mocked(duplicatePanelRequest);

const panel = makeOutputPanel({ id: "panel-1", dashboardId: "d1", title: "Revenue" });
const created = makeOutputPanel({ id: "panel-2", dashboardId: "d1", title: "New" });
type Item = { panelId: string; x: number; y: number; w: number; h: number };
const own = (x: number): Item => ({ panelId: "panel-1", x, y: 0, w: 4, h: 5 });
const placed: Item = { panelId: "panel-2", x: 0, y: 5, w: 4, h: 5 };
const writers: Item = { panelId: "panel-3", x: 0, y: 10, w: 4, h: 5 };
const everyBreakpoint = (...items: Item[]): DashboardLayout => ({
  lg: items,
  md: items.map((i) => ({ ...i, w: 4 })),
  sm: items.map((i) => ({ ...i, x: 0, w: 3 })),
  xs: items.map((i) => ({ ...i, x: 0, w: 2 })),
});
const response = (item: Item, layoutVersion: number): Panel => {
  const { panelId: _id, ...box } = item;
  return { ...created, layouts: { lg: box, md: box, sm: box, xs: box }, layoutVersion };
};
const rglLg = (x: number, ...rest: Item[]) => [
  { i: "panel-1", x, y: 0, w: 4, h: 5 },
  ...rest.map((r) => ({ i: r.panelId, x: r.x, y: r.y, w: r.w, h: r.h })),
];

function Connected() {
  const dashboard = useAppSelector((s) => s.dashboards.items[0]);
  return (
    <PanelGrid
      dashboardId="d1"
      layout={dashboard.layout}
      layoutVersion={dashboard.layoutVersion}
      panels={[panel, created]}
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

type Call = { layout: Partial<DashboardLayout>; expected: number | undefined; outcome: number };

/** The tab's baseline is {panel-1} at version 1, and so is the server's until a test advances it. */
function setup() {
  const server = { layout: everyBreakpoint(own(0)), version: 1 };
  const snapshot = () => ({
    id: "d1",
    name: "D",
    layout: JSON.parse(JSON.stringify(server.layout)) as DashboardLayout,
    layoutVersion: server.version,
  });
  const calls: Call[] = [];
  const gate: { release: (() => void) | null; hold: boolean } = { release: null, hold: false };
  patchMock.mockImplementation(async (_id, layout, expected) => {
    const call: Call = { layout, expected, outcome: 0 };
    calls.push(call);
    if (gate.hold) {
      gate.hold = false;
      await new Promise<void>((resolve) => (gate.release = resolve));
    }
    if (expected !== undefined && expected !== server.version) {
      call.outcome = 409;
      throw {
        isAxiosError: true,
        response: { status: 409, data: { message: "stale", dashboard: snapshot() } },
      };
    }
    call.outcome = 200;
    server.layout = { ...server.layout, ...layout };
    server.version += 1;
    return snapshot() as never;
  });
  /** A writer other than this tab appends an item (one layout write, version + 1). */
  const otherWriter = () => {
    server.layout = everyBreakpoint(own(0), writers);
    server.version += 1;
  };
  /** This tab's own create/duplicate: the server appends `placed` and answers with the new version. */
  const serverPlaces = () => {
    server.layout = everyBreakpoint(...server.layout.lg, placed);
    server.version += 1;
    return response(placed, server.version);
  };
  const { store } = renderWithStore(<Connected />, {
    dashboards: {
      items: [{ id: "d1", name: "D", layout: everyBreakpoint(own(0)), layoutVersion: 1 }],
    },
    panels: { items: [panel], status: "succeeded" },
  });
  const dashboard = () => store.getState().dashboards.items[0];
  const drag = (x: number, ...rest: Item[]) => {
    act(() => props().onDragStart());
    act(() => {
      props().onDragStop();
      props().onLayoutChange(rglLg(x, ...rest), undefined);
    });
  };
  const flush = async () => {
    await act(async () => {
      jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 100);
    });
  };
  const run = async (thunk: unknown) => {
    await act(async () => {
      await store.dispatch(thunk as never);
    });
  };
  return { server, calls, gate, dashboard, drag, flush, run, serverPlaces, otherWriter, store };
}

describe("DesktopPanelGrid — placement layoutVersion (HEL-1525)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockResponsive.mockClear();
    patchMock.mockReset();
    createMock.mockReset();
    duplicateMock.mockReset();
    fetchPanelsMock.mockReset();
    fetchPanelsMock.mockResolvedValue([panel, created]);
  });
  afterEach(() => jest.useRealTimers());

  it("create then drag saves once, at the response version, with no 409", async () => {
    const { server, calls, dashboard, drag, flush, run, serverPlaces } = setup();
    createMock.mockResolvedValue(serverPlaces());
    await run(createPanel({ dashboardId: "d1", type: "output", outputId: "output-1" }));
    expect(dashboard().layoutVersion).toBe(2);
    drag(4, placed);
    await flush();
    expect(calls.map((c) => [c.expected, c.outcome])).toEqual([[2, 200]]);
    expect(server.layout.lg).toEqual([own(4), placed]);
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("duplicate then drag saves once, at the response version, with no 409", async () => {
    const { calls, drag, flush, run, serverPlaces } = setup();
    duplicateMock.mockResolvedValue(serverPlaces());
    await run(duplicatePanel({ panelId: "panel-1", dashboardId: "d1" }));
    drag(4, placed);
    await flush();
    expect(calls.map((c) => [c.expected, c.outcome])).toEqual([[2, 200]]);
  });

  it("I1: a concurrent writer racing the create is not adopted, so the next save 409s, rebases and keeps its item", async () => {
    const { server, calls, dashboard, drag, flush, run, serverPlaces, otherWriter } = setup();
    otherWriter(); // version 2, the tab has not seen it
    createMock.mockResolvedValue(serverPlaces()); // response carries version 3
    await run(createPanel({ dashboardId: "d1", type: "output", outputId: "output-1" }));
    expect(dashboard().layoutVersion).toBe(1); // 3 is not 1 + 1: not adopted
    drag(4, placed);
    await flush();
    expect(calls.map((c) => [c.expected, c.outcome])).toEqual([
      [1, 409],
      [3, 200],
    ]);
    expect(server.layout.lg.map((i) => i.panelId).sort()).toEqual([
      "panel-1",
      "panel-2",
      "panel-3",
    ]);
    expect(server.layout.lg.find((i) => i.panelId === "panel-1")?.x).toBe(4);
  });

  it("a create landing while a layout PATCH sent at the previous version is in flight loses no item", async () => {
    const { server, calls, gate, drag, flush, run, serverPlaces } = setup();
    gate.hold = true;
    drag(4);
    await flush(); // PATCH 0 (expects 1) is in flight
    expect(calls).toHaveLength(1);
    createMock.mockResolvedValue(serverPlaces()); // the server handled the create first: version 2
    await run(createPanel({ dashboardId: "d1", type: "output", outputId: "output-1" }));
    await act(async () => gate.release?.());
    await flush();
    // The PATCH sent at 1 conflicts and its rebased retry (at 2) lands; it was computed before the create, so the
    // placement is still unsaved locally and one more flush converges (409 at the older baseline, then 200).
    expect(calls[0]).toMatchObject({ expected: 1, outcome: 409 });
    expect(calls[1]).toMatchObject({ expected: 2, outcome: 200 });
    expect(calls[calls.length - 1].outcome).toBe(200);
    expect(server.layout.lg.map((i) => i.panelId).sort()).toEqual(["panel-1", "panel-2"]);
    expect(server.layout.lg.find((i) => i.panelId === "panel-1")?.x).toBe(4);
  });
});
