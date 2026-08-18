import { fireEvent, screen, waitFor } from "@testing-library/react";

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

describe("PanelCard — F-128 header actions (delete-confirm crowding + tooltips)", () => {
  beforeEach(() => {
    fetchAssertionStatusMock.mockReset();
    fetchAssertionStatusMock.mockResolvedValue({
      dataTypeId: "dt-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  it("hides the drag handle while confirming delete, leaving only Confirm/Cancel", () => {
    const panel = makeMetricPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} isConfirmingDelete />, {
      panels: { items: [] },
    });

    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("×")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Revenue panel" })).not.toBeInTheDocument();
  });

  it("shows the drag handle (not Confirm/Cancel) when not confirming delete", () => {
    const panel = makeMetricPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.getByRole("button", { name: "Move Revenue panel" })).toBeInTheDocument();
    expect(screen.queryByText("Confirm")).not.toBeInTheDocument();
  });

  it("gives the drag handle a native title tooltip mirroring its aria-label (F-221)", () => {
    const panel = makeMetricPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    const handle = screen.getByRole("button", { name: "Move Revenue panel" });
    expect(handle).toHaveAttribute("title", "Move Revenue panel");
  });

  // HEL-718 (skeptic-final-1.md Change Request 1): the bare "×" cancel button
  // had neither aria-label nor title -- a live AC-2 counterexample the
  // FontAwesomeIcon/lucide-react/<svg>-scoped audit methodology couldn't
  // catch. Migrated onto the shared IconButton primitive, which gives it
  // both for free.
  it("gives the delete-cancel button an accessible name and matching title tooltip", () => {
    const panel = makeMetricPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} isConfirmingDelete />, {
      panels: { items: [] },
    });

    const cancelButton = screen.getByRole("button", { name: "Cancel delete Revenue" });
    expect(cancelButton).toHaveAttribute("title", "Cancel delete Revenue");
    expect(cancelButton).toHaveClass("ui-icon-btn", "ui-icon-btn--secondary", "ui-icon-btn--xs");
  });

  it("calls onCancelDelete when the delete-cancel button is clicked", () => {
    const panel = makeMetricPanel({ title: "Revenue" });
    const onCancelDelete = jest.fn();
    renderWithStore(
      <PanelCard panel={panel} {...noopProps} isConfirmingDelete onCancelDelete={onCancelDelete} />,
      { panels: { items: [] } },
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel delete Revenue" }));

    expect(onCancelDelete).toHaveBeenCalledTimes(1);
  });
});

describe("PanelCard — F-066 freshness tooltip", () => {
  beforeEach(() => {
    fetchAssertionStatusMock.mockReset();
    fetchAssertionStatusMock.mockResolvedValue({
      dataTypeId: "dt-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  it("exposes the exact timestamp via title on the relative-time freshness line", () => {
    const dataAsOf = "2026-07-18T12:00:00Z";
    const panel = makeMetricPanel({ dataAsOf });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    const freshness = screen.getByText(/Data as of/);
    expect(freshness).toHaveAttribute("title", `Data as of ${new Date(dataAsOf).toLocaleString()}`);
  });

  it("renders no freshness line (and no tooltip) when the panel has no dataAsOf", () => {
    const panel = makeMetricPanel({ dataAsOf: null });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.queryByText(/Data as of/)).not.toBeInTheDocument();
  });
});

// F-099: the drag handle used to be two bare `<span>` dots — visually
// near-identical to the adjacent ActionsMenu trigger's 3-dot ellipsis, with
// no icon/shape/color differentiation between "open a menu" and "drag to
// move the whole panel".
describe("PanelCard — F-099 drag handle visual distinction", () => {
  beforeEach(() => {
    fetchAssertionStatusMock.mockReset();
    fetchAssertionStatusMock.mockResolvedValue({
      dataTypeId: "dt-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  it("renders the drag handle with a grip icon instead of the old bare dot spans", () => {
    const panel = makeMetricPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    const handle = screen.getByRole("button", { name: "Move Revenue panel" });
    expect(handle.querySelector("svg")).toBeInTheDocument();
    expect(handle.querySelectorAll("span")).toHaveLength(0);
  });
});
