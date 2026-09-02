import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  getOutputById as getOutputByIdRequest,
  getOutputRows as getOutputRowsRequest,
} from "../../../pipelines/services/outputService";
import { renderWithStore } from "../../../../test/renderWithStore";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import type { Output } from "../../../pipelines/types/output";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-539 (task 4.1/5.5) — PanelDetailModal's Retry is a labeled button
// (retryVariant="button", the modal has room for one), unlike PanelCard's
// icon-only control (small grid cells) — covered separately in
// PanelCard.test.tsx.
jest.mock("../../../pipelines/services/outputService", () => ({
  getOutputById: jest.fn(),
  getOutputRows: jest.fn(),
  listOutputPanels: jest.fn().mockResolvedValue([]),
}));

const getOutputByIdMock = jest.mocked(getOutputByIdRequest);
const getOutputRowsMock = jest.mocked(getOutputRowsRequest);

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
}

const revenueOutput: Output = {
  id: "output-1",
  pipelineId: "pipe-1",
  ownerId: "u1",
  name: "Revenue",
  kind: "table",
  config: {},
  schema: [],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const boundPanel = makeOutputPanel({
  id: "p-bound",
  dashboardId: "d1",
  title: "Revenue",
  config: { outputId: "output-1" },
});

describe("PanelDetailModal — error state retry (HEL-539)", () => {
  beforeEach(() => {
    setupDialog();
    getOutputByIdMock.mockReset();
    getOutputByIdMock.mockResolvedValue(revenueOutput);
    getOutputRowsMock.mockReset();
  });

  it("renders a labeled Retry action that re-fetches and recovers on success", async () => {
    getOutputRowsMock.mockRejectedValueOnce(new Error("network down"));

    renderWithStore(<PanelDetailModal panel={boundPanel} onClose={jest.fn()} />, {
      panels: { items: [boundPanel] },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to load panel data.");
    const retryBtn = screen.getByRole("button", { name: "Retry" });

    getOutputRowsMock.mockResolvedValueOnce({
      items: [{ revenue: "1000" }],
      total: 1,
      offset: 0,
      limit: 200,
    });
    fireEvent.click(retryBtn);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText("1000")).toBeInTheDocument();
    expect(getOutputRowsMock).toHaveBeenCalledTimes(2);
  });
});
