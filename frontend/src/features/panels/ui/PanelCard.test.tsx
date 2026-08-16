import { screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeMetricPanel } from "../../../test/panelFixtures";
import { fetchAssertionStatus as fetchAssertionStatusRequest } from "../../dataTypes/services/dataTypeService";
import { PanelCard } from "./PanelCard";

jest.mock("../hooks/usePanelData", () => ({
  usePanelData: () => ({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    noData: true,
    chartAggregate: null,
    refresh: jest.fn(),
  }),
}));

jest.mock("../hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

jest.mock("../../dataTypes/services/dataTypeService", () => ({
  fetchAssertionStatus: jest.fn(),
}));

const fetchAssertionStatusMock = jest.mocked(fetchAssertionStatusRequest);

// Every callback prop is a no-op stub — this suite only exercises the
// HEL-576 invalid-data badge / fetch-dispatch behavior, not the card's
// drag/rename/delete interactions (covered elsewhere via PanelGrid).
const noopProps = {
  theme: "dark" as const,
  isDragging: false,
  dashboardId: "d1",
  isEditingTitle: false,
  editingTitle: "",
  editingTitleError: null,
  isConfirmingDelete: false,
  onMouseDown: jest.fn(),
  onCardClick: jest.fn(),
  onStartEdit: jest.fn(),
  onTitleChange: jest.fn(),
  onTitleKeyDown: jest.fn(),
  onTitleBlur: jest.fn(),
  onRequestDelete: jest.fn(),
  onCancelDelete: jest.fn(),
  onDetail: jest.fn(),
};

describe("PanelCard — HEL-576 invalid-data badge", () => {
  beforeEach(() => {
    fetchAssertionStatusMock.mockReset();
    fetchAssertionStatusMock.mockResolvedValue({
      dataTypeId: "dt-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  it("renders the invalid-data badge when the cached assertion status reports invalid: true", () => {
    const panel = makeMetricPanel({ config: { dataTypeId: "dt-1" } });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, {
      panels: { items: [] },
      dataTypes: {
        assertionStatusByDataTypeId: { "dt-1": { invalid: true, failedRuleCount: 1 } },
      },
    });

    expect(screen.getByText("Invalid data")).toBeInTheDocument();
  });

  it("shows no badge when the cached assertion status reports invalid: false", () => {
    const panel = makeMetricPanel({ config: { dataTypeId: "dt-1" } });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, {
      panels: { items: [] },
      dataTypes: {
        assertionStatusByDataTypeId: { "dt-1": { invalid: false, failedRuleCount: 0 } },
      },
    });

    expect(screen.queryByText("Invalid data")).not.toBeInTheDocument();
  });

  it("shows no badge before the fetch resolves (no cache entry yet)", () => {
    const panel = makeMetricPanel({ config: { dataTypeId: "dt-1" } });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.queryByText("Invalid data")).not.toBeInTheDocument();
  });

  it("dispatches a fetch for the panel's bound dataTypeId on mount", async () => {
    const panel = makeMetricPanel({ config: { dataTypeId: "dt-2" } });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    await waitFor(() => expect(fetchAssertionStatusMock).toHaveBeenCalledWith("dt-2"));
  });

  it("does not dispatch a fetch for an unbound panel", async () => {
    const panel = makeMetricPanel({ config: { dataTypeId: "" } });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchAssertionStatusMock).not.toHaveBeenCalled();
  });
});
