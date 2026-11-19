import { act, screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { fetchPublicOutputMeta } from "../../dashboards/services/publicDashboardService";
import { getAssertionStatus, getOutputById } from "../../pipelines/services/outputService";
import { getAssertionStatusShared } from "../provenance/provenanceCache";
import { fetchDashboardPanelStatus } from "../services/panelStatusService";
import { resetPanelStatusStoreForTests } from "../state/panelStatusStore";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { PanelCard } from "./PanelCard";

// HEL-1786 D4: on a dashboard the caller does not own, the "Invalid data" badge comes from the dashboard panel-status route
// (never `GET /api/outputs/:id/assertion-status`); the owner's badge is unchanged.
jest.mock("../hooks/usePanelData", () => ({ usePanelData: jest.fn() }));
jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../services/panelStatusService");
jest.mock("../../dashboards/services/publicDashboardService");
jest.mock("../insight/insightService", () => ({
  ...jest.requireActual("../insight/insightService"),
  fetchPublicPanelInsight: jest.fn(() => new Promise(() => {})),
  fetchOutputInsight: jest.fn(() => new Promise(() => {})),
}));
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(),
}));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
  subscribeToPipelineSucceeded: jest.fn(() => jest.fn()),
}));
jest.mock("../provenance/provenanceCache", () => ({
  ...jest.requireActual("../provenance/provenanceCache"),
  getAssertionStatusShared: jest.fn(),
}));

const statusMock = jest.mocked(fetchDashboardPanelStatus);
const BADGE = { name: "Data provenance" };

let n = 0;
let panel = makeOutputPanel();

beforeEach(() => {
  jest.clearAllMocks();
  resetPanelStatusStoreForTests();
  n += 1;
  panel = makeOutputPanel({
    id: `p${n}`,
    dashboardId: "shared",
    title: "Revenue",
    config: { outputId: `out-${n}` },
  });
  jest.mocked(getAssertionStatus).mockReturnValue(new Promise(() => {}));
  jest.mocked(getAssertionStatusShared).mockResolvedValue({
    outputId: `out-${n}`,
    invalid: true,
    failedRuleCount: 1,
  } as never);
  jest.mocked(usePanelPolling).mockReturnValue(undefined);
  jest.mocked(usePanelData).mockReturnValue({
    data: null,
    rawRows: [["a"]],
    headers: ["x"],
    isLoading: false,
    error: null,
    errorKind: null,
    noData: false,
    neverMaterialized: false,
    rowsTruncated: false,
    refresh: jest.fn(),
    queueRefresh: jest.fn(),
    isRefreshing: false,
  });
  jest.mocked(fetchPublicOutputMeta).mockResolvedValue({
    kind: "table",
    config: {},
    schema: [],
    ownerId: null,
  });
  jest.mocked(getOutputById).mockResolvedValue({
    id: `out-${n}`,
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Out",
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
  });
});

function renderCard(role: "owner" | "viewer" | "editor") {
  return renderWithStore(
    <PanelCard
      panel={panel}
      theme="dark"
      isDragging={false}
      dashboardId="shared"
      isEditingTitle={false}
      editingTitle=""
      editingTitleError={null}
      isConfirmingDelete={false}
      onMouseDown={jest.fn()}
      onCardClick={jest.fn()}
      onStartEdit={jest.fn()}
      onTitleChange={jest.fn()}
      onTitleKeyDown={jest.fn()}
      onTitleBlur={jest.fn()}
      onRequestDelete={jest.fn()}
      onCancelDelete={jest.fn()}
      onDetail={jest.fn()}
    />,
    { dashboards: { items: [{ id: "shared", name: "Shared", accessRole: role }] } },
  );
}

const item = (invalid: boolean) => ({
  panelId: `p${n}`,
  lastRunAt: "2026-11-10T10:00:00Z",
  runStatus: "succeeded" as const,
  dataUpdatedAt: "2026-11-10T10:00:01Z",
  invalid,
});

describe.each(["viewer", "editor"] as const)("PanelCard data-invalid badge for a %s", (role) => {
  it("shows the badge when the status route reports the panel invalid, without the assertion-status read", async () => {
    statusMock.mockResolvedValue({ items: [item(true)], sources: [] });
    renderCard(role);
    expect(
      await screen.findByRole("button", { name: "Data checks failed - view provenance" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Invalid data")).toBeInTheDocument();
    expect(getAssertionStatusShared).not.toHaveBeenCalled();
    expect(getAssertionStatus).not.toHaveBeenCalled();
  });

  it("shows no badge when the panel is valid", async () => {
    statusMock.mockResolvedValue({ items: [item(false)], sources: [] });
    renderCard(role);
    await screen.findByRole("button", BADGE);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Invalid data")).not.toBeInTheDocument();
  });
});
