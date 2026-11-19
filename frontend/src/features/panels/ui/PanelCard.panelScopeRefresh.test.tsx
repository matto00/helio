import { screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { fetchPublicOutputMeta } from "../../dashboards/services/publicDashboardService";
import { getAssertionStatus, getOutputById } from "../../pipelines/services/outputService";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import { scopeOutputToPanel } from "../state/outputMetaCache";
import { PanelCard } from "./PanelCard";

// HEL-1780 D7/S1: the card-header "Refresh <title>" re-reads rows. In panel read scope (a dashboard the caller does not own)
// that means nothing for an insight panel, whose body reads the stored render, and the paid in-body update refuses a
// grantee -- so it is not rendered for an insight, and, failing closed, not while the Output's kind is still unknown.
jest.mock("../hooks/usePanelData", () => ({ usePanelData: jest.fn() }));
jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));
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
}));

const publicMeta = jest.mocked(fetchPublicOutputMeta);
const ownerMeta = jest.mocked(getOutputById);

// The Output metadata cache is process-wide and keyed by Output id, so every test binds its own Output.
let n = 0;
let panel = makeOutputPanel();

beforeEach(() => {
  jest.clearAllMocks();
  n += 1;
  panel = makeOutputPanel({
    id: `p${n}`,
    dashboardId: "shared",
    title: "Revenue",
    config: { outputId: `out-${n}` },
  });
  jest.mocked(getAssertionStatus).mockReturnValue(new Promise(() => {}));
  jest.mocked(usePanelPolling).mockReturnValue(undefined);
  jest.mocked(usePanelRunRefresh).mockReturnValue(undefined);
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
  jest
    .mocked(getOutputById)
    .mockReset()
    .mockResolvedValue({
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

function renderCard(role: "owner" | "viewer") {
  renderWithStore(
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

describe("PanelCard header Refresh in panel read scope (HEL-1780 D7)", () => {
  it("is not rendered for an insight panel", async () => {
    scopeOutputToPanel(`out-${n}`, "shared", `p${n}`);
    publicMeta.mockResolvedValue({ kind: "insight", config: {}, schema: [], ownerId: null });
    renderCard("viewer");
    await waitFor(() => expect(publicMeta).toHaveBeenCalled());
    // let the meta settle into the card
    await screen.findByRole("button", { name: "Data provenance" });
    expect(screen.queryByRole("button", { name: "Refresh Revenue" })).not.toBeInTheDocument();
  });

  it("is not rendered while the Output's kind is still unknown (fail closed)", async () => {
    scopeOutputToPanel(`out-${n}`, "shared", `p${n}`);
    publicMeta.mockReturnValue(new Promise(() => {}));
    renderCard("viewer");
    await screen.findByRole("button", { name: "Data provenance" });
    expect(screen.queryByRole("button", { name: "Refresh Revenue" })).not.toBeInTheDocument();
  });

  it("is rendered for a non-insight panel once its kind is known", async () => {
    scopeOutputToPanel(`out-${n}`, "shared", `p${n}`);
    publicMeta.mockResolvedValue({ kind: "table", config: {}, schema: [], ownerId: null });
    renderCard("viewer");
    expect(await screen.findByRole("button", { name: "Refresh Revenue" })).toBeInTheDocument();
  });

  it("owner scope keeps Refresh whatever the kind, including an insight (unchanged)", async () => {
    ownerMeta.mockResolvedValue({
      id: `out-${n}`,
      pipelineId: "pipe-1",
      ownerId: "u1",
      name: "Out",
      kind: "insight",
      config: {},
      schema: [],
      createdAt: "",
      updatedAt: "",
    });
    renderCard("owner");
    expect(await screen.findByRole("button", { name: "Refresh Revenue" })).toBeInTheDocument();
  });
});
