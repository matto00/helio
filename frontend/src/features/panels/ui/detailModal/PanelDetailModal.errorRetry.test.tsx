import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  fetchDataTypes as fetchDataTypesRequest,
  fetchDataTypeRows as fetchDataTypeRowsRequest,
} from "../../../dataTypes/services/dataTypeService";
import { renderWithStore } from "../../../../test/renderWithStore";
import { makeMetricPanel } from "../../../../test/panelFixtures";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-539 (task 4.1/5.5) — PanelDetailModal's Retry is a labeled button
// (retryVariant="button", the modal has room for one), unlike PanelCard's
// icon-only control (small grid cells) — covered separately in
// PanelCard.test.tsx.
jest.mock("../../../dataTypes/services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
  fetchDataTypeRows: jest.fn(),
}));

const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);
const fetchDataTypeRowsMock = jest.mocked(fetchDataTypeRowsRequest);

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
}

const boundPanel = makeMetricPanel({
  id: "p-bound",
  dashboardId: "d1",
  title: "Revenue",
  config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue" } },
});

describe("PanelDetailModal — error state retry (HEL-539)", () => {
  beforeEach(() => {
    setupDialog();
    fetchDataTypesMock.mockReset();
    fetchDataTypesMock.mockResolvedValue([]);
    fetchDataTypeRowsMock.mockReset();
  });

  it("renders a labeled Retry action that re-fetches and recovers on success", async () => {
    fetchDataTypeRowsMock.mockRejectedValueOnce(new Error("network down"));

    renderWithStore(<PanelDetailModal panel={boundPanel} onClose={jest.fn()} />, {
      panels: { items: [boundPanel] },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to load panel data.");
    const retryBtn = screen.getByRole("button", { name: "Retry" });

    fetchDataTypeRowsMock.mockResolvedValueOnce({
      rows: [{ revenue: "1000" }],
      rowCount: 1,
    });
    fireEvent.click(retryBtn);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText("1000")).toBeInTheDocument();
    expect(fetchDataTypeRowsMock).toHaveBeenCalledTimes(2);
  });
});
