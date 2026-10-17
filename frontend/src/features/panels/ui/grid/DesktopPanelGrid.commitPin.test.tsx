// HEL-1584 D13 -- pins how many times DesktopPanelGrid commits for its initial mount and for one drag start/stop, so the
// motion pass (keyed entrance data attributes, drag lift CSS) cannot add a render to the grid or to a drag. The values
// are the base values measured on the tree before any HEL-1584 source change.
import { act } from "@testing-library/react";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { Responsive } from "react-grid-layout";

import { makeOutputPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import { PanelGrid } from "./PanelGrid";

jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputById: jest.fn(() => Promise.reject(new Error("getOutputById: stubbed (HEL-1584)"))),
  getAssertionStatus: jest.fn(() =>
    Promise.reject(new Error("getAssertionStatus: stubbed (HEL-1584)")),
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
  fetchPanels: jest.fn().mockImplementation(async () => []),
  createPanel: jest.fn(),
  updatePanelsBatch: jest.fn().mockResolvedValue({ panels: [] }),
}));
jest.mock("../../../dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));
// The grid renders PanelCard, whose own data hooks are not under test.
jest.mock("../PanelCard", () => ({
  PanelCard: ({ panel }: { panel: { id: string } }) =>
    require("react").createElement("div", { "data-testid": `card-${panel.id}` }),
}));

const MockResponsive = jest.mocked(Responsive);
const panels = [0, 1, 2, 3].map((i) =>
  makeOutputPanel({ id: `p${i}`, dashboardId: "d1", title: `Panel ${i}` }),
);
const lg = panels.map((p, i) => ({
  panelId: p.id,
  x: (i % 3) * 4,
  y: Math.floor(i / 3) * 4,
  w: 4,
  h: 4,
}));
const layout = { lg, md: lg, sm: lg, xs: lg };

type Handlers = { onDragStart: () => void; onDragStop: () => void };
const props = () =>
  MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0] as unknown as Handlers;

describe("DesktopPanelGrid commit counts (HEL-1584 D13)", () => {
  beforeEach(() => {
    MockResponsive.mockClear();
  });

  it("commits once for the initial mount and twice for one drag start/stop (the base values)", async () => {
    let commits = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      commits += 1;
    };
    renderWithStore(
      <Profiler id="grid" onRender={onRender}>
        <PanelGrid dashboardId="d1" layout={layout} panels={panels} width={1600} />
      </Profiler>,
      {
        dashboards: { items: [{ id: "d1", name: "D", layout }] },
        panels: { items: panels, status: "succeeded" },
      },
    );
    await act(async () => {});
    const mountCommits = commits;

    commits = 0;
    act(() => props().onDragStart());
    act(() => props().onDragStop());
    const dragCommits = commits;

    expect({ mountCommits, dragCommits }).toEqual({ mountCommits: 1, dragCommits: 2 });
  });
});
