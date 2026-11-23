// HEL-1618 (design D3/D4) — a form panel cannot be placed or resized below 5 rows on the desktop grid (a compact counter
// keeps 4); a SAVED sub-5 form is never bumped on load, and when a resize ends below 5 rows it lifts to 5 only if the
// space directly below it (in the FULL stored breakpoint, kept items included) is free. Mirrors real RGL order:
// onResizeStart -> onResizeStop(layout, oldItem, newItem) -> onLayoutChange.
// Tests that already pass on the unchanged grid (the blocked/kept/counter/non-committing/stale-ref cases) are GUARDS,
// each failable by a named mutation recorded in measurements.md (lift without the free check, no lift, ...).
import { act } from "@testing-library/react";
import { Responsive } from "react-grid-layout";

import { updateDashboardLayout as updateDashboardLayoutRequest } from "../../../dashboards/services/dashboardService";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import { makeFormPanel, makeOutputPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import { AUTO_SAVE_INTERVAL_MS } from "../../hooks/usePanelUpdatesFlush";
import { PanelGrid } from "./PanelGrid";
import type { DashboardLayoutItem } from "../../../dashboards/types/dashboard";
import type { Panel } from "../../types/panel";

jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputById: jest.fn(() => Promise.reject(new Error("unmocked"))),
  getAssertionStatus: jest.fn(() => Promise.reject(new Error("unmocked"))),
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
  fetchPanels: jest.fn().mockImplementation(async () => []),
  createPanel: jest.fn(),
  updatePanelsBatch: jest.fn().mockResolvedValue({ panels: [] }),
}));
jest.mock("../../../dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

const LG_WIDTH = 1600;
const MockResponsive = jest.mocked(Responsive);
const updateDashboardLayoutMock = jest.mocked(updateDashboardLayoutRequest);

const fields2 = [
  { sourceField: "note", control: "text" as const, label: "Note" },
  { sourceField: "qty", control: "number" as const, label: "Quantity" },
];
const formPanel = makeFormPanel({
  id: "form",
  dashboardId: "d1",
  title: "Form",
  config: { fields: fields2 },
});
const counterPanel = makeFormPanel({
  id: "counter",
  dashboardId: "d1",
  title: "Counter",
  config: { fields: [{ sourceField: "delta", control: "counter" as const, label: "Widgets" }] },
});
const emptyForm = makeFormPanel({ id: "empty", dashboardId: "d1", title: "Empty" });
const below = makeOutputPanel({ id: "below", dashboardId: "d1", title: "Below" });
const other = makeOutputPanel({ id: "other", dashboardId: "d1", title: "Other" });

const it_ = (panelId: string, x: number, y: number, w: number, h: number): DashboardLayoutItem => ({
  panelId,
  x,
  y,
  w,
  h,
});
const rgl = (items: DashboardLayoutItem[]) =>
  items.map((i) => ({ i: i.panelId, x: i.x, y: i.y, w: i.w, h: i.h }));
const sameEverywhere = (items: DashboardLayoutItem[]) => ({
  lg: items,
  md: items,
  sm: items,
  xs: items.map((i) => ({ ...i, x: 0, w: Math.min(i.w, 2) })),
});

let storedBase = sameEverywhere([]);

type Handlers = {
  onDragStart: () => void;
  onDragStop: () => void;
  onResizeStart: () => void;
  onResizeStop: (layout: unknown, oldItem: unknown, newItem: { i: string }) => void;
  onLayoutChange: (current: ReturnType<typeof rgl> | undefined, all: unknown) => void;
  layouts: Record<string, { i: string; h: number; minH: number }[]>;
};
const props = () =>
  MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0] as unknown as Handlers;

function setup(items: DashboardLayoutItem[], panels: Panel[]) {
  storedBase = sameEverywhere(items);
  function Connected() {
    const layout = useAppSelector((s) => s.dashboards.items[0].layout);
    return <PanelGrid dashboardId="d1" layout={layout} panels={panels} width={LG_WIDTH} />;
  }
  const { store } = renderWithStore(<Connected />, {
    dashboards: { items: [{ id: "d1", name: "D", layout: sameEverywhere(items) }] },
    panels: { items: panels, status: "succeeded" },
  });
  const storeLg = (): DashboardLayoutItem[] => store.getState().dashboards.items[0].layout.lg;
  const flush = async () => {
    await act(async () => {
      jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 100);
    });
  };
  // Real RGL order: stop first (carrying the resized item), then the layout change with the final layout.
  const resize = (id: string, finalItems: DashboardLayoutItem[]) => {
    act(() => props().onResizeStart());
    act(() => {
      props().onResizeStop(rgl(finalItems), undefined, { i: id });
      props().onLayoutChange(rgl(finalItems), undefined);
    });
  };
  const drag = (finalItems: DashboardLayoutItem[]) => {
    act(() => props().onDragStart());
    act(() => {
      props().onDragStop();
      props().onLayoutChange(rgl(finalItems), undefined);
    });
  };
  const h = (id: string) => storeLg().find((i) => i.panelId === id)?.h;
  return { store, storeLg, flush, resize, drag, h };
}

describe("DesktopPanelGrid — form minimum rows (HEL-1618)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockResponsive.mockClear();
    updateDashboardLayoutMock.mockReset();
    // The server answers a (partial) PATCH with the full stored layout.
    updateDashboardLayoutMock.mockImplementation(
      async (_id, layout) => ({ layout: { ...storedBase, ...layout } }) as never,
    );
  });
  afterEach(() => jest.useRealTimers());

  // GUARD (failable by mutation: `createLayouts` bumping a form's h to FORM_MIN_ROWS): a saved 4-row form is not bumped
  // on load and loading it does not mark the layout pending.
  it("GUARD: a saved 4-row form renders at 4 and loading it saves nothing", async () => {
    const { store, flush } = setup([it_("form", 0, 0, 3, 4)], [formPanel]);
    expect(props().layouts.lg[0]).toMatchObject({ i: "form", h: 4, minH: 4 });
    expect(store.getState().dashboards.hasPendingLayout).toBeFalsy();
    await flush();
    expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
  });

  it("gives a multi-field form at 5+ rows a strict minH of 5 at every breakpoint", () => {
    setup([it_("form", 0, 0, 3, 5)], [formPanel]);
    for (const bp of ["lg", "md", "sm", "xs"]) {
      expect(props().layouts[bp][0]).toMatchObject({ i: "form", minH: 5 });
    }
  });

  it("keeps minH 4 for a compact counter, a non-form panel and a saved form below 5 rows", () => {
    setup(
      [it_("counter", 0, 0, 3, 5), it_("below", 3, 0, 3, 5), it_("form", 0, 5, 3, 3)],
      [counterPanel, below, formPanel],
    );
    const byId = Object.fromEntries(props().layouts.lg.map((l) => [l.i, l.minH]));
    expect(byId).toEqual({ counter: 4, below: 4, form: 4 });
  });

  it("treats a form with no fields like a multi-field form (minH 5), as the packer does", () => {
    setup([it_("empty", 0, 0, 3, 5)], [emptyForm]);
    expect(props().layouts.lg[0].minH).toBe(5);
  });

  it("lifts a saved 4-row form to 5 when a width resize ends with free space below, as ONE persisted write", async () => {
    const { store, storeLg, flush, resize, h } = setup([it_("form", 0, 0, 3, 4)], [formPanel]);
    resize("form", [it_("form", 0, 0, 4, 4)]);
    expect(storeLg()).toEqual([it_("form", 0, 0, 4, 5)]);
    expect(props().layouts.lg[0].h).toBe(5);
    expect(store.getState().dashboards.hasPendingLayout).toBe(true);
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    expect(updateDashboardLayoutMock.mock.calls[0][1].lg).toEqual([it_("form", 0, 0, 4, 5)]);
    await flush();
    expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    expect(h("form")).toBe(5);
    expect(props().layouts.lg[0].h).toBe(5);
  });

  it("keeps a saved 4-row form at 4 when a panel sits directly below; the neighbour does not move", async () => {
    const { storeLg, flush, resize } = setup(
      [it_("form", 0, 0, 3, 4), it_("below", 0, 4, 3, 5)],
      [formPanel, below],
    );
    resize("form", [it_("form", 0, 0, 4, 4), it_("below", 0, 4, 3, 5)]);
    expect(storeLg()).toEqual([it_("form", 0, 0, 4, 4), it_("below", 0, 4, 3, 5)]);
    await flush();
    expect(updateDashboardLayoutMock.mock.calls[0][1].lg).toEqual([
      it_("form", 0, 0, 4, 4),
      it_("below", 0, 4, 3, 5),
    ]);
  });

  it("keeps a saved 4-row form at 4 when a KEPT (unloaded) panel's item sits directly below", () => {
    const { storeLg, resize } = setup(
      [it_("form", 0, 0, 3, 4), it_("ghost", 0, 4, 3, 5)],
      [formPanel],
    );
    resize("form", [it_("form", 0, 0, 4, 4)]);
    expect(storeLg()).toEqual([it_("form", 0, 0, 4, 4), it_("ghost", 0, 4, 3, 5)]);
  });

  it("does not lift a compact counter that ends at 4 rows", () => {
    const { h, resize } = setup([it_("counter", 0, 0, 3, 5)], [counterPanel]);
    resize("counter", [it_("counter", 0, 0, 3, 4)]);
    expect(h("counter")).toBe(4);
  });

  it("does not lift on a non-committing layout tick (no resize stop)", async () => {
    const { h, flush } = setup([it_("form", 0, 0, 3, 4)], [formPanel]);
    act(() => props().onResizeStart());
    act(() => props().onLayoutChange(rgl([it_("form", 0, 0, 4, 4)]), undefined));
    expect(h("form")).toBe(4);
    await flush();
    expect(updateDashboardLayoutMock.mock.calls[0][1].lg).toEqual([it_("form", 0, 0, 4, 4)]);
  });

  it("a resize that ends where it started, then a drag of another panel, does not lift the form", () => {
    const { storeLg, drag } = setup(
      [it_("form", 0, 0, 3, 4), it_("other", 3, 0, 3, 5)],
      [formPanel, other],
    );
    // The resize moved nothing: RGL fires no onLayoutChange, so only the stop handler runs.
    act(() => props().onResizeStart());
    act(() => props().onResizeStop(undefined, undefined, { i: "form" }));
    act(() => {
      jest.advanceTimersByTime(1); // the zero-delay timer disarms the commit flag
    });
    drag([it_("form", 0, 0, 3, 4), it_("other", 3, 1, 3, 5)]);
    expect(storeLg()).toEqual([it_("form", 0, 0, 3, 4), it_("other", 3, 1, 3, 5)]);
  });
});
