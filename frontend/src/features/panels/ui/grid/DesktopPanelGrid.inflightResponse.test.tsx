// HEL-1230 (D5) — a layout PATCH response must never overwrite a newer local layout, and the newer
// layout stays pending and is persisted by the next flush. Uses a deferred PATCH so the user can edit
// while the request is "in flight".
import { act } from "@testing-library/react";
import { Responsive } from "react-grid-layout";

import { updateDashboardLayout as updateDashboardLayoutRequest } from "../../../dashboards/services/dashboardService";
import { setDashboardLayoutLocally } from "../../../dashboards/state/dashboardsSlice";
import { applyLayoutUndo } from "../../../layout/state/layoutHistoryThunks";
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

const panel = makeOutputPanel({ id: "panel-1", dashboardId: "d1", title: "Revenue" });
const item = (x: number, w = 4) => ({ panelId: "panel-1", x, y: 0, w, h: 5 });
const layoutAt = (x: number) => ({
  lg: [item(x)],
  md: [item(0)],
  sm: [item(0, 3)],
  xs: [item(0, 2)],
});
const rglLg = (x: number) => [{ i: "panel-1", x, y: 0, w: 4, h: 5 }];

function Connected() {
  const layout = useAppSelector((s) => s.dashboards.items[0].layout);
  return <PanelGrid dashboardId="d1" layout={layout} panels={[panel]} width={LG_WIDTH} />;
}

type Handlers = {
  onDragStart: () => void;
  onDragStop: () => void;
  onLayoutChange: (current: ReturnType<typeof rglLg> | undefined, all: unknown) => void;
  layouts: { lg: ReturnType<typeof rglLg> };
};
const props = () =>
  MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0] as unknown as Handlers;

type Deferred = { resolve: (layout: ReturnType<typeof layoutAt>) => void };

function setup() {
  const pending: Deferred[] = [];
  patchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        pending.push({ resolve: (layout) => resolve({ layout } as never) });
      }),
  );
  const { store } = renderWithStore(<Connected />, {
    dashboards: { items: [{ id: "d1", name: "D", layout: layoutAt(0) }] },
    panels: { items: [panel], status: "succeeded" },
  });
  const storeLg = () => store.getState().dashboards.items[0].layout.lg;
  const isPending = () => store.getState().dashboards.hasPendingLayout;
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
  const respond = async (index: number, layout: ReturnType<typeof layoutAt>) => {
    await act(async () => {
      pending[index].resolve(layout);
    });
  };
  return { store, storeLg, isPending, drag, flush, respond, pending };
}

describe("DesktopPanelGrid — in-flight layout PATCH response (HEL-1230)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockResponsive.mockClear();
    patchMock.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it("control: no edit while in flight adopts the response and clears pending", async () => {
    const { storeLg, isPending, drag, flush, respond } = setup();
    drag(4);
    await flush();
    await respond(0, layoutAt(4));
    expect(storeLg()[0].x).toBe(4);
    expect(isPending()).toBe(false);
    await flush();
    expect(patchMock).toHaveBeenCalledTimes(1);
  });

  it("a drag made while the PATCH is in flight survives the response and is flushed next", async () => {
    const { storeLg, isPending, drag, flush, respond } = setup();
    drag(4);
    await flush();
    expect(patchMock).toHaveBeenCalledTimes(1);
    drag(8); // newer local layout while the first PATCH is in flight
    await respond(0, layoutAt(4)); // the server acknowledges only the first position
    expect(storeLg()[0].x).toBe(8);
    expect(props().layouts.lg[0].x).toBe(8);
    expect(isPending()).toBe(true);
    await flush();
    expect(patchMock).toHaveBeenCalledTimes(2);
    expect(patchMock).toHaveBeenLastCalledWith("d1", { lg: [item(8)] });
    await respond(1, layoutAt(8));
    expect(storeLg()[0].x).toBe(8);
    expect(isPending()).toBe(false);
  });

  it("an undo made while the PATCH is in flight survives the response and is flushed next", async () => {
    const { store, storeLg, isPending, drag, flush, respond } = setup();
    drag(4);
    await flush();
    act(() => void store.dispatch(applyLayoutUndo("d1") as never)); // back to x=0 locally
    expect(storeLg()[0].x).toBe(0);
    await respond(0, layoutAt(4));
    expect(storeLg()[0].x).toBe(0); // the response did not drag the grid back to x=4
    expect(isPending()).toBe(true); // x=0 differs from the server's x=4 and must be saved
    await flush();
    expect(patchMock).toHaveBeenCalledTimes(2);
    expect(patchMock).toHaveBeenLastCalledWith("d1", { lg: [item(0)] });
  });

  it("a newer local layout that already equals the response's layout clears pending and does not block the next edit", async () => {
    const { storeLg, isPending, drag, flush, respond } = setup();
    drag(4);
    await flush();
    // The local layout moves on and then lands on what the server will answer with (a different
    // object, so the response is not "adopted" but is equal to the new baseline).
    drag(8);
    await respond(0, layoutAt(8));
    expect(storeLg()[0].x).toBe(8);
    expect(isPending()).toBe(false);
    await flush();
    expect(patchMock).toHaveBeenCalledTimes(1); // nothing left to send
    drag(2);
    expect(isPending()).toBe(true); // a later edit marks pending again
  });

  // Skeptic design-2 note 1: the narrow, accepted race. A panel create lands while a PATCH is in
  // flight and the server handled that PATCH BEFORE the create, so the response baseline lacks the
  // placement. The pure create is then marked pending and the next flush sends one redundant,
  // idempotent PATCH. This pins that chosen behaviour (comment in useLayoutSave.ts header).
  it("a panel create landing during an in-flight PATCH is marked pending when the response lacks the placement (accepted race)", async () => {
    const { store, isPending, drag, flush, respond } = setup();
    drag(4);
    await flush();
    const other = { panelId: "other", x: 8, y: 0, w: 4, h: 5 };
    act(
      () =>
        void store.dispatch(
          setDashboardLayoutLocally({
            dashboardId: "d1",
            layout: {
              lg: [item(4), other],
              md: [item(0), other],
              sm: [item(0, 3), other],
              xs: [item(0, 2), other],
            },
          }),
        ),
    );
    await respond(0, layoutAt(4)); // server layout predates the create
    expect(isPending()).toBe(true);
    await flush();
    expect(patchMock).toHaveBeenCalledTimes(2);
  });
});
