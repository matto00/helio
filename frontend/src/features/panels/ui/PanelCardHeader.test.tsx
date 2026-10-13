import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getAssertionStatus as getAssertionStatusRequest } from "../../pipelines/services/outputService";
import {
  duplicatePanel as duplicatePanelRequest,
  fetchPanels as fetchPanelsRequest,
} from "../services/panelService";
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
    rowsTruncated: false,
    refresh: jest.fn(),
    isRefreshing: false,
  })),
}));

jest.mock("../hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

// HEL-579 task 2.8 — `usePanelRunRefresh` internally calls `useOutputMeta`,
// which owns its OWN internal `useState`/async-fetch cycle entirely
// independent of `usePanelData`/memo props (see `PanelCardBody.fanoutStatus.
// test.tsx`'s identical mock). Left real, its async `setIsLoading` landing at
// an indeterminate microtask tick causes `PanelCardBody` to re-render for a
// reason that has nothing to do with prop stability, confounding the
// reference-stability assertions in the last describe block below.
jest.mock("../hooks/usePanelRunRefresh", () => ({
  usePanelRunRefresh: jest.fn(),
}));

jest.mock("../../pipelines/services/outputService", () => ({
  getAssertionStatus: jest.fn(),
  getOutputById: jest.fn(() => new Promise(() => {})), // never resolves — body stays a skeleton
  // HEL-579 task 2.8 — never resolves either, so the real `usePanelData`'s
  // pending pagination state is stable for the whole test (no store update
  // firing a SECOND, data-driven re-render that would confound the
  // "unrelated re-render" assertion).
  getOutputRows: jest.fn(() => new Promise(() => {})),
}));

const getAssertionStatusMock = jest.mocked(getAssertionStatusRequest);

// HEL-706 — mocked at the service boundary (not the thunk) so
// `duplicatePanel`'s dispatch-cycle timing (including the follow-up
// `fetchPanels` refetch) is controlled via a single deferred promise.
jest.mock("../services/panelService", () => ({
  duplicatePanel: jest.fn(),
  fetchPanels: jest.fn(),
}));

const duplicatePanelMock = jest.mocked(duplicatePanelRequest);
const fetchPanelsMock = jest.mocked(fetchPanelsRequest);

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

  // HEL-1444 -- a footnoted narrow card line-clamps its title to ~1.5 words; the full text must stay
  // reachable as a native tooltip and as the heading's accessible name.
  it("exposes the full panel title as a native tooltip and as the heading's accessible name", () => {
    const title = "Revenue by region this quarter, all channels combined";
    const panel = makeOutputPanel({ title });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    const heading = screen.getByRole("heading", { name: title });
    expect(heading).toHaveAttribute("title", title);
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

// HEL-706 — `ActionsMenu` closes itself on any item's `onClick` before that
// `onClick` runs, so a genuine double-activation here is "activate
// Duplicate, reopen the menu, activate Duplicate again", not two clicks on
// the same still-open item.
describe("PanelCard — HEL-706 duplicate re-entry guard", () => {
  function openMenu(title: string) {
    fireEvent.click(screen.getByRole("button", { name: `${title} panel actions` }));
  }

  function deferredDuplicate() {
    let resolve!: () => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<never>((res, rej) => {
      resolve = res as unknown as () => void;
      reject = rej;
    });
    duplicatePanelMock.mockReturnValueOnce(promise);
    return { resolve, reject };
  }

  beforeEach(() => {
    duplicatePanelMock.mockReset();
    fetchPanelsMock.mockReset();
    fetchPanelsMock.mockResolvedValue([]);
    getAssertionStatusMock.mockReset();
    getAssertionStatusMock.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  it("reopening the menu and activating Duplicate again while the first request is pending dispatches only once", async () => {
    deferredDuplicate();
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    openMenu("Revenue");
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(duplicatePanelMock).toHaveBeenCalledTimes(1));

    openMenu("Revenue");
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    expect(duplicatePanelMock).toHaveBeenCalledTimes(1);
  });

  it("re-enables Duplicate after the pending request resolves, and a further click issues a new dispatch", async () => {
    const { resolve } = deferredDuplicate();
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    openMenu("Revenue");
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(duplicatePanelMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    deferredDuplicate();
    openMenu("Revenue");
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeEnabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(duplicatePanelMock).toHaveBeenCalledTimes(2);
  });

  it("re-enables Duplicate after the pending request rejects, and a further click issues a new dispatch", async () => {
    const { reject } = deferredDuplicate();
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    openMenu("Revenue");
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(duplicatePanelMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      reject(new Error("network down"));
      await Promise.resolve().catch(() => {});
      await Promise.resolve();
      await Promise.resolve();
    });

    deferredDuplicate();
    openMenu("Revenue");
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeEnabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(duplicatePanelMock).toHaveBeenCalledTimes(2);
  });
});
