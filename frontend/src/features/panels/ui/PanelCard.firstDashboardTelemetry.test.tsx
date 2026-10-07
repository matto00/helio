// HEL-1208: `first_dashboard_rendered` fires from the shared `PanelCardBody` only once an OUTPUT
// panel has loaded at least one row for a signed-in user; an empty panel must emit nothing.

import { waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import { track } from "../../telemetry/track";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import { PanelCard } from "./PanelCard";

jest.mock("../../telemetry/track", () => ({ track: jest.fn() }));
jest.mock("../hooks/usePanelData", () => ({ usePanelData: jest.fn() }));
jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getAssertionStatus: jest.fn(() => new Promise(() => {})),
  getOutputById: jest.fn(),
}));

const mockTrack = jest.mocked(track);
const mockUsePanelData = jest.mocked(usePanelData);

const baseData = {
  data: null,
  headers: null,
  isLoading: false,
  error: null,
  errorKind: null,
  neverMaterialized: false,
  rowsTruncated: false,
  refresh: jest.fn(),
  isRefreshing: false,
};

function renderPanel() {
  const panel = makeOutputPanel({ id: "panel-1", title: "Customers" });
  return renderWithStore(
    <PanelCard
      panel={panel}
      theme="dark"
      isDragging={false}
      dashboardId="dashboard-1"
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
    {
      panels: { items: [panel] },
      auth: {
        status: "authenticated",
        currentUser: {
          id: "user-1",
          email: "u@example.com",
          displayName: null,
          avatarUrl: null,
          createdAt: "",
          tier: "free",
        },
      },
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  jest.mocked(usePanelPolling).mockReturnValue(undefined);
  jest.mocked(usePanelRunRefresh).mockReturnValue(undefined);
  jest.mocked(getOutputByIdRequest).mockResolvedValue({
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Customers",
    kind: "table",
    config: { fieldMapping: {} },
    schema: [{ name: "name", type: "string" }],
    createdAt: "",
    updatedAt: "",
  });
});

describe("PanelCard first_dashboard_rendered telemetry (HEL-1208)", () => {
  it("emits once the output panel has loaded at least one row", async () => {
    mockUsePanelData.mockReturnValue({ ...baseData, rawRows: [["Ada"]], noData: false });
    renderPanel();
    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith("first_dashboard_rendered", { panelCount: 1 }),
    );
    expect(mockTrack).toHaveBeenCalledTimes(1);
  });

  it("emits nothing for a panel whose data loaded with zero rows", async () => {
    mockUsePanelData.mockReturnValue({ ...baseData, rawRows: null, noData: true });
    renderPanel();
    await waitFor(() => expect(getOutputByIdRequest).toHaveBeenCalled());
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("emits nothing while the panel is still loading", async () => {
    mockUsePanelData.mockReturnValue({
      ...baseData,
      rawRows: null,
      noData: false,
      isLoading: true,
    });
    renderPanel();
    await waitFor(() => expect(getOutputByIdRequest).toHaveBeenCalled());
    expect(mockTrack).not.toHaveBeenCalled();
  });
});
