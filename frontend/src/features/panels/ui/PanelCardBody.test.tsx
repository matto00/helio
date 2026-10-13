import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import {
  getAssertionStatus as getAssertionStatusRequest,
  getOutputRows as getOutputRowsRequest,
} from "../../pipelines/services/outputService";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
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

const mockUsePanelData = jest.mocked(usePanelData);
// HEL-579 task 2.8 — the real hook (not the module-level mock above), used
// only by the reference-stability describe block at the bottom of this file,
// which needs `usePanelData`'s genuine `useCallback`/`useMemo` stability to
// prove anything about `PanelCardBody`'s `React.memo` bail-out.
const actualUsePanelData = jest.requireActual<{ usePanelData: typeof usePanelData }>(
  "../hooks/usePanelData",
).usePanelData;

jest.mock("../hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

const mockUsePanelPolling = jest.mocked(usePanelPolling);

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
const getOutputRowsMock = jest.mocked(getOutputRowsRequest);

jest.mock("../services/panelService", () => ({
  duplicatePanel: jest.fn(),
  fetchPanels: jest.fn(),
}));

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
      rowsTruncated: false,
      refresh,
      isRefreshing: false,
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
      rowsTruncated: false,
      refresh: jest.fn(),
      isRefreshing: false,
    });

    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

// HEL-579 design.md Decision 1 / task 2.8 — regression-check for
// `PanelCardBody`'s memo boundary now that it receives fetch state as
// individual props from `PanelCard` instead of calling `usePanelData`
// itself. Uses the REAL hook (not the module-level mock above) — a mocked
// `usePanelData` returns a fresh object/fresh `jest.fn()` on every call,
// which would make every prop "change" on every render regardless of
// whether the real implementation's `useCallback`/`useMemo` stability holds.
describe("PanelCardBody — HEL-579 prop reference stability across an unrelated PanelCard re-render (task 2.8)", () => {
  beforeEach(() => {
    getAssertionStatusMock.mockReset();
    // Never resolves -- unlike the other describe blocks in this file, this
    // one must not have a SECOND, independent async state update
    // (`PanelCard`'s `isDataInvalid`) landing at an indeterminate time and
    // confounding the render-count assertion below.
    getAssertionStatusMock.mockReturnValue(new Promise(() => {}));
    getOutputRowsMock.mockReset();
    getOutputRowsMock.mockReturnValue(new Promise(() => {})); // never resolves
    mockUsePanelPolling.mockClear();
    mockUsePanelData.mockImplementation(actualUsePanelData);
  });

  afterAll(() => {
    // Restore the file's default mocked behavior for any test that might
    // run after this block within the same file (defensive — this describe
    // is the last in the file today).
    mockUsePanelData.mockReset();
  });

  it("PanelCardBody does not re-render when only unrelated PanelCard state changes (title-edit keystrokes)", async () => {
    const panel = makeOutputPanel({ title: "Revenue" });
    const { rerender } = renderWithStore(
      <PanelCard panel={panel} {...noopProps} isEditingTitle={false} />,
      { panels: { items: [] } },
    );

    // Let the mount-triggered fetch dispatch settle into pending state
    // before counting.
    await waitFor(() => expect(getOutputRowsMock).toHaveBeenCalledTimes(1));
    // HEL-1027 skeptic-final-3.md CR1 (cycle 4) — `PanelCardBody` owns its OWN internal
    // `useOutputMeta(outputId)` call (previously an externally-supplied prop from `PanelCard`;
    // see `PanelCardBody.tsx`'s doc comment). Flush the mount-time microtasks here (unrelated to
    // the title-edit re-render this test actually cares about). HEL-1380: `useOutputMeta` no
    // longer queues a same-value `setIsLoading(true)` on a cache-miss mount, so it no longer causes
    // a redundant extra `PanelCardBody` render (see `PanelCardBody.mountRenders.test.tsx`).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // HEL-1215 — kept as a defensive absorption: mount-time work scheduled outside an act scope
    // (while `waitFor` had the act environment off) sits on React's real Scheduler, and whether it
    // lands before or after the baseline sample below can depend on event-loop timing under load.
    // Re-rendering the root with IDENTICAL props inside act makes React process every pending lane
    // synchronously, so any deferred mount-time render is absorbed here deterministically rather
    // than racing the title-edit re-render this test actually measures.
    rerender(<PanelCard panel={panel} {...noopProps} isEditingTitle={false} />);
    const callsBeforeRerender = mockUsePanelPolling.mock.calls.length;
    expect(callsBeforeRerender).toBeGreaterThan(0);

    // Simulate title-edit keystrokes -- a PanelCard-only prop change with no
    // effect on this panel's fetched data.
    rerender(<PanelCard panel={panel} {...noopProps} isEditingTitle={true} editingTitle="Rev" />);

    // `usePanelPolling` is called unconditionally in PanelCardBody's own
    // render body -- its call count only grows if PanelCardBody itself
    // re-rendered. A memo bail-out leaves it unchanged.
    expect(mockUsePanelPolling.mock.calls.length).toBe(callsBeforeRerender);
    // No second fetch was ever dispatched either.
    expect(getOutputRowsMock).toHaveBeenCalledTimes(1);
  });

  it("frozen=true still short-circuits to render nothing, regardless of the individually-threaded props", () => {
    const panel = makeOutputPanel({ title: "Revenue" });
    const { container } = renderWithStore(<PanelCard panel={panel} {...noopProps} isDragging />, {
      panels: { items: [] },
    });

    // Header (title + actions) remains visible during drag-freeze; the body
    // (PanelContent output) does not. Scoped to the card's own `<h3>` — HEL-584
    // added an always-mounted (open or not) `PanelFullscreenOverlay` whose
    // Modal header ALSO renders the panel title as an `<h2>`, so a bare
    // `getByText("Revenue")` is ambiguous as of this ticket.
    expect(container.querySelector(".panel-grid-card__title")?.textContent).toBe("Revenue");
    expect(container.querySelector(".panel-content")).not.toBeInTheDocument();
  });
});
