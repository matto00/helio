import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getAssertionStatus as getAssertionStatusRequest } from "../../pipelines/services/outputService";
import { usePanelData } from "../hooks/usePanelData";
import { PanelCard } from "./PanelCard";

// jest.fn() (not a plain factory function), matching MobilePanelStack.test.tsx's
// convention — HEL-539's retry test below overrides the return value to
// simulate a failed fetch.
jest.mock("../hooks/usePanelData", () => ({
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
    refresh: jest.fn(),
  })),
}));

const mockUsePanelData = jest.mocked(usePanelData);

jest.mock("../hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

jest.mock("../../pipelines/services/outputService", () => ({
  getAssertionStatus: jest.fn(),
  getOutputById: jest.fn(() => new Promise(() => {})), // never resolves — body stays a skeleton
}));

const getAssertionStatusMock = jest.mocked(getAssertionStatusRequest);

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
    getAssertionStatusMock.mockReset();
  });

  it("renders the invalid-data badge when the Output's assertion status reports invalid: true", async () => {
    getAssertionStatusMock.mockResolvedValue({
      outputId: "output-1",
      invalid: true,
      failedRuleCount: 1,
    });
    const panel = makeOutputPanel();
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(await screen.findByText("Invalid data")).toBeInTheDocument();
  });

  it("shows no badge when the Output's assertion status reports invalid: false", async () => {
    getAssertionStatusMock.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
    const panel = makeOutputPanel();
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    await waitFor(() => expect(getAssertionStatusMock).toHaveBeenCalledWith("output-1"));
    expect(screen.queryByText("Invalid data")).not.toBeInTheDocument();
  });

  it("shows no badge before the fetch resolves", () => {
    getAssertionStatusMock.mockReturnValue(new Promise(() => {}));
    const panel = makeOutputPanel();
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.queryByText("Invalid data")).not.toBeInTheDocument();
  });

  it("dispatches a fetch for the panel's bound outputId on mount", async () => {
    getAssertionStatusMock.mockResolvedValue({
      outputId: "output-2",
      invalid: false,
      failedRuleCount: 0,
    });
    const panel = makeOutputPanel({ config: { outputId: "output-2" } });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    await waitFor(() => expect(getAssertionStatusMock).toHaveBeenCalledWith("output-2"));
  });
});

describe("PanelCard — F-128 header actions (delete-confirm crowding + tooltips)", () => {
  beforeEach(() => {
    getAssertionStatusMock.mockReset();
    getAssertionStatusMock.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  it("hides the drag handle while confirming delete, leaving only Confirm/Cancel", () => {
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} isConfirmingDelete />, {
      panels: { items: [] },
    });

    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("×")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Revenue panel" })).not.toBeInTheDocument();
  });

  it("shows the drag handle (not Confirm/Cancel) when not confirming delete", () => {
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.getByRole("button", { name: "Move Revenue panel" })).toBeInTheDocument();
    expect(screen.queryByText("Confirm")).not.toBeInTheDocument();
  });

  it("gives the drag handle a native title tooltip mirroring its aria-label (F-221)", () => {
    const panel = makeOutputPanel({ title: "Revenue" });
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
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} isConfirmingDelete />, {
      panels: { items: [] },
    });

    const cancelButton = screen.getByRole("button", { name: "Cancel delete Revenue" });
    expect(cancelButton).toHaveAttribute("title", "Cancel delete Revenue");
    expect(cancelButton).toHaveClass("ui-icon-btn", "ui-icon-btn--secondary", "ui-icon-btn--xs");
  });

  it("calls onCancelDelete when the delete-cancel button is clicked", () => {
    const panel = makeOutputPanel({ title: "Revenue" });
    const onCancelDelete = jest.fn();
    renderWithStore(
      <PanelCard panel={panel} {...noopProps} isConfirmingDelete onCancelDelete={onCancelDelete} />,
      { panels: { items: [] } },
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel delete Revenue" }));

    expect(onCancelDelete).toHaveBeenCalledTimes(1);
  });
});

// F-099: the drag handle used to be two bare `<span>` dots — visually
// near-identical to the adjacent ActionsMenu trigger's 3-dot ellipsis, with
// no icon/shape/color differentiation between "open a menu" and "drag to
// move the whole panel".
describe("PanelCard — F-099 drag handle visual distinction", () => {
  beforeEach(() => {
    getAssertionStatusMock.mockReset();
    getAssertionStatusMock.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  it("renders the drag handle with a grip icon instead of the old bare dot spans", () => {
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    const handle = screen.getByRole("button", { name: "Move Revenue panel" });
    expect(handle.querySelector("svg")).toBeInTheDocument();
    expect(handle.querySelectorAll("span")).toHaveLength(0);
  });
});

// HEL-539 — PanelContent's error state, wired through PanelCard with an
// icon-only Retry (small grid cells) that calls usePanelData().refresh.
describe("PanelCard — error state retry (HEL-539)", () => {
  beforeEach(() => {
    getAssertionStatusMock.mockReset();
    getAssertionStatusMock.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  afterEach(() => {
    mockUsePanelData.mockClear();
  });

  it("renders an icon-only Retry action that calls refresh() when the fetch has failed", () => {
    const refresh = jest.fn();
    mockUsePanelData.mockReturnValueOnce({
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: "Failed to load panel data.",
      errorKind: "error",
      noData: false,
      neverMaterialized: false,
      chartAggregate: null,
      refresh,
    });

    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.getByText("Failed to load panel data.")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renders no Retry action for a forbidden/not-found errorKind", () => {
    mockUsePanelData.mockReturnValueOnce({
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: "You don't have access to this panel's data.",
      errorKind: "forbidden",
      noData: false,
      neverMaterialized: false,
      chartAggregate: null,
      refresh: jest.fn(),
    });

    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
