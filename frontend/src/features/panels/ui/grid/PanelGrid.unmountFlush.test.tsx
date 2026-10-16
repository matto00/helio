import { act } from "@testing-library/react";

import { updatePanelsBatch as updatePanelsBatchRequest } from "../../services/panelService";
import { accumulatePanelUpdate } from "../../state/panelsSlice";
import { renderWithStore } from "../../../../test/renderWithStore";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { PanelGrid } from "./PanelGrid";

// HEL-1575 C7 (proceed-round-3) -- red-first behaviour change: pending panel title/appearance edits
// are flushed when the grid UNMOUNTS (a dashboard switch remounts the grid, keyed by dashboard id),
// instead of waiting for the next grid's 30 s auto-save; and a successful batch save clears only the
// pending keys it sent.

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

jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputById: jest.fn().mockRejectedValue(new Error("not under test")),
  getAssertionStatus: jest.fn().mockRejectedValue(new Error("not under test")),
}));

jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));

jest.mock("../../services/panelService", () => ({
  fetchPanels: jest.fn(),
  updatePanelsBatch: jest.fn(),
}));

jest.mock("../../../dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  updateDashboardLayout: jest.fn().mockResolvedValue({}),
}));

const batchMock = jest.mocked(updatePanelsBatchRequest);

const emptyLayout = { lg: [], md: [], sm: [], xs: [] };
const panelA = makeOutputPanel({ id: "panel-a", dashboardId: "d1", title: "A" });
const panelB = makeOutputPanel({ id: "panel-b", dashboardId: "d2", title: "B" });
const appearance = { background: "transparent", color: "inherit", transparency: 0 } as const;

function grid(dashboardId: string, panels: ReturnType<typeof makeOutputPanel>[], width = 1280) {
  return (
    <PanelGrid
      key={dashboardId}
      dashboardId={dashboardId}
      layout={emptyLayout}
      panels={panels}
      width={width}
    />
  );
}

describe("HEL-1575 C7 -- unmount flush of pending panel updates", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    batchMock.mockReset();
    batchMock.mockResolvedValue({ panels: [] });
  });
  afterEach(() => jest.useRealTimers());

  it("flushes staged panel edits immediately when the grid unmounts (no timer advance)", async () => {
    const { store, unmount } = renderWithStore(grid("d1", [panelA]), {
      panels: { items: [panelA] },
    });
    act(() => {
      store.dispatch(accumulatePanelUpdate({ panelId: "panel-a", fields: { title: "Renamed" } }));
    });
    expect(batchMock).not.toHaveBeenCalled();

    await act(async () => {
      unmount();
    });

    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock.mock.calls[0][0].panels).toEqual([{ id: "panel-a", title: "Renamed" }]);
  });

  it("flushes on a dashboard switch (keyed remount) before the next grid's auto-save", async () => {
    const { store, rerender } = renderWithStore(grid("d1", [panelA]), {
      panels: { items: [panelA] },
    });
    act(() => {
      store.dispatch(accumulatePanelUpdate({ panelId: "panel-a", fields: { title: "Renamed" } }));
    });
    await act(async () => {
      rerender(grid("d2", [panelB]));
    });
    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock.mock.calls[0][0].panels).toEqual([{ id: "panel-a", title: "Renamed" }]);
  });

  it("dispatches nothing on unmount when nothing is staged", async () => {
    const { unmount } = renderWithStore(grid("d1", [panelA]), { panels: { items: [panelA] } });
    await act(async () => {
      unmount();
    });
    expect(batchMock).not.toHaveBeenCalled();
  });
});

describe("HEL-1575 task 4.5(5) -- a successful batch save clears only the keys it sent", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    batchMock.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it("keeps an edit staged on another panel during the round trip", async () => {
    let resolveBatch: (v: { panels: never[] }) => void = () => undefined;
    batchMock.mockReturnValue(new Promise((resolve) => (resolveBatch = resolve)));
    const { store } = renderWithStore(grid("d1", [panelA]), { panels: { items: [panelA] } });
    act(() => {
      store.dispatch(accumulatePanelUpdate({ panelId: "panel-a", fields: { title: "Renamed" } }));
    });
    await act(async () => {
      jest.advanceTimersByTime(30_000 + 1);
    });
    expect(batchMock).toHaveBeenCalledTimes(1);

    // The user is already on the next dashboard: an edit is staged on its panel mid-flight.
    act(() => {
      store.dispatch(
        accumulatePanelUpdate({ panelId: "panel-b", fields: { appearance: { ...appearance } } }),
      );
    });
    await act(async () => {
      resolveBatch({ panels: [] });
    });

    const pending = store.getState().panels.pendingPanelUpdates;
    expect(Object.keys(pending)).toEqual(["panel-b"]);
  });

  it("keeps a newer edit staged on the SAME panel during the round trip", async () => {
    let resolveBatch: (v: { panels: never[] }) => void = () => undefined;
    batchMock.mockReturnValue(new Promise((resolve) => (resolveBatch = resolve)));
    const { store } = renderWithStore(grid("d1", [panelA]), { panels: { items: [panelA] } });
    act(() => {
      store.dispatch(accumulatePanelUpdate({ panelId: "panel-a", fields: { title: "One" } }));
    });
    await act(async () => {
      jest.advanceTimersByTime(30_000 + 1);
    });
    act(() => {
      store.dispatch(accumulatePanelUpdate({ panelId: "panel-a", fields: { title: "Two" } }));
    });
    await act(async () => {
      resolveBatch({ panels: [] });
    });
    expect(store.getState().panels.pendingPanelUpdates["panel-a"]).toEqual({ title: "Two" });
  });
});
