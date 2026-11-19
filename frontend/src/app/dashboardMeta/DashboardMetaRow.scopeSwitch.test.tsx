// HEL-1773 evaluation-2 CR1: an in-app switch from a shared dashboard (whose Output is read through a per-panel route, a stub
// with no pipeline) to a cold OWNED dashboard binding the same Output. `fetchPanels.pending` marks the new dashboard loaded
// while `items` still hold the shared dashboard's panels, so the meta row must not feed those panels to `useDashboardMeta`
// (it would keep the stub in local state and never read the pipeline): once the owned panels arrive, the facts appear.
import { act, screen, waitFor } from "@testing-library/react";

import { getPipelineById } from "../../features/pipelines/services/pipelineService";
import { getOutputById } from "../../features/pipelines/services/outputService";
import { fetchPublicOutputMeta } from "../../features/dashboards/services/publicDashboardService";
import { setSelectedDashboardId } from "../../features/dashboards/state/dashboardsSlice";
import { setDesktopGridDashboardId } from "../../features/layout/state/layoutHistorySlice";
import { resetOutputFreshness, retain } from "../../features/panels/state/outputFreshness";
import {
  fetchOutputMeta,
  scopeOutputToPanel,
  unscopeOutput,
} from "../../features/panels/state/outputMetaCache";
import { fetchPanels } from "../../features/panels/state/panelThunks";
import { fetchDashboardPanelStatus } from "../../features/panels/services/panelStatusService";
import { subscribeToPipelineTerminal } from "../../features/panels/services/pipelineRunFanout";
import { makeOutputPanel } from "../../test/panelFixtures";
import { renderWithStore } from "../../test/renderWithStore";
import { DashboardMetaRow } from "./DashboardMetaRow";

// HEL-1786: a panel on a dashboard the caller does not own polls the dashboard panel-status route; no network in a unit test.
jest.mock("../../features/panels/services/panelStatusService", () => ({
  fetchDashboardPanelStatus: jest.fn(() => new Promise(() => {})),
}));

jest.mock("../../features/pipelines/services/pipelineService");
jest.mock("../../features/pipelines/services/outputService");
jest.mock("../../features/dashboards/services/publicDashboardService");
jest.mock("./useMetaRowTier", () => ({
  ...jest.requireActual("./useMetaRowTier"),
  useMetaRowTier: jest.fn(() => 0),
}));
jest.mock("../../features/panels/services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

const sharedPanel = makeOutputPanel({ id: "pY", dashboardId: "DY", config: { outputId: "O" } });
const ownedPanel = makeOutputPanel({ id: "pA", dashboardId: "DA", config: { outputId: "O" } });

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(fetchDashboardPanelStatus).mockReturnValue(new Promise(() => {}));
  jest.mocked(subscribeToPipelineTerminal).mockReturnValue(jest.fn());
  resetOutputFreshness();
  retain("O");
  jest
    .mocked(fetchPublicOutputMeta)
    .mockResolvedValue({ kind: "table", config: {}, schema: [], ownerId: null });
  jest.mocked(getOutputById).mockResolvedValue({
    id: "O",
    pipelineId: "P",
    ownerId: "me",
    name: "Real",
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
  });
  jest.mocked(getPipelineById).mockResolvedValue({
    id: "P",
    name: "Sales pipeline",
    lastRunStatus: "succeeded",
    lastRunAt: new Date().toISOString(),
    roots: [{ dataSourceName: "orders" }],
  } as never);
});

it("shows the owned dashboard's facts after switching from a shared dashboard bound to the same Output", async () => {
  unscopeOutput("O");
  scopeOutputToPanel("O", "DY", "pY");
  const ctx = renderWithStore(
    <DashboardMetaRow
      onOpenAsk={jest.fn()}
      onOpenRefinement={jest.fn()}
      onOpenQuickLauncher={jest.fn()}
      setDraftAppearance={jest.fn()}
    />,
    {
      auth: { status: "authenticated", currentUser: { id: "me" } as never },
      dashboards: {
        items: [
          { id: "DY", name: "Shared", accessRole: "editor", ownerId: "other" },
          { id: "DA", name: "Mine", accessRole: "owner", ownerId: "me" },
        ],
        selectedDashboardId: "DY",
        status: "succeeded",
      },
    },
    "/dashboards",
  );
  act(() => {
    ctx.store.dispatch(fetchPanels.pending("r1", "DY"));
    ctx.store.dispatch(fetchPanels.fulfilled([sharedPanel], "r1", "DY"));
    ctx.store.dispatch(setDesktopGridDashboardId("DY"));
  });
  // The shared dashboard's cards read the Output through the per-panel route: the cache holds the stub (the meta row itself
  // is gated off for a non-owner, so it asks for nothing yet).
  const stub = await fetchOutputMeta("O");
  expect(stub.pipelineId).toBe("");
  expect(getPipelineById).not.toHaveBeenCalled();

  // The in-app switch: selection moves, the owned dashboard's fetch is pending (items are still DY's), the scope is cleared
  // by `fetchPanels`, then the owned panels arrive.
  act(() => {
    ctx.store.dispatch(setSelectedDashboardId("DA"));
    ctx.store.dispatch(fetchPanels.pending("r2", "DA"));
  });
  act(() => {
    unscopeOutput("O");
    ctx.store.dispatch(fetchPanels.fulfilled([ownedPanel], "r2", "DA"));
  });

  await waitFor(() => expect(getPipelineById).toHaveBeenCalledWith("P"));
  expect(await screen.findByText(/source · orders|sources? · orders/)).toBeInTheDocument();
});
