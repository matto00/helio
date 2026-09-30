import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeMarkdownPanel, makeOutputPanel } from "../../../test/panelFixtures";
import {
  getAssertionStatus as getAssertionStatusRequest,
  getOutputById as getOutputByIdRequest,
} from "../../pipelines/services/outputService";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import { resetProvenanceCache } from "../provenance/provenanceCache";
import { fetchOutputProvenance } from "../provenance/provenanceService";
import type { Provenance } from "../provenance/provenanceService";
import type { Panel } from "../types/panel";
import { PanelCard } from "./PanelCard";

// HEL-1207 — desktop grid card: footer trigger, Invalid-data badge as a popover opener, status
// dedupe, and event isolation from `onCardClick`.

jest.mock("../hooks/usePanelData", () => ({ usePanelData: jest.fn() }));
jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));
jest.mock("../../pipelines/services/outputService", () => ({
  getAssertionStatus: jest.fn(),
  getOutputById: jest.fn(),
}));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));
jest.mock("../provenance/provenanceService", () => ({
  fetchOutputProvenance: jest.fn(),
  fetchPublicProvenance: jest.fn(),
}));

const getStatus = jest.mocked(getAssertionStatusRequest);
const getOutput = jest.mocked(getOutputByIdRequest);
const fetchProvenance = jest.mocked(fetchOutputProvenance);

const chain: Provenance = {
  outputId: "output-1",
  pipeline: { id: "pipe-1", name: "Weekly sales" },
  sources: [{ id: "s", name: "Orders", kind: "csv" }],
  nodePath: ["filter"],
  lastRun: { status: "succeeded", completedAt: "2026-09-29T10:00:00Z", rowCount: 5 },
  assertions: { defined: true, passed: 1, failed: 1, warned: 0, rootBound: false },
};

beforeEach(() => {
  jest.clearAllMocks();
  resetProvenanceCache();
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
    chartAggregate: null,
    rowsTruncated: false,
    refresh: jest.fn(),
    isRefreshing: false,
  });
  getOutput.mockResolvedValue({
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Out",
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
  });
  getStatus.mockReturnValue(new Promise(() => {}));
  fetchProvenance.mockResolvedValue(chain);
});

function renderCard(panel: Panel = makeOutputPanel({ title: "Revenue" }), onCardClick = jest.fn()) {
  renderWithStore(
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
      onCardClick={onCardClick}
      onStartEdit={jest.fn()}
      onTitleChange={jest.fn()}
      onTitleKeyDown={jest.fn()}
      onTitleBlur={jest.fn()}
      onRequestDelete={jest.fn()}
      onCancelDelete={jest.fn()}
      onDetail={jest.fn()}
    />,
  );
  return onCardClick;
}

describe("PanelCard provenance (HEL-1207)", () => {
  it("renders the footer trigger for an output panel, none for an unbound panel", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "Data provenance" })).toBeInTheDocument();
  });

  it("renders no trigger for a panel with no bound output", () => {
    renderCard(makeMarkdownPanel({ title: "Notes" }));
    expect(screen.queryByRole("button", { name: "Data provenance" })).toBeNull();
  });

  it("opening fetches once; clicking popover text does not reach onCardClick", async () => {
    const onCardClick = renderCard();
    expect(fetchProvenance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Data provenance" }));
    fireEvent.click(await screen.findByText("Weekly sales"));
    expect(fetchProvenance).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("the Invalid data badge (a button) opens the popover at Checks with no second status fetch", async () => {
    getStatus.mockResolvedValue({ outputId: "output-1", invalid: true, failedRuleCount: 1 });
    renderCard();
    const badge = await screen.findByRole("button", {
      name: "Data checks failed - view provenance",
    });
    expect(getStatus).toHaveBeenCalledTimes(1);
    fireEvent.click(badge);
    const checks = await screen.findByRole("heading", { name: "Checks" });
    await waitFor(() => expect(checks).toHaveFocus());
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("a fresh assertion-status read wins over a provenance cache entry: no badge from the cache", async () => {
    // Status says valid; the (older) cached chain says failed > 0. The badge must follow status.
    getStatus.mockResolvedValue({ outputId: "output-1", invalid: false, failedRuleCount: 0 });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Data provenance" }));
    expect(await screen.findByText("1 failed")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Data checks failed - view provenance" }),
    ).toBeNull();
  });
});
