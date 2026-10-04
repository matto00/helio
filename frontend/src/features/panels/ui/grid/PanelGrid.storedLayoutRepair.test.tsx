// HEL-1233 — the owner's one-time repair of stored-bad layout breakpoints on open: exactly one
// POST carrying only the bad breakpoints, never an undo entry, never a pending flag, never a PATCH,
// at every width; non-owners and valid layouts never write.
import { act } from "@testing-library/react";
import { Responsive } from "react-grid-layout";

import {
  repairDashboardLayout as repairRequest,
  updateDashboardLayout as updateDashboardLayoutRequest,
} from "../../../dashboards/services/dashboardService";
import { setDashboardLayoutLocally } from "../../../dashboards/state/dashboardsSlice";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import { httpClient } from "../../../../services/httpClient";
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
  repairDashboardLayout: jest.fn(),
}));

const MockResponsive = jest.mocked(Responsive);
const repairMock = jest.mocked(repairRequest);
const updateMock = jest.mocked(updateDashboardLayoutRequest);

const MD_WIDTH = 1300;
const PHONE_WIDTH = 375;
const OWNER = "user-owner";
const panels = ["a", "b"].map((id) =>
  makeOutputPanel({ id, dashboardId: "d1", title: id.toUpperCase() }),
);
const lg = [
  { panelId: "a", x: 0, y: 0, w: 6, h: 5 },
  { panelId: "b", x: 6, y: 0, w: 6, h: 5 },
];
// lg valid; xs stored-bad (both panels in one cell); md/sm merely unauthored (never repaired).
const badLayout: DashboardLayout = {
  lg,
  md: [],
  sm: [],
  xs: [
    { panelId: "a", x: 0, y: 0, w: 2, h: 2 },
    { panelId: "b", x: 0, y: 0, w: 2, h: 2 },
  ],
};
const validLayout: DashboardLayout = { lg, md: [], sm: [], xs: [] };

type Handlers = {
  onDragStart: () => void;
  onDragStop: () => void;
  onLayoutChange: (
    current: { i: string; x: number; y: number; w: number; h: number }[],
    all: unknown,
  ) => void;
  layouts: Record<string, unknown[]>;
};
const rgl = () =>
  MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0] as unknown as Handlers;

function Connected({ width }: { width: number }) {
  const layout = useAppSelector((s) => s.dashboards.items[0].layout);
  return <PanelGrid dashboardId="d1" layout={layout} panels={panels} width={width} />;
}

function setup({
  layout = badLayout,
  ownerId = OWNER,
  currentUserId = OWNER,
  panelsStatus = "succeeded" as "succeeded" | "idle",
  width = MD_WIDTH,
} = {}) {
  const ctx = renderWithStore(<Connected width={width} />, {
    auth: {
      status: "authenticated",
      currentUser: {
        id: currentUserId,
        email: "u@example.com",
        displayName: null,
        avatarUrl: null,
        createdAt: "",
        tier: "free",
      },
    },
    dashboards: { items: [{ id: "d1", name: "D", layout, ownerId }] },
    panels: { items: panels, status: panelsStatus, loadedDashboardId: "d1" },
  });
  const flush = async () => {
    await act(async () => {
      jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 100);
    });
  };
  const storeLayoutNow = () => ctx.store.getState().dashboards.items[0].layout;
  return { ...ctx, flush, storeLayoutNow };
}

describe("owner stored-layout repair on open (HEL-1233)", () => {
  // An authenticated user lets unrelated cards issue requests; keep them off the network.
  const realAdapter = httpClient.defaults.adapter;
  beforeAll(() => {
    httpClient.defaults.adapter = () => Promise.reject(new Error("offline"));
  });
  afterAll(() => {
    httpClient.defaults.adapter = realAdapter;
  });
  beforeEach(() => {
    jest.useFakeTimers();
    MockResponsive.mockClear();
    repairMock.mockReset();
    updateMock.mockReset();
    repairMock.mockImplementation(
      async (_id, patch) => ({ id: "d1", layout: { ...badLayout, ...patch } }) as never,
    );
    updateMock.mockImplementation(
      async (_id, patch) => ({ id: "d1", layout: { ...badLayout, ...patch } }) as never,
    );
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("sends exactly one POST carrying only the stored-bad breakpoint, with no pending, history or PATCH", async () => {
    const { store, flush, storeLayoutNow } = setup();
    const displayedBefore = rgl().layouts.xs;
    await act(async () => {});
    await flush();

    expect(repairMock).toHaveBeenCalledTimes(1);
    const [id, patch] = repairMock.mock.calls[0];
    expect(id).toBe("d1");
    expect(Object.keys(patch)).toEqual(["xs"]);
    expect(storeLayoutNow().xs).toEqual(patch.xs);
    expect(storeLayoutNow().lg).toBe(lg);
    expect(store.getState().dashboards.hasPendingLayout).toBeFalsy();
    expect(store.getState().layoutHistory.byDashboard.d1?.past ?? []).toEqual([]);
    expect(updateMock).not.toHaveBeenCalled();
    expect(rgl().layouts.xs).toEqual(displayedBefore); // stored now equals what was displayed
  });

  it("a drag after the repair persists normally (md, the active breakpoint)", async () => {
    const { flush } = setup();
    await act(async () => {});
    const moved = (
      rgl().layouts.md as { i: string; x: number; y: number; w: number; h: number }[]
    ).map((item) => (item.i === "a" ? { ...item, y: 9 } : item));
    act(() => rgl().onDragStart());
    act(() => {
      rgl().onDragStop();
      rgl().onLayoutChange(moved, undefined);
    });
    await flush();
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(updateMock.mock.calls[0][1])).toEqual(["md"]);
    expect(repairMock).toHaveBeenCalledTimes(1);
  });

  it("reopening the repaired dashboard sends nothing", async () => {
    const { store, unmount } = setup();
    await act(async () => {});
    const repaired = store.getState().dashboards.items[0].layout;
    unmount();
    repairMock.mockClear();
    setup({ layout: repaired });
    await act(async () => {});
    expect(repairMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a stored-valid layout", async () => {
    setup({ layout: validLayout });
    await act(async () => {});
    expect(repairMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a non-owner", async () => {
    setup({ currentUserId: "someone-else" });
    await act(async () => {});
    expect(repairMock).not.toHaveBeenCalled();
  });

  it("sends nothing before the dashboard's panels have loaded", async () => {
    setup({ panelsStatus: "idle" });
    await act(async () => {});
    expect(repairMock).not.toHaveBeenCalled();
  });

  it("keeps a local edit made while the repair is in flight", async () => {
    let resolveRepair: (v: never) => void = () => undefined;
    repairMock.mockImplementation(() => new Promise((r) => (resolveRepair = r as never)));
    const { store, storeLayoutNow } = setup();
    await act(async () => {});
    const local: DashboardLayout = { ...badLayout, lg: [{ ...lg[0], y: 7 }, lg[1]] };
    act(() => void store.dispatch(setDashboardLayoutLocally({ dashboardId: "d1", layout: local })));
    await act(async () => {
      resolveRepair({ id: "d1", layout: { ...badLayout, xs: [] } } as never);
    });
    expect(storeLayoutNow()).toBe(local);
  });

  it("a rejected repair neither toasts, sets an error, retries nor crashes", async () => {
    repairMock.mockRejectedValue(new Error("400 would drop a live panel"));
    const { store, rerender, flush } = setup();
    await act(async () => {});
    // A fresh (still stored-bad) layout object re-runs the hook's effect: it must not retry.
    act(
      () =>
        void store.dispatch(
          setDashboardLayoutLocally({ dashboardId: "d1", layout: { ...badLayout } }),
        ),
    );
    rerender(<Connected width={MD_WIDTH} />);
    await flush();
    expect(repairMock).toHaveBeenCalledTimes(1);
    expect(store.getState().dashboards.error).toBeNull();
    expect(store.getState().toasts.items).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  describe("phone width (HEL-301 hazard §4.1 — the repair POST is the single exception)", () => {
    it("the repair POST is the only layout write: no PATCH, no pending", async () => {
      const { store, flush } = setup({ width: PHONE_WIDTH });
      await act(async () => {});
      await flush();
      expect(MockResponsive).not.toHaveBeenCalled();
      expect(repairMock).toHaveBeenCalledTimes(1);
      expect(Object.keys(repairMock.mock.calls[0][1])).toEqual(["xs"]);
      expect(updateMock).not.toHaveBeenCalled();
      expect(store.getState().dashboards.hasPendingLayout).toBeFalsy();
    });

    it("writes nothing for a non-owner or a stored-valid layout", async () => {
      setup({ width: PHONE_WIDTH, currentUserId: "someone-else" });
      setup({ width: PHONE_WIDTH, layout: validLayout });
      await act(async () => {});
      expect(repairMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });
  });
});
