// HEL-1023 — a breakpoint layout derived/repaired at render is view-only: it never arms pending,
// never enters undo history, never PATCHes, and an edit persists the edited breakpoint alone.
// Mirrors real RGL: onLayoutChange fires on mount with exactly the layout it was fed.
import { act } from "@testing-library/react";
import { Responsive } from "react-grid-layout";

import { updateDashboardLayout as updateDashboardLayoutRequest } from "../../../dashboards/services/dashboardService";
import { setDashboardLayoutLocally } from "../../../dashboards/state/dashboardsSlice";
import { undoLayout } from "../../../layout/state/layoutHistorySlice";
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

const MockResponsive = jest.mocked(Responsive);
const updateDashboardLayoutMock = jest.mocked(updateDashboardLayoutRequest);

const MD_WIDTH = 1300; // container 1100..1439 is `md`
const panels = ["a", "b"].map((id) =>
  makeOutputPanel({ id, dashboardId: "d1", title: id.toUpperCase() }),
);
const lgItems = [
  { panelId: "a", x: 0, y: 0, w: 6, h: 5 },
  { panelId: "b", x: 6, y: 0, w: 6, h: 5 },
];
// Authored at lg only: md, sm and xs are derived at render.
const storeLayout = { lg: lgItems, md: [], sm: [], xs: [] };

type RglItem = { i: string; x: number; y: number; w: number; h: number };
type Handlers = {
  onDragStart: () => void;
  onDragStop: () => void;
  onLayoutChange: (current: RglItem[] | undefined, all: unknown) => void;
  layouts: Record<string, RglItem[]>;
};
const props = () =>
  MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0] as unknown as Handlers;
/** What RGL hands back on mount: exactly the layout it was fed for the active breakpoint. */
const fed = (bp: string) => props().layouts[bp].map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));

function Connected({ width }: { width: number }) {
  const layout = useAppSelector((s) => s.dashboards.items[0].layout);
  return <PanelGrid dashboardId="d1" layout={layout} panels={panels} width={width} />;
}

function setup(width = MD_WIDTH) {
  const ctx = renderWithStore(<Connected width={width} />, {
    dashboards: { items: [{ id: "d1", name: "D", layout: storeLayout }] },
    panels: { items: panels },
  });
  const flush = async () => {
    await act(async () => {
      jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 100);
    });
  };
  const storeLayoutNow = () => ctx.store.getState().dashboards.items[0].layout;
  return { ...ctx, flush, storeLayoutNow };
}

describe("DesktopPanelGrid — derived layouts are view-only (HEL-1023)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockResponsive.mockClear();
    updateDashboardLayoutMock.mockReset();
    // The server answers a (partial) PATCH with the full stored layout.
    updateDashboardLayoutMock.mockImplementation(
      async (_id, layout) => ({ layout: { ...storeLayout, ...layout } }) as never,
    );
  });
  afterEach(() => jest.useRealTimers());

  it("feeds RGL a derived, non-empty md layout while the store md stays empty", () => {
    const { storeLayoutNow } = setup();
    expect(props().layouts.md).toHaveLength(2);
    expect(storeLayoutNow().md).toEqual([]);
  });

  it("viewing: RGL's mount/breakpoint onLayoutChange arms no pending, no history, no PATCH", async () => {
    const { store, flush, storeLayoutNow, rerender } = setup();
    const before = storeLayoutNow();
    // Resize across lg -> md -> sm; at each, RGL echoes the active breakpoint's fed layout.
    for (const [width, bp] of [
      [1700, "lg"],
      [MD_WIDTH, "md"],
      [900, "sm"],
    ] as const) {
      rerender(<Connected width={width} />);
      act(() => props().onLayoutChange(fed(bp), undefined));
    }
    await flush();
    expect(store.getState().dashboards.hasPendingLayout).toBeFalsy();
    expect(store.getState().layoutHistory.byDashboard.d1?.past ?? []).toEqual([]);
    expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    expect(storeLayoutNow()).toBe(before);
  });

  it("keeps the layouts prop referentially stable across unrelated re-renders", () => {
    const { rerender } = setup();
    const first = props().layouts;
    rerender(<Connected width={MD_WIDTH} />);
    rerender(<Connected width={MD_WIDTH} />);
    expect(props().layouts).toBe(first);
  });

  it("an edit at md PATCHes md only: lg stays as saved and sm/xs stay unwritten", async () => {
    const { store, flush, storeLayoutNow } = setup();
    const moved = fed("md").map((item) => (item.i === "a" ? { ...item, y: 8 } : item));
    act(() => props().onDragStart());
    act(() => {
      props().onDragStop();
      props().onLayoutChange(moved, undefined);
    });
    expect(storeLayoutNow().lg).toBe(storeLayout.lg);
    expect(storeLayoutNow().sm).toEqual([]);
    expect(storeLayoutNow().xs).toEqual([]);
    expect(store.getState().dashboards.hasPendingLayout).toBe(true);
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    // HEL-1071: only the changed breakpoint goes on the wire; the server preserves the others.
    const sent = updateDashboardLayoutMock.mock.calls[0][1];
    expect(Object.keys(sent)).toEqual(["md"]);
    expect(sent.md?.find((item) => item.panelId === "a")).toMatchObject({ y: 8 });
  });

  it("dragging away and back to the original cell sends no PATCH", async () => {
    const { flush, storeLayoutNow } = setup();
    const original = fed("md");
    act(() => props().onDragStart());
    act(() =>
      props().onLayoutChange(
        original.map((item) => (item.i === "a" ? { ...item, y: 9 } : item)),
        undefined,
      ),
    );
    act(() => {
      props().onDragStop();
      props().onLayoutChange(original, undefined);
    });
    await flush();
    expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    expect(storeLayoutNow().md).toEqual([]);
  });

  it("undo after an edit at a derived breakpoint restores the store-shaped (empty) md", () => {
    const { store, storeLayoutNow } = setup();
    const derived = props().layouts.md;
    const moved = fed("md").map((item) => (item.i === "a" ? { ...item, y: 8 } : item));
    act(() => props().onDragStart());
    act(() => {
      props().onDragStop();
      props().onLayoutChange(moved, undefined);
    });
    expect(storeLayoutNow().md).not.toEqual([]);
    const past = store.getState().layoutHistory.byDashboard.d1.past;
    act(
      () => void store.dispatch(undoLayout({ dashboardId: "d1", currentLayout: storeLayoutNow() })),
    );
    act(
      () =>
        void store.dispatch(
          setDashboardLayoutLocally({ dashboardId: "d1", layout: past[past.length - 1] }),
        ),
    );
    expect(storeLayoutNow().md).toEqual([]);
    expect(props().layouts.md).toEqual(derived);
  });
});
