// HEL-1786: on a dashboard the caller does not own, the desktop meta row's refresh fact and sources and the phone "refreshed"
// caption come from the dashboard panel-status route; no Output or pipeline service is called to produce them.
import { act, screen } from "@testing-library/react";

import { fetchOutputMeta } from "../../features/panels/state/outputMetaCache";
import { fetchPanels } from "../../features/panels/state/panelThunks";
import { fetchDashboardPanelStatus } from "../../features/panels/services/panelStatusService";
import { resetPanelStatusStoreForTests } from "../../features/panels/state/panelStatusStore";
import { getPipelineById } from "../../features/pipelines/services/pipelineService";
import { setDesktopGridDashboardId } from "../../features/layout/state/layoutHistorySlice";
import { resetUseNowForTests } from "../../hooks/useNow";
import { makeOutputPanel } from "../../test/panelFixtures";
import { renderWithStore } from "../../test/renderWithStore";
import { DashboardMetaRow } from "./DashboardMetaRow";
import { DashboardRefreshLine } from "./DashboardRefreshLine";

jest.mock("../../features/panels/services/panelStatusService");
jest.mock("../../features/pipelines/services/pipelineService", () => ({
  ...jest.requireActual("../../features/pipelines/services/pipelineService"),
  getPipelineById: jest.fn(),
}));
jest.mock("../../features/panels/state/outputMetaCache", () => ({
  ...jest.requireActual("../../features/panels/state/outputMetaCache"),
  fetchOutputMeta: jest.fn(),
}));
jest.mock("./useMetaRowTier", () => ({
  ...jest.requireActual("./useMetaRowTier"),
  useMetaRowTier: jest.fn(() => 0),
}));

const statusMock = jest.mocked(fetchDashboardPanelStatus);
const nineHoursAgo = () => new Date(Date.now() - 9 * 3600_000).toISOString();
const panels = [makeOutputPanel({ id: "p1", dashboardId: "d1", config: { outputId: "o1" } })];

beforeEach(() => {
  jest.clearAllMocks();
  resetUseNowForTests();
  resetPanelStatusStoreForTests();
  statusMock.mockResolvedValue({
    items: [
      {
        panelId: "p1",
        lastRunAt: nineHoursAgo(),
        runStatus: "succeeded",
        dataUpdatedAt: nineHoursAgo(),
        invalid: false,
      },
    ],
    sources: ["Sales CSV"],
  });
});

function setup(ui: React.ReactElement, accessRole: "viewer" | "editor") {
  const ctx = renderWithStore(
    ui,
    {
      auth: { status: "authenticated", currentUser: { id: "me" } as never },
      dashboards: {
        items: [{ id: "d1", name: "Board", accessRole, ownerId: "other" }],
        selectedDashboardId: "d1",
      },
    },
    "/dashboards",
  );
  act(() => {
    ctx.store.dispatch(fetchPanels.pending("r", "d1"));
    ctx.store.dispatch(fetchPanels.fulfilled(panels, "r", "d1"));
    ctx.store.dispatch(setDesktopGridDashboardId("d1"));
  });
  return ctx;
}

describe.each(["viewer", "editor"] as const)("a %s's freshness line", (role) => {
  it("the desktop meta row shows the refresh fact and the source from the status route", async () => {
    setup(
      <DashboardMetaRow
        onOpenAsk={jest.fn()}
        onOpenRefinement={jest.fn()}
        onOpenQuickLauncher={jest.fn()}
        setDraftAppearance={jest.fn()}
      />,
      role,
    );
    expect(await screen.findByText(/^refreshed 9 hours ago$/)).toBeInTheDocument();
    expect(screen.getByText(/Sales CSV/)).toBeInTheDocument();
    expect(statusMock).toHaveBeenCalledWith("d1");
    expect(getPipelineById).not.toHaveBeenCalled();
    expect(fetchOutputMeta).not.toHaveBeenCalled();
  });

  it("the phone caption shows 'refreshed <ago>' from the status route", async () => {
    setup(<DashboardRefreshLine />, role);
    expect(await screen.findByText(/^refreshed 9 hours ago$/)).toBeInTheDocument();
    expect(getPipelineById).not.toHaveBeenCalled();
    expect(fetchOutputMeta).not.toHaveBeenCalled();
  });

  it("the phone caption reserves its slot before the status arrives", () => {
    statusMock.mockReturnValue(new Promise(() => {}));
    const { container } = setup(<DashboardRefreshLine />, role);
    expect(container.querySelector(".dashboard-refresh-line[data-reserved]")).not.toBeNull();
  });
});
