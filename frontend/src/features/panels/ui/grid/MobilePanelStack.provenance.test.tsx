import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { makeMarkdownPanel, makeOutputPanel } from "../../../../test/panelFixtures";
import { defaultDashboardLayout } from "../../../dashboards/state/dashboardLayout";
import { resetProvenanceCache } from "../../provenance/provenanceCache";
import { fetchOutputProvenance } from "../../provenance/provenanceService";
import { MobilePanelStack } from "./MobilePanelStack";

// HEL-1207 A1/A2 — the mobile stack renders its own trigger beside the title (no footer), and
// nothing inside the popover may bubble to the item's detail-modal click handler.

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: () => <div data-testid="echarts" />,
}));
jest.mock("../echartsCore", () => ({ __esModule: true, default: {} }));
jest.mock("../../hooks/usePanelData", () => ({
  usePanelData: jest.fn(() => ({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    errorKind: null,
    noData: true,
    neverMaterialized: false,
    chartAggregate: null,
    rowsTruncated: false,
    refresh: jest.fn(),
    isRefreshing: false,
  })),
}));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../services/panelService", () => ({ updatePanelColumnWidths: jest.fn() }));
jest.mock("../../provenance/provenanceService", () => ({
  fetchOutputProvenance: jest.fn(),
  fetchPublicProvenance: jest.fn(),
}));

const fetchProvenance = jest.mocked(fetchOutputProvenance);

beforeEach(() => {
  resetProvenanceCache();
  fetchProvenance.mockReset().mockResolvedValue({
    outputId: "output-1",
    pipeline: { id: "pipe-1", name: "Weekly sales" },
    sources: [{ id: "s", name: "Orders", kind: "csv" }],
    nodePath: [],
    lastRun: null,
    assertions: { defined: false, passed: 0, failed: 0, warned: 0, rootBound: true },
  });
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

const layout = {
  ...defaultDashboardLayout,
  xs: [
    { panelId: "p1", x: 0, y: 0, w: 2, h: 4 },
    { panelId: "p2", x: 0, y: 4, w: 2, h: 4 },
  ],
};

describe("MobilePanelStack provenance (HEL-1207)", () => {
  it("renders a trigger only for the output-bound panel, in the header", () => {
    const out = makeOutputPanel({ id: "p1", title: "Revenue" });
    const md = makeMarkdownPanel({ id: "p2", title: "Notes" });
    const { container } = renderWithStore(
      <MobilePanelStack panels={[out, md]} layout={layout} containerWidth={390} />,
      { panels: { items: [out, md] } },
    );
    const triggers = screen.getAllByRole("button", { name: "Data provenance" });
    expect(triggers).toHaveLength(1);
    expect(triggers[0].closest(".mobile-panel-stack__header")).toBeInTheDocument();
    expect(container.querySelectorAll(".mobile-panel-stack__header")).toHaveLength(2);
    expect(fetchProvenance).not.toHaveBeenCalled();
  });

  it("clicking the trigger or popover text never opens the detail modal", async () => {
    const out = makeOutputPanel({ id: "p1", title: "Revenue" });
    renderWithStore(<MobilePanelStack panels={[out]} layout={layout} containerWidth={390} />, {
      panels: { items: [out] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Data provenance" }));
    fireEvent.click(await screen.findByText("Weekly sales"));
    expect(screen.queryByRole("dialog", { name: "Revenue settings" })).toBeNull();
    expect(fetchProvenance).toHaveBeenCalledTimes(1);
  });
});
