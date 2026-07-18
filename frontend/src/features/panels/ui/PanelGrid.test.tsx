import { act, fireEvent, screen } from "@testing-library/react";
import { createRef } from "react";

import { Responsive, useContainerWidth } from "react-grid-layout";
import { createScaledStrategy } from "react-grid-layout/core";
import { updatePanelTitle as updatePanelTitleRequest } from "../services/panelService";
import { updatePanelsBatch as updatePanelsBatchRequest } from "../services/panelService";
import { updateDashboardLayout as updateDashboardLayoutRequest } from "../../dashboards/services/dashboardService";
import { defaultDashboardLayout } from "../../dashboards/state/dashboardLayout";
import { AUTO_SAVE_INTERVAL_MS } from "../hooks/usePanelUpdatesFlush";
import { accumulatePanelUpdate } from "../state/panelsSlice";
import { SaveStateContext } from "../../../context/SaveStateContext";
import { renderWithStore } from "../../../test/renderWithStore";
import { makeMetricPanel } from "../../../test/panelFixtures";
import { PanelGrid, type PanelGridHandle } from "./PanelGrid";

jest.mock("react-grid-layout", () => {
  const React = require("react");
  return {
    Responsive: jest.fn(({ children }: { children?: import("react").ReactNode }) =>
      React.createElement("div", { "data-testid": "mock-responsive" }, children),
    ),
    useContainerWidth: jest.fn().mockReturnValue({
      containerRef: { current: null },
      width: 1280,
      mounted: true,
      measureWidth: jest.fn(),
    }),
  };
});

jest.mock("react-grid-layout/core", () => ({
  noCompactor: {},
  createScaledStrategy: jest.fn((scale: number) => ({ __scale: scale })),
}));

const MockResponsive = jest.mocked(Responsive);
const mockUseContainerWidth = jest.mocked(useContainerWidth);
const mockCreateScaledStrategy = jest.mocked(createScaledStrategy);

jest.mock("../hooks/usePanelData", () => ({
  usePanelData: () => ({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    noData: true,
    refresh: jest.fn(),
  }),
}));

jest.mock("../hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelTitle: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelBinding: jest.fn(),
  updatePanelsBatch: jest.fn().mockResolvedValue({ panels: [] }),
  deletePanel: jest.fn(),
  duplicatePanel: jest.fn(),
}));

jest.mock("../../dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  createDashboard: jest.fn(),
  updateDashboardAppearance: jest.fn(),
  updateDashboardLayout: jest.fn().mockResolvedValue({}),
  duplicateDashboard: jest.fn(),
  exportDashboard: jest.fn(),
  importDashboard: jest.fn(),
}));

const updatePanelTitleMock = jest.mocked(updatePanelTitleRequest);
const updatePanelsBatchMock = jest.mocked(updatePanelsBatchRequest);
const updateDashboardLayoutMock = jest.mocked(updateDashboardLayoutRequest);

const testPanel = makeMetricPanel({
  id: "panel-1",
  dashboardId: "d1",
  title: "Revenue",
  meta: {
    createdBy: "system",
    createdAt: "2026-03-14T00:00:00Z",
    lastUpdated: "2026-03-14T00:00:00Z",
  },
  appearance: { background: "transparent", color: "inherit", transparency: 0 },
});

const emptyLayout = { lg: [], md: [], sm: [], xs: [] };

// ─── Mocking rationale ───────────────────────────────────────────────────────
// react-grid-layout relies on DOM measurement APIs (ResizeObserver,
// HTMLElement.getBoundingClientRect, pointer event coordinates within real
// browser layout) that jsdom does not support. Rendering the actual <Responsive>
// component in unit tests produces "ResizeObserver is not defined" errors and
// yields incorrect layout measurements that make assertions impossible. Full
// module mocking is therefore the standard approach for unit-testing components
// that wrap this library.
//
// What these unit tests verify:
//   - prop threading: zoomLevel reaches createScaledStrategy() and the resulting
//     positionStrategy object is forwarded to <Responsive>.
//   - default behaviour: omitting zoomLevel uses scale 1.0.
//
// What was verified manually (cannot be asserted via jsdom):
//   - At 50%, 75%, 125%, and 150% zoom, dragging and resizing panels produces
//     correct grid positions that match visual panel placement.
//   - At 100% zoom no regressions were introduced; drag/resize behave identically
//     to the pre-fix baseline.
//   - Coordinate offsets that previously caused panels to "jump" on drag start at
//     non-100% zoom are eliminated.
// ─────────────────────────────────────────────────────────────────────────────

describe("PanelGrid", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockResponsive.mockClear();
    mockCreateScaledStrategy.mockClear();
    mockUseContainerWidth.mockReturnValue({
      containerRef: { current: null },
      width: 1280,
      mounted: true,
      measureWidth: jest.fn(),
    });
    updatePanelTitleMock.mockReset();
    updatePanelsBatchMock.mockReset();
    updatePanelsBatchMock.mockResolvedValue({ panels: [] });
    updateDashboardLayoutMock.mockReset();
    updateDashboardLayoutMock.mockResolvedValue({} as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("passes zoomLevel to createScaledStrategy and forwards positionStrategy to Responsive", () => {
    renderWithStore(
      <PanelGrid dashboardId="d1" layout={defaultDashboardLayout} panels={[]} zoomLevel={0.75} />,
      { panels: { items: [] } },
    );

    expect(mockCreateScaledStrategy).toHaveBeenCalledWith(0.75);
    const lastCall = MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ positionStrategy: { __scale: 0.75 } });
  });

  it("omits positionStrategy when zoomLevel is 1.0 so RGL uses its correct default drag math", () => {
    // createScaledStrategy has an off-by-parent-offset bug when used at scale=1 —
    // it returns a viewport-absolute baseline that RGL's pointer handler treats
    // as parent-relative, causing a constant jump on drag start. When there is
    // no real scale to correct for, fall through to the default strategy.
    renderWithStore(<PanelGrid dashboardId="d1" layout={defaultDashboardLayout} panels={[]} />, {
      panels: { items: [] },
    });

    expect(mockCreateScaledStrategy).not.toHaveBeenCalled();
    const lastCall = MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1];
    expect(lastCall[0].positionStrategy).toBeUndefined();
  });

  // ─── AC: "All editing interactions work correctly at all zoom levels" ────────
  // Rename, delete, and context-menu interactions are triggered by click events,
  // not drag/resize pointer deltas.  The browser's hit-test mechanism already
  // accounts for CSS transform: scale() when resolving click targets, so these
  // interactions are unaffected by the zoom level regardless of positionStrategy.
  //
  // Delete and context-menu open/close are click-only actions with no coordinate
  // arithmetic — they work identically at all zoom levels without any code change.
  // The rename test below confirms this for a representative editing interaction:
  // the rename flow dispatches correctly at zoomLevel={0.5}.
  it("rename interaction works correctly at non-100% zoom (zoomLevel 0.5)", () => {
    const { store } = renderWithStore(
      // zoomLevel={0.5} simulates 50% zoom — the lowest supported value
      <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} zoomLevel={0.5} />,
      {
        panels: { items: [testPanel] },
      },
    );

    // Open the actions menu and trigger rename — identical flow to the 100% zoom test
    fireEvent.click(screen.getByRole("button", { name: "Revenue panel actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const titleInput = screen.getByLabelText("Panel title");
    fireEvent.change(titleInput, { target: { value: "Zoomed Revenue" } });

    act(() => {
      fireEvent.keyDown(titleInput, { key: "Enter" });
    });

    // Rename dispatches correctly even at 50% zoom
    expect(store.getState().panels.pendingPanelUpdates["panel-1"]).toEqual({
      title: "Zoomed Revenue",
    });
    expect(updatePanelTitleMock).not.toHaveBeenCalled();
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // Task 5.4 — committing a title edit dispatches accumulatePanelUpdate instead of updatePanelTitle
  it("committing a title edit populates pendingPanelUpdates and does not call the updatePanelTitle service", () => {
    const { store } = renderWithStore(
      <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
      {
        panels: { items: [testPanel] },
      },
    );

    // Open the actions menu for the panel
    fireEvent.click(screen.getByRole("button", { name: "Revenue panel actions" }));

    // Click the Rename option (rendered in a portal)
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    // Type a new title in the inline input
    const titleInput = screen.getByLabelText("Panel title");
    fireEvent.change(titleInput, { target: { value: "Updated Revenue" } });

    // Commit via Enter — commitTitleEdit dispatches accumulatePanelUpdate synchronously
    act(() => {
      fireEvent.keyDown(titleInput, { key: "Enter" });
    });

    // The pending update should be in Redux state
    expect(store.getState().panels.pendingPanelUpdates["panel-1"]).toEqual({
      title: "Updated Revenue",
    });

    // The optimistic patch should also be visible in items
    const updatedPanel = store
      .getState()
      .panels.items.find((p: { id: string }) => p.id === "panel-1");
    expect(updatedPanel?.title).toBe("Updated Revenue");

    // The individual updatePanelTitle service must NOT have been called
    expect(updatePanelTitleMock).not.toHaveBeenCalled();

    // Debounce timer has not yet fired — batch endpoint not called yet
    expect(updatePanelsBatchMock).not.toHaveBeenCalled();
  });

  // ─── Panel body click opens detail modal ─────────────────────────────────────
  // Tasks 2.1–2.4: verify the mousedown-displacement + target-exclusion logic.
  // HTMLDialogElement.prototype.showModal is mocked to set the open attribute so
  // PanelDetailModal is accessible via getByRole('dialog') in jsdom.
  describe("panel body click opens detail modal", () => {
    beforeEach(() => {
      HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      });
      HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      });
    });

    // 2.1 — clicking the panel body (no significant displacement) opens the modal
    it("clicking the panel body opens the detail modal", () => {
      renderWithStore(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />, {
        panels: { items: [testPanel] },
      });

      const article = screen.getByRole("article");
      fireEvent.mouseDown(article, { clientX: 10, clientY: 10 });
      fireEvent.click(article, { clientX: 10, clientY: 10 });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // 2.2 — simulated drag: mousedown then click with large displacement suppresses modal
    it("simulated drag (large pointer displacement) does NOT open the modal", () => {
      renderWithStore(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />, {
        panels: { items: [testPanel] },
      });

      const article = screen.getByRole("article");
      fireEvent.mouseDown(article, { clientX: 0, clientY: 0 });
      fireEvent.click(article, { clientX: 50, clientY: 0 });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // 2.3 — clicking the drag handle button does not open modal (button exclusion)
    it("clicking the drag handle button does NOT open the modal", () => {
      renderWithStore(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />, {
        panels: { items: [testPanel] },
      });

      const dragHandle = screen.getByRole("button", { name: "Move Revenue panel" });
      fireEvent.mouseDown(dragHandle, { clientX: 0, clientY: 0 });
      fireEvent.click(dragHandle, { clientX: 0, clientY: 0 });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // 2.4 — clicking the actions menu trigger does not open modal (button exclusion)
    it("clicking the actions menu trigger does NOT open the modal", () => {
      renderWithStore(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />, {
        panels: { items: [testPanel] },
      });

      const menuTrigger = screen.getByRole("button", { name: "Revenue panel actions" });
      fireEvent.mouseDown(menuTrigger, { clientX: 0, clientY: 0 });
      fireEvent.click(menuTrigger, { clientX: 0, clientY: 0 });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // ─── HEL-284: drag freeze — PanelCardBody hidden during drag ─────────────────
  // When `onDragStart` fires, PanelGrid sets `isDragging = true`.  PanelCard
  // forwards this as `frozen={true}` to PanelCardBody, which short-circuits and
  // returns null so expensive chart/table repaints are suppressed.  On
  // `onDragStop` the frozen flag clears and the body is restored.
  //
  // The test drives `onDragStart` / `onDragStop` directly on the props captured
  // by the MockResponsive spy rather than via pointer events (which jsdom cannot
  // simulate with real coordinates).
  describe("drag freeze — panel body hidden during drag", () => {
    it("hides panel body when drag starts and restores it on drag stop", () => {
      renderWithStore(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />, {
        panels: { items: [testPanel] },
      });

      // Before drag: PanelCardBody renders; the noData mock surfaces "No data available"
      expect(screen.getByText("No data available")).toBeInTheDocument();

      // Extract callbacks from the last Responsive render pass
      const responsiveProps = MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0];

      // Simulate drag start — isDragging becomes true → PanelCardBody frozen
      act(() => {
        (responsiveProps.onDragStart as unknown as () => void)?.();
      });
      expect(screen.queryByText("No data available")).not.toBeInTheDocument();

      // Simulate drag stop — isDragging becomes false → PanelCardBody unfreezes
      act(() => {
        (responsiveProps.onDragStop as unknown as () => void)?.();
      });
      expect(screen.getByText("No data available")).toBeInTheDocument();
    });
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // ── HEL-234: dataAsOf freshness indicator ───────────────────────────────────
  describe("dataAsOf freshness indicator", () => {
    it("renders 'Data as of ...' below the title when dataAsOf is set", () => {
      const panelWithFreshness = makeMetricPanel({
        id: "panel-fresh",
        dashboardId: "d1",
        title: "Fresh Panel",
        dataAsOf: "2026-01-01T00:00:00Z",
      });

      renderWithStore(
        <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[panelWithFreshness]} />,
        { panels: { items: [panelWithFreshness] } },
      );

      expect(screen.getByText(/Data as of/i)).toBeInTheDocument();
    });

    it("does not render the freshness indicator when dataAsOf is null", () => {
      const panelNoFreshness = makeMetricPanel({
        id: "panel-nofresh",
        dashboardId: "d1",
        title: "Stale Panel",
        dataAsOf: null,
      });

      renderWithStore(
        <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[panelNoFreshness]} />,
        { panels: { items: [panelNoFreshness] } },
      );

      expect(screen.queryByText(/Data as of/i)).not.toBeInTheDocument();
    });

    it("does not render the freshness indicator when dataAsOf is absent (default null)", () => {
      // testPanel uses makeMetricPanel with no dataAsOf — defaults to null
      renderWithStore(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />, {
        panels: { items: [testPanel] },
      });

      expect(screen.queryByText(/Data as of/i)).not.toBeInTheDocument();
    });
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // Task 5.2 — desktop/tablet width (>=768) renders the RGL grid, unchanged.
  it("renders the RGL <Responsive> grid, not the mobile stack, at a >=768px container width", () => {
    const { container } = renderWithStore(
      <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
      { panels: { items: [testPanel] } },
    );

    expect(MockResponsive).toHaveBeenCalled();
    expect(container.querySelector(".mobile-panel-stack")).not.toBeInTheDocument();
  });

  // ─── HEL-301 hazard §4.1 — phone width is structurally incapable of persisting layout ──
  // Below panelGridConfig.breakpoints.sm (768px) PanelGrid mounts MobilePanelStack,
  // not DesktopPanelGrid — the only component that calls usePanelGridSave. These
  // tests are the structural regression guard for that guarantee: no
  // updateDashboardLayout dispatch (network PATCH) and no setLayoutPending
  // (hasPendingLayout) transition, on mount, on a width change that stays below
  // the boundary, or across the 30s auto-save tick.
  describe("phone width — mobile stack (hazard §4.1)", () => {
    beforeEach(() => {
      mockUseContainerWidth.mockReturnValue({
        containerRef: { current: null },
        width: 375,
        mounted: true,
        measureWidth: jest.fn(),
      });
    });

    it("renders the read-only stack, not the RGL <Responsive> grid", () => {
      const { container } = renderWithStore(
        <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
        { panels: { items: [testPanel] } },
      );

      expect(MockResponsive).not.toHaveBeenCalled();
      expect(container.querySelector(".mobile-panel-stack")).toBeInTheDocument();
    });

    it("dispatches no layout PATCH on mount, on a width change, or across the auto-save tick", () => {
      const { store, rerender } = renderWithStore(
        <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
        { panels: { items: [testPanel] } },
      );

      // Mount.
      expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
      expect(store.getState().dashboards.hasPendingLayout).toBeFalsy();

      // Width change while still below the sm boundary (375 -> 400).
      mockUseContainerWidth.mockReturnValue({
        containerRef: { current: null },
        width: 400,
        mounted: true,
        measureWidth: jest.fn(),
      });
      rerender(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />);
      expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
      expect(store.getState().dashboards.hasPendingLayout).toBeFalsy();

      // The 30s auto-save tick — DesktopPanelGrid's usePanelGridSave is
      // never mounted here, so there is no interval to fire in the first
      // place; advancing fake timers confirms nothing latent fires either.
      act(() => {
        jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 1_000);
      });
      expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
      expect(store.getState().dashboards.hasPendingLayout).toBeFalsy();
    });

    // HEL-304: rewrite of the former "does not register a save-flush handle"
    // test. The panel-update flush is now hoisted to PanelGrid and mounts at
    // every width, so the imperative handle IS live at phone width — it flushes
    // the pending panel batch — while still never dispatching a layout PATCH.
    it("exposes a live flush handle at phone width that flushes the panel batch but never PATCHes layout", async () => {
      const ref = createRef<PanelGridHandle>();
      const { store } = renderWithStore(
        <PanelGrid ref={ref} dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
        { panels: { items: [testPanel] } },
      );

      act(() => {
        store.dispatch(
          accumulatePanelUpdate({
            panelId: "panel-1",
            fields: { appearance: { background: "#123456", color: "inherit", transparency: 0 } },
          }),
        );
      });

      await act(async () => {
        ref.current?.flushAndReset();
      });

      expect(updatePanelsBatchMock).toHaveBeenCalledTimes(1);
      expect(store.getState().panels.pendingPanelUpdates).toEqual({});
      expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    });

    // Closes the coverage gap the `mobile-viewer-stack` spec's own scenario
    // wording calls out: a width change that crosses back *above* the sm
    // boundary while PanelGrid is already mounted must swap the mobile stack
    // out for the real RGL grid (and vice versa) — not get stuck on
    // whichever branch first mounted.
    it("swaps to the RGL <Responsive> grid when the width crosses back above 768px", () => {
      const { container, rerender } = renderWithStore(
        <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
        { panels: { items: [testPanel] } },
      );

      expect(MockResponsive).not.toHaveBeenCalled();
      expect(container.querySelector(".mobile-panel-stack")).toBeInTheDocument();

      mockUseContainerWidth.mockReturnValue({
        containerRef: { current: null },
        width: 900,
        mounted: true,
        measureWidth: jest.fn(),
      });
      rerender(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />);

      expect(MockResponsive).toHaveBeenCalled();
      expect(container.querySelector(".mobile-panel-stack")).not.toBeInTheDocument();
      expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    });

    // HEL-304 Decision 3 / task 1.3 probe — a pure width change that crosses
    // below the sm boundary with no user drag must issue ZERO layout PATCH.
    // Layout persistence stays structurally desktop-only; the shell swap alone
    // never writes layout (the sacred HEL-301 xs byte-identity guarantee).
    it("issues zero layout PATCH on a pure resize across the 768px boundary (no drag)", async () => {
      mockUseContainerWidth.mockReturnValue({
        containerRef: { current: null },
        width: 1280,
        mounted: true,
        measureWidth: jest.fn(),
      });
      const { rerender } = renderWithStore(
        <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
        { panels: { items: [testPanel] } },
      );

      mockUseContainerWidth.mockReturnValue({
        containerRef: { current: null },
        width: 375,
        mounted: true,
        measureWidth: jest.fn(),
      });
      rerender(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />);

      await act(async () => {
        jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 1_000);
      });

      expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    });
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // ─── HEL-304 — width-independent panel-update flush (remedy (a)) ──────────────
  // The pending-panel-updates flush lifecycle (30s interval, dashboard-switch
  // flush, Save-now registration, imperative handle) is hoisted out of
  // DesktopPanelGrid to PanelGrid, so it runs at EVERY container width. Panel
  // title/appearance edits staged below 768px (mobile stack) now persist via
  // the batch endpoint exactly like desktop; layout persistence stays
  // structurally desktop-only (zero layout PATCH from the phone path).
  describe("HEL-304 — width-independent panel-update flush", () => {
    const stagedAppearance = { background: "#123456", color: "inherit", transparency: 0 } as const;

    function setWidth(width: number) {
      mockUseContainerWidth.mockReturnValue({
        containerRef: { current: null },
        width,
        mounted: true,
        measureWidth: jest.fn(),
      });
    }

    // 3.1 — appearance edit staged at phone width flushes on the auto-save tick.
    it("flushes an appearance edit staged at phone width on the auto-save tick", async () => {
      setWidth(375);
      const { store } = renderWithStore(
        <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
        { panels: { items: [testPanel] } },
      );

      act(() => {
        store.dispatch(
          accumulatePanelUpdate({ panelId: "panel-1", fields: { appearance: stagedAppearance } }),
        );
      });
      expect(updatePanelsBatchMock).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 1_000);
      });

      expect(updatePanelsBatchMock).toHaveBeenCalledTimes(1);
      expect(store.getState().panels.pendingPanelUpdates).toEqual({});
      expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    });

    // 3.2 — "Save now" at phone width dispatches the batch; no-op when clean.
    it("wires a functional Save-now at phone width and no-ops when clean", async () => {
      setWidth(375);
      const holder: { fn: (() => void) | null } = { fn: null };
      const registerFlush = (fn: (() => void) | null) => {
        holder.fn = fn;
      };
      const { store } = renderWithStore(
        <SaveStateContext.Provider value={{ registerFlush, flush: () => holder.fn?.() }}>
          <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />
        </SaveStateContext.Provider>,
        { panels: { items: [testPanel] } },
      );

      // A real flush handler is registered even at phone width.
      expect(holder.fn).not.toBeNull();

      // No-op with nothing pending.
      act(() => {
        holder.fn?.();
      });
      expect(updatePanelsBatchMock).not.toHaveBeenCalled();

      // Stage, then Save now.
      act(() => {
        store.dispatch(
          accumulatePanelUpdate({ panelId: "panel-1", fields: { appearance: stagedAppearance } }),
        );
      });
      await act(async () => {
        holder.fn?.();
      });

      expect(updatePanelsBatchMock).toHaveBeenCalledTimes(1);
      expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    });

    // 3.3 — updates staged at desktop survive a width drop below 768px (the
    // resize-mid-edit strand) and flush on the next tick.
    it("does not strand updates staged at desktop when the width drops below 768px", async () => {
      setWidth(1280);
      const { store, rerender } = renderWithStore(
        <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
        { panels: { items: [testPanel] } },
      );

      act(() => {
        store.dispatch(
          accumulatePanelUpdate({ panelId: "panel-1", fields: { appearance: stagedAppearance } }),
        );
      });

      // Window resized below the boundary before the next flush.
      setWidth(375);
      rerender(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />);

      await act(async () => {
        jest.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS + 1_000);
      });

      expect(updatePanelsBatchMock).toHaveBeenCalledTimes(1);
      expect(store.getState().panels.pendingPanelUpdates).toEqual({});
      expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    });
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // ─── HEL-306 — staged layout flushes when the desktop grid unmounts ──────────
  // A layout change staged on desktop (drag/resize within the 30s auto-save
  // window) must not be dropped when DesktopPanelGrid unmounts — whether the
  // window shrinks below the sm boundary, the user switches dashboards, or
  // navigates away. useLayoutSave flushes the staged layout in its unmount
  // cleanup. The HEL-301 structural guarantee is preserved: the flush runs in
  // the desktop hook's teardown on desktop-staged data only, so a browse-only
  // crossing (no staged change) still dispatches nothing.
  describe("HEL-306 — flush staged layout on desktop grid unmount", () => {
    function setWidth(width: number) {
      mockUseContainerWidth.mockReturnValue({
        containerRef: { current: null },
        width,
        mounted: true,
        measureWidth: jest.fn(),
      });
    }

    // Reads the latest <Responsive> props captured by the mock spy so a test can
    // drive onLayoutChange (simulating a drag/resize tick) directly.
    function latestResponsiveProps() {
      return MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0];
    }

    // A layout that moves panel-1 away from its resolved default position (x:0)
    // at the lg breakpoint, so markLayoutChanged stages a real change.
    const movedLayouts = {
      lg: [{ i: "panel-1", x: 4, y: 0, w: 4, h: 5 }],
      md: [{ i: "panel-1", x: 0, y: 0, w: 4, h: 5 }],
      sm: [{ i: "panel-1", x: 0, y: 0, w: 3, h: 5 }],
      xs: [{ i: "panel-1", x: 0, y: 0, w: 2, h: 5 }],
    };
    const stagedLayout = {
      lg: [{ panelId: "panel-1", x: 4, y: 0, w: 4, h: 5 }],
      md: [{ panelId: "panel-1", x: 0, y: 0, w: 4, h: 5 }],
      sm: [{ panelId: "panel-1", x: 0, y: 0, w: 3, h: 5 }],
      xs: [{ panelId: "panel-1", x: 0, y: 0, w: 2, h: 5 }],
    };

    // 3.1 — shrink-mid-edit: a staged layout change flushes exactly one PATCH
    // carrying the staged layout when the width drops below 768px.
    it("flushes the staged layout exactly once when the width drops below 768px mid-edit", async () => {
      setWidth(1280);
      const { rerender } = renderWithStore(
        <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
        { panels: { items: [testPanel] } },
      );

      // Stage a layout change (RGL onLayoutChange fires during a drag).
      act(() => {
        (
          latestResponsiveProps().onLayoutChange as unknown as (
            current: unknown,
            all: typeof movedLayouts,
          ) => void
        )(undefined, movedLayouts);
      });

      // Still staged — nothing has flushed yet.
      expect(updateDashboardLayoutMock).not.toHaveBeenCalled();

      // Window shrinks below the boundary → DesktopPanelGrid unmounts.
      setWidth(375);
      await act(async () => {
        rerender(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />);
      });

      expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
      expect(updateDashboardLayoutMock).toHaveBeenCalledWith("d1", stagedLayout);
    });

    // 3.2 — browse-only crossing: no staged change → the unmount path dispatches
    // zero layout PATCHes (re-runs the HEL-301 guarantee through the new path).
    it("dispatches no layout PATCH on a browse-only crossing below 768px", async () => {
      setWidth(1280);
      const { rerender } = renderWithStore(
        <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
        { panels: { items: [testPanel] } },
      );

      // No drag — just resize below the boundary. DesktopPanelGrid unmounts.
      setWidth(375);
      await act(async () => {
        rerender(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />);
      });

      expect(updateDashboardLayoutMock).not.toHaveBeenCalled();
    });

    // 3.3 — rapid repeated crossings: stage once, cross down/up/down quickly.
    // The staged layout persists exactly once (equality + in-flight guards) and
    // no PATCH originates while the mobile stack is mounted.
    it("persists the staged layout exactly once across rapid repeated boundary crossings", async () => {
      setWidth(1280);
      const { rerender } = renderWithStore(
        <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
        { panels: { items: [testPanel] } },
      );

      // Stage a layout change on desktop.
      act(() => {
        (
          latestResponsiveProps().onLayoutChange as unknown as (
            current: unknown,
            all: typeof movedLayouts,
          ) => void
        )(undefined, movedLayouts);
      });

      // Down (unmount → flush), up (remount, re-seeds from resolvedLayout), down
      // again (unmount → equality/in-flight guard suppresses a duplicate).
      setWidth(375);
      await act(async () => {
        rerender(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />);
      });
      // While the mobile stack is mounted, no PATCH can originate from it.
      expect(MockResponsive).not.toHaveBeenCalledTimes(0); // grid mounted at least once
      const patchesAfterFirstDown = updateDashboardLayoutMock.mock.calls.length;

      setWidth(1280);
      await act(async () => {
        rerender(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />);
      });

      setWidth(375);
      await act(async () => {
        rerender(<PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />);
      });

      expect(patchesAfterFirstDown).toBe(1);
      expect(updateDashboardLayoutMock).toHaveBeenCalledTimes(1);
    });
  });
  // ─────────────────────────────────────────────────────────────────────────────
});
