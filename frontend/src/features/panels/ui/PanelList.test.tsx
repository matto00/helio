import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  createPanel as createPanelRequest,
  fetchPanels as fetchPanelsRequest,
} from "../services/panelService";
import { createDashboard as createDashboardRequest } from "../../dashboards/services/dashboardService";
import { renderWithStore } from "../../../test/renderWithStore";
import { PanelGrid } from "./PanelGrid";
import { PanelList } from "./PanelList";

// PanelCreationModal uses <dialog> showModal/close which jsdom doesn't implement.
// Stub showModal to set the `open` attribute so dialog contents are accessible.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

jest.mock("./PanelGrid", () => {
  const React = require("react") as typeof import("react");
  return {
    PanelGrid: jest.fn(
      ({ panels }: { panels: { id: string; title: string }[]; zoomLevel?: number }) =>
        React.createElement(
          "div",
          null,
          ...panels.map((p) =>
            React.createElement(
              "div",
              { key: p.id },
              React.createElement("h3", null, p.title),
              React.createElement("button", {
                type: "button",
                "aria-label": `Move ${p.title} panel`,
              }),
              React.createElement("button", {
                type: "button",
                "aria-label": `${p.title} panel actions`,
              }),
            ),
          ),
        ),
    ),
  };
});

const MockPanelGrid = jest.mocked(PanelGrid);

jest.mock("../services/panelService", () => ({
  createPanel: jest.fn(),
  fetchPanels: jest.fn(),
  updatePanelAppearance: jest.fn(),
}));

jest.mock("../../dashboards/services/dashboardService", () => ({
  createDashboard: jest.fn(),
}));

jest.mock("../../auth/services/authService", () => ({
  updateUserPreferencesRequest: jest.fn().mockResolvedValue({ accentColor: null, zoomLevels: {} }),
}));

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const defaultDashboardAppearance = {
  background: "transparent",
  gridBackground: "transparent",
};

const defaultDashboardLayout = {
  lg: [],
  md: [],
  sm: [],
  xs: [],
};

const defaultPanelAppearance = {
  background: "transparent",
  color: "inherit",
  transparency: 0,
};

const createPanelMock = jest.mocked(createPanelRequest);
const fetchPanelsMock = jest.mocked(fetchPanelsRequest);
const createDashboardMock = jest.mocked(createDashboardRequest);

/** Base dashboard store slice used by most tests. */
const baseDashboardsState = {
  items: [
    {
      id: "dashboard-1",
      name: "Operations",
      meta: defaultMeta,
      appearance: defaultDashboardAppearance,
      layout: defaultDashboardLayout,
    },
  ],
  selectedDashboardId: "dashboard-1",
};

/** Store additions required for data-bound types (metric/chart/table) which need a DataType step. */
const dataTypeStoreAdditions = {
  pipelines: {
    items: [
      {
        id: "pipe-1",
        name: "Revenue Pipeline",
        sourceDataSourceId: "src-1",
        sourceDataSourceName: "Source",
        outputDataTypeName: "Revenue",
        outputDataTypeId: "dt-1",
        lastRunStatus: null as null,
        lastRunAt: null,
        lastRunRowCount: null as null,
      },
    ],
    status: "succeeded" as const,
  },
  dataTypes: {
    items: [
      {
        id: "dt-1",
        name: "Revenue",
        sourceId: null,
        version: 1,
        fields: [],
        computedFields: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    status: "succeeded" as const,
  },
};

describe("PanelList", () => {
  beforeEach(() => {
    MockPanelGrid.mockClear();
    createPanelMock.mockReset();
    fetchPanelsMock.mockReset();
    createDashboardMock.mockReset();
  });

  it("renders a 'no dashboards yet' empty state once the dashboards fetch resolves to zero (F-201)", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [],
        selectedDashboardId: null,
        // HEL-528 evaluation-1.md CR3 — the empty-state CTA is only trustworthy
        // once the dashboards fetch has actually resolved; see the
        // "does not render the CTA while the dashboards fetch is in flight"
        // test below for the other half of this behavior.
        status: "succeeded",
      },
      panels: {
        items: [],
        status: "idle",
      },
    });

    expect(screen.getByText("No dashboards yet")).toBeInTheDocument();
    expect(
      screen.getByText("Create your first dashboard to start adding panels."),
    ).toBeInTheDocument();
  });

  it("does not render the 'No dashboards yet' CTA while the dashboards fetch is in flight (idle), and shows a skeleton instead (HEL-528 evaluation-1.md CR3)", () => {
    const { container } = renderWithStore(<PanelList />, {
      dashboards: {
        items: [],
        selectedDashboardId: null,
        status: "idle",
      },
      panels: {
        items: [],
        status: "idle",
      },
    });

    // No false "you have zero dashboards" claim while the dashboards fetch
    // has not yet resolved — and never a bare blank frame either (ticket
    // rule 6: "never render nothing during load"). `[aria-label="Loading
    // panels"]` (not `.panel-grid-shell`, evaluation-2.md non-blocking #5 —
    // that class is shared with the resolved `PanelGrid`, so it can't
    // distinguish "skeleton showing" from "resolved grid showing" in general,
    // even though it happens to be unambiguous in this specific state).
    expect(screen.queryByText("No dashboards yet")).not.toBeInTheDocument();
    expect(container.querySelector('[aria-label="Loading panels"]')).toBeInTheDocument();
  });

  it("does not render the 'No dashboards yet' CTA while the dashboards fetch is in flight (loading), and shows a skeleton instead (HEL-528 evaluation-1.md CR3)", () => {
    const { container } = renderWithStore(<PanelList />, {
      dashboards: {
        items: [],
        selectedDashboardId: null,
        status: "loading",
      },
      panels: {
        items: [],
        status: "idle",
      },
    });

    expect(screen.queryByText("No dashboards yet")).not.toBeInTheDocument();
    expect(container.querySelector('[aria-label="Loading panels"]')).toBeInTheDocument();
  });

  it("the 'no dashboards yet' empty state's CTA creates a dashboard (F-003)", async () => {
    createDashboardMock.mockResolvedValueOnce({
      id: "dashboard-new",
      name: "Untitled dashboard",
      meta: defaultMeta,
      appearance: defaultDashboardAppearance,
      layout: defaultDashboardLayout,
    });

    renderWithStore(<PanelList />, {
      dashboards: {
        items: [],
        selectedDashboardId: null,
        status: "succeeded",
      },
      panels: {
        items: [],
        status: "idle",
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));
      await waitFor(() => expect(createDashboardMock).toHaveBeenCalledWith("Untitled dashboard"));
    });
  });

  // HEL-548/HEL-770 D6/task 3.3/3.5 — a failed create renders the SAME
  // surface's error-intent treatment, carrying the thunk's own (D6) specific
  // message — not a hardcoded generic string. Driven through the rewired
  // CTA (useCreateDashboardAction's cta.onClick, task 3.2/4.3), not a
  // leftover local handler, so a hook that silently swallowed the rejection
  // would fail this test.
  it("a failed dashboard create from the empty state renders an announced, error-intent empty state carrying the specific rejection message (HEL-770)", async () => {
    createDashboardMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: "Workspace dashboard limit reached." } },
    });

    renderWithStore(<PanelList />, {
      dashboards: {
        items: [],
        selectedDashboardId: null,
        status: "succeeded",
      },
      panels: {
        items: [],
        status: "idle",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));
    await waitFor(() => expect(createDashboardMock).toHaveBeenCalled());

    const errorState = await screen.findByRole("alert");
    expect(within(errorState).getByText("Couldn't create dashboard")).toBeInTheDocument();
    expect(within(errorState).getByText("Workspace dashboard limit reached.")).toBeInTheDocument();
    // The ordinary neutral copy/title must NOT still be present alongside it.
    expect(screen.queryByText("No dashboards yet")).not.toBeInTheDocument();
  });

  it("the ordinary 'No dashboards yet' empty state stays neutral, with no alert role, when no create has failed", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [],
        selectedDashboardId: null,
        status: "succeeded",
      },
      panels: {
        items: [],
        status: "idle",
      },
    });

    expect(screen.getByText("No dashboards yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a 'select a dashboard' empty state when dashboards exist but none is selected (F-201)", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: null,
      },
      panels: {
        items: [],
        status: "idle",
      },
    });

    expect(screen.getByText("Select a dashboard")).toBeInTheDocument();
    expect(
      screen.getByText("Choose a dashboard from the sidebar to view its panels."),
    ).toBeInTheDocument();
  });

  it("renders an error fallback when panel loading fails", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "failed",
        error: "Failed to load panels.",
      },
    });

    expect(screen.getByText("Failed to load panels.")).toBeInTheDocument();
  });

  it("renders the empty-state message when a selected dashboard has no panels", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
    });

    const emptyState = screen.getByLabelText("No panels yet");
    expect(emptyState).toBeInTheDocument();
    expect(
      within(emptyState).getByText("Add a panel to start building your dashboard."),
    ).toBeInTheDocument();
    expect(within(emptyState).getByRole("button", { name: "Add panel" })).toBeInTheDocument();
  });

  it("clicking 'Add panel' in the empty state opens the creation modal", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
    });

    const emptyState = screen.getByLabelText("No panels yet");
    fireEvent.click(within(emptyState).getByRole("button", { name: "Add panel" }));

    // Modal type-select step is shown
    expect(screen.getByRole("button", { name: "Metric" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chart" })).toBeInTheDocument();
  });

  it("clicking 'Add panel' header button opens the creation modal at type-select step", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: { items: [], loadedDashboardId: "dashboard-1", status: "succeeded" },
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);

    // Modal is open at type-select step — no radio buttons, type cards instead
    expect(screen.queryByRole("radio", { name: "Metric" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Metric" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chart" })).toBeInTheDocument();
  });

  it("selecting metric and submitting calls createPanel with type metric", async () => {
    createPanelMock.mockResolvedValue({
      id: "panel-2",
      dashboardId: "dashboard-1",
      title: "New Panel",
      type: "metric" as const,
      meta: defaultMeta,
      appearance: defaultPanelAppearance,
      config: { dataTypeId: "dt-1", fieldMapping: {} },
    });
    fetchPanelsMock.mockResolvedValue([]);

    renderWithStore(<PanelList />, {
      dashboards: baseDashboardsState,
      panels: { items: [], loadedDashboardId: "dashboard-1", status: "succeeded" },
      ...dataTypeStoreAdditions,
    });

    // Open modal, select metric type, select DataType, enter title, submit
    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    // Metric is data-bound — navigate through the DataType step
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "New Panel" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith(
        "dashboard-1",
        "New Panel",
        "metric",
        undefined,
        "dt-1",
      ),
    );
  });

  it("selecting chart and submitting calls createPanel with type chart", async () => {
    createPanelMock.mockResolvedValue({
      id: "panel-2",
      dashboardId: "dashboard-1",
      title: "Revenue Chart",
      type: "chart" as const,
      meta: defaultMeta,
      appearance: defaultPanelAppearance,
      config: { dataTypeId: "dt-1", fieldMapping: {} },
    });
    fetchPanelsMock.mockResolvedValue([]);

    renderWithStore(<PanelList />, {
      dashboards: baseDashboardsState,
      panels: { items: [], loadedDashboardId: "dashboard-1", status: "succeeded" },
      ...dataTypeStoreAdditions,
    });

    // Open modal, select chart type, select DataType, enter title, submit
    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    // Chart is data-bound — navigate through the DataType step
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "Revenue Chart" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith(
        "dashboard-1",
        "Revenue Chart",
        "chart",
        undefined,
        "dt-1",
      ),
    );
  });

  it("modal resets to type-select step after successful create", async () => {
    createPanelMock.mockResolvedValue({
      id: "panel-2",
      dashboardId: "dashboard-1",
      title: "Table Panel",
      type: "table" as const,
      meta: defaultMeta,
      appearance: defaultPanelAppearance,
      config: { dataTypeId: "dt-1", fieldMapping: {} },
    });
    fetchPanelsMock.mockResolvedValue([]);

    renderWithStore(<PanelList />, {
      dashboards: baseDashboardsState,
      panels: { items: [], loadedDashboardId: "dashboard-1", status: "succeeded" },
      ...dataTypeStoreAdditions,
    });

    // Open modal, select table, navigate DataType step, create
    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    // Table is data-bound — navigate through the DataType step
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Table Panel" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() => expect(createPanelMock).toHaveBeenCalled());

    // Reopen modal — should start at type-select step with no pre-selection
    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    expect(screen.getByRole("button", { name: "Metric" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Panel title")).not.toBeInTheDocument();
  });

  // HEL-548 D5a/task 4.2a/4.2b — a slice flag outlives the component that set
  // it, unlike the `useState` this replaced. Reachable defect: open the
  // modal → Cmd/Ctrl+K → navigate away → PanelList unmounts with the flag
  // still `true` → returning to `/` reopens the modal unbidden (browser Back
  // hits the same path). Locked by remounting PanelList against the SAME
  // store (via `rerender`, which reuses `renderWithStore`'s one Provider/
  // store instance) with the flag preset `true`.
  describe("panel-creation modal flag reset on unmount (HEL-548 D5a)", () => {
    it("does not reopen the modal on a fresh mount after a prior instance unmounted with the flag left true", () => {
      const { rerender } = renderWithStore(<PanelList />, {
        dashboards: baseDashboardsState,
        panels: {
          items: [],
          loadedDashboardId: "dashboard-1",
          status: "succeeded",
          panelCreationModalOpen: true,
        },
      });

      // Sanity: the preset flag really does open the modal on first mount —
      // proves the probe can detect "modal open" at all before trusting a
      // later "not open" reading.
      expect(screen.getByRole("button", { name: "Metric" })).toBeInTheDocument();

      // Unmount PanelList (fires its cleanup effect) — the store persists
      // (same Provider instance) — then mount a FRESH PanelList instance.
      rerender(<></>);
      rerender(<PanelList />);

      expect(screen.queryByRole("button", { name: "Metric" })).not.toBeInTheDocument();
    });
  });

  it("renders panel content inside the dashboard grid foundation", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [
          {
            id: "panel-1",
            dashboardId: "dashboard-1",
            title: "Revenue Pulse",
            type: "metric" as const,
            meta: defaultMeta,
            appearance: defaultPanelAppearance,
          },
        ],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
    });

    expect(screen.getByRole("heading", { name: "Revenue Pulse" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Revenue Pulse panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revenue Pulse panel actions" })).toBeInTheDocument();
  });

  // ── HEL-528 — grid skeleton (design.md D10/D11/D12) ────────────────────────
  describe("grid skeleton (HEL-528)", () => {
    it("renders skeleton placeholders inside the zoom container while the selected dashboard's panels are loading", () => {
      const { container } = renderWithStore(<PanelList />, {
        dashboards: baseDashboardsState,
        panels: { items: [], loadedDashboardId: null, status: "loading" },
      });

      expect(container.querySelector('[aria-label="Loading panels"]')).toBeInTheDocument();
      expect(
        container.querySelector(".panel-list__zoom-container .ui-skeleton"),
      ).toBeInTheDocument();
      expect(screen.queryByText("No panels yet")).not.toBeInTheDocument();
    });

    // 6.8a / skeptic-final-1.md CR2 — the "N panels" pill must not read a
    // literal count while the count itself is not yet trustworthy data.
    it("6.8a — the panel-count pill shows a skeleton, not a literal '0 panels', while the selected dashboard's panels are loading", () => {
      const { container } = renderWithStore(<PanelList />, {
        dashboards: baseDashboardsState,
        panels: { items: [], loadedDashboardId: null, status: "loading" },
      });

      expect(container.querySelector(".panel-list__count .ui-skeleton")).toBeInTheDocument();
      expect(screen.queryByText("0 panels")).not.toBeInTheDocument();
    });

    // skeptic-final-1.md CR2 — the SAME defect reopened on the CR3 bootstrap
    // path: `showBootstrapSkeleton` (no dashboard selected yet, dashboards
    // fetch in flight) put the grid skeleton up a second way without the
    // pill's gate covering it, so a cold boot showed a literal "0 panels"
    // above the three-card bootstrap skeleton on every load.
    it("CR3 bootstrap window — the panel-count pill shows a skeleton, not a literal '0 panels', while the dashboards fetch is in flight and none is selected yet", () => {
      const { container } = renderWithStore(<PanelList />, {
        dashboards: { items: [], selectedDashboardId: null, status: "loading" },
        panels: { items: [], status: "idle" },
      });

      expect(container.querySelector(".panel-list__count .ui-skeleton")).toBeInTheDocument();
      expect(screen.queryByText("0 panels")).not.toBeInTheDocument();
    });

    // HEL-548 D2a — HEL-528 task 6.5c-ii assigned closing this gap to
    // HEL-548 by name. INVERTED, not deleted: the sibling "no skeleton"
    // assertion is kept unchanged (D2 must not regress it) — only the
    // "No panels yet" assertion flips, from "must not render" to "must
    // render", because this ticket's own headline criterion ("no section
    // renders blank") requires the terminal post-delete state to show the
    // empty state instead of nothing at all.
    it("D11 mirror-image, INVERTED (HEL-548 D2a) — status idle with a dashboard selected, staleDashboardId matching it (post-delete terminal state) renders the empty state, still no skeleton", () => {
      const { container } = renderWithStore(<PanelList />, {
        dashboards: baseDashboardsState,
        // markDashboardPanelsStale's terminal state: status back to "idle",
        // loadedDashboardId cleared, items emptied, staleDashboardId recorded
        // as the invalidated dashboard, nothing scheduled to refetch
        // (panelsSlice.ts's markDashboardPanelsStale reducer).
        panels: {
          items: [],
          loadedDashboardId: null,
          status: "idle",
          staleDashboardId: "dashboard-1",
        },
      });

      expect(container.querySelector(".ui-skeleton")).not.toBeInTheDocument();
      // HEL-528 design.md D11 traced this §7 gap and named HEL-548 as its
      // owner; HEL-548 D1/D2 closes it via the staleDashboardId
      // discriminator.
      const emptyState = screen.getByLabelText("No panels yet");
      expect(emptyState).toBeInTheDocument();
      expect(within(emptyState).getByRole("button", { name: "Add panel" })).toBeInTheDocument();
    });

    // HEL-548 task 2.5 — the OTHER half of the same `idle` state: no
    // staleDashboardId recorded for this dashboard, so a fetch is provably
    // about to be dispatched (App.tsx's mount/selection effect) — the
    // skeleton must render, not the empty state, or a page load would flash
    // "No panels yet" for one frame before the real panels arrive.
    it("pre-dispatch idle frame (HEL-548 D2) — status idle, staleDashboardId NOT matching the selected dashboard, renders the skeleton, not the empty state", () => {
      const { container } = renderWithStore(<PanelList />, {
        dashboards: baseDashboardsState,
        panels: { items: [], loadedDashboardId: null, status: "idle", staleDashboardId: null },
      });

      expect(
        container.querySelector(".panel-list__zoom-container .ui-skeleton"),
      ).toBeInTheDocument();
      expect(screen.queryByText("No panels yet")).not.toBeInTheDocument();
    });

    it("D12 — selecting a different dashboard renders the skeleton instead of the previous dashboard's panels", () => {
      const { container } = renderWithStore(<PanelList />, {
        dashboards: {
          items: [
            ...baseDashboardsState.items,
            {
              id: "dashboard-2",
              name: "Executive",
              meta: defaultMeta,
              appearance: defaultDashboardAppearance,
              layout: defaultDashboardLayout,
            },
          ],
          // The newly-selected dashboard...
          selectedDashboardId: "dashboard-2",
        },
        panels: {
          // ...but `items` still holds the PREVIOUS dashboard's panels —
          // `fetchPanels.pending` does not clear them.
          items: [
            {
              id: "panel-1",
              dashboardId: "dashboard-1",
              title: "Revenue Pulse",
              type: "metric" as const,
              meta: defaultMeta,
              appearance: defaultPanelAppearance,
            },
          ],
          loadedDashboardId: "dashboard-1",
          status: "loading",
        },
      });

      expect(container.querySelector(".ui-skeleton")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Revenue Pulse" })).not.toBeInTheDocument();
    });

    it("a refetch of the SAME dashboard keeps rendering its panels instead of the skeleton", () => {
      const { container } = renderWithStore(<PanelList />, {
        dashboards: baseDashboardsState,
        panels: {
          items: [
            {
              id: "panel-1",
              dashboardId: "dashboard-1",
              title: "Revenue Pulse",
              type: "metric" as const,
              meta: defaultMeta,
              appearance: defaultPanelAppearance,
            },
          ],
          loadedDashboardId: "dashboard-1",
          status: "loading",
        },
      });

      expect(container.querySelector(".ui-skeleton")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Revenue Pulse" })).toBeInTheDocument();
    });
  });

  it("creates a panel via modal and refreshes selected dashboard panels", async () => {
    createPanelMock.mockResolvedValue({
      id: "panel-2",
      dashboardId: "dashboard-1",
      title: "Forecast",
      type: "metric" as const,
      meta: defaultMeta,
      appearance: defaultPanelAppearance,
      config: { dataTypeId: "", fieldMapping: {} },
    });
    fetchPanelsMock.mockResolvedValue([
      {
        id: "panel-1",
        dashboardId: "dashboard-1",
        title: "Revenue Pulse",
        type: "metric" as const,
        meta: defaultMeta,
        appearance: defaultPanelAppearance,
        config: { dataTypeId: "", fieldMapping: {} },
      },
      {
        id: "panel-2",
        dashboardId: "dashboard-1",
        title: "Forecast",
        type: "metric" as const,
        meta: defaultMeta,
        appearance: defaultPanelAppearance,
        config: { dataTypeId: "", fieldMapping: {} },
      },
    ]);

    renderWithStore(<PanelList />, {
      dashboards: baseDashboardsState,
      panels: {
        items: [
          {
            id: "panel-1",
            dashboardId: "dashboard-1",
            title: "Revenue Pulse",
            type: "metric" as const,
            meta: defaultMeta,
            appearance: defaultPanelAppearance,
          },
        ],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      ...dataTypeStoreAdditions,
    });

    // Open modal, select type, navigate DataType step, enter title, submit
    fireEvent.click(screen.getByRole("button", { name: "Add panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    // Metric is data-bound — navigate through the DataType step
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Forecast" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith(
        "dashboard-1",
        "Forecast",
        "metric",
        undefined,
        "dt-1",
      ),
    );
    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("dashboard-1"));
    expect(screen.getByRole("heading", { name: "Forecast" })).toBeInTheDocument();
  });

  it("zoom controls appear when a dashboard is selected", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      auth: {
        status: "authenticated",
        currentUser: {
          id: "user-1",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: null,
          tier: "free",
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    });

    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();

    // HEL-718: these icon-only zoom controls already had aria-label; this
    // locks in the added visible title tooltip pairing it.
    expect(screen.getByRole("button", { name: "Zoom in" })).toHaveAttribute("title", "Zoom in");
    expect(screen.getByRole("button", { name: "Zoom out" })).toHaveAttribute("title", "Zoom out");
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveAttribute(
      "title",
      "Reset zoom",
    );
  });

  it("clicking zoom in increases the zoom level", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      auth: {
        status: "authenticated",
        currentUser: {
          id: "user-1",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: null,
          tier: "free",
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeInTheDocument();
  });

  it("clicking zoom out decreases the zoom level", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      auth: {
        status: "authenticated",
        currentUser: {
          id: "user-1",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: null,
          tier: "free",
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("zoom container receives scale transform and compensated dimensions when zoom is non-default", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [
          {
            id: "panel-1",
            dashboardId: "dashboard-1",
            title: "Revenue Pulse",
            type: "metric" as const,
            meta: defaultMeta,
            appearance: defaultPanelAppearance,
          },
        ],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      auth: {
        status: "authenticated",
        currentUser: {
          id: "user-1",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: null,
          tier: "free",
          createdAt: "2026-01-01T00:00:00Z",
          preferences: {
            accentColor: null,
            zoomLevels: { "dashboard-1": 1.5 },
          },
        },
      },
    });

    const zoomContainer = document.querySelector(".panel-list__zoom-container") as HTMLElement;
    expect(zoomContainer).not.toBeNull();
    expect(zoomContainer.style.transform).toBe("scale(1.5)");
    expect(zoomContainer.style.transformOrigin).toBe("top left");
    expect(zoomContainer.style.width).toBe(`${100 / 1.5}%`);
    expect(zoomContainer.style.height).toBe(`${100 / 1.5}%`);
  });

  it("zoom level is restored from user preferences when a dashboard is selected", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      auth: {
        status: "authenticated",
        currentUser: {
          id: "user-1",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: null,
          tier: "free",
          createdAt: "2026-01-01T00:00:00Z",
          preferences: {
            accentColor: null,
            zoomLevels: { "dashboard-1": 1.7 },
          },
        },
      },
    });

    expect(screen.getByText("170%")).toBeInTheDocument();
  });

  describe("zoom gesture (Ctrl+scroll and pinch)", () => {
    const gestureStore = {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [
          {
            id: "panel-1",
            dashboardId: "dashboard-1",
            title: "Revenue Pulse",
            type: "metric" as const,
            meta: defaultMeta,
            appearance: defaultPanelAppearance,
          },
        ],
        loadedDashboardId: "dashboard-1",
        status: "succeeded" as const,
      },
    };

    it("Ctrl+scroll down (deltaY=100) decreases zoom by 0.1", () => {
      const { container } = renderWithStore(<PanelList />, gestureStore);
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      expect(screen.getByText("100%")).toBeInTheDocument();
      fireEvent.wheel(zoomContainer, { deltaY: 100, ctrlKey: true, deltaMode: 0 });
      expect(screen.getByText("90%")).toBeInTheDocument();
    });

    it("Ctrl+scroll up (deltaY=-100) increases zoom by 0.1", () => {
      const { container } = renderWithStore(<PanelList />, gestureStore);
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      fireEvent.wheel(zoomContainer, { deltaY: -100, ctrlKey: true, deltaMode: 0 });
      expect(screen.getByText("110%")).toBeInTheDocument();
    });

    it("plain scroll (no modifier key) does not change zoom level", () => {
      const { container } = renderWithStore(<PanelList />, gestureStore);
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      fireEvent.wheel(zoomContainer, { deltaY: 100, ctrlKey: false, deltaMode: 0 });
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("zoom is clamped at 0.5 minimum (Ctrl+scroll down at min)", () => {
      const { container } = renderWithStore(<PanelList />, {
        ...gestureStore,
        auth: {
          status: "authenticated" as const,
          currentUser: {
            id: "user-1",
            email: "test@example.com",
            displayName: "Test User",
            avatarUrl: null,
            tier: "free",
            createdAt: "2026-01-01T00:00:00Z",
            preferences: { accentColor: null, zoomLevels: { "dashboard-1": 0.5 } },
          },
        },
      });
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      expect(screen.getByText("50%")).toBeInTheDocument();
      fireEvent.wheel(zoomContainer, { deltaY: 100, ctrlKey: true, deltaMode: 0 });
      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("zoom is clamped at 2.0 maximum (Ctrl+scroll up at max)", () => {
      const { container } = renderWithStore(<PanelList />, {
        ...gestureStore,
        auth: {
          status: "authenticated" as const,
          currentUser: {
            id: "user-1",
            email: "test@example.com",
            displayName: "Test User",
            avatarUrl: null,
            tier: "free",
            createdAt: "2026-01-01T00:00:00Z",
            preferences: { accentColor: null, zoomLevels: { "dashboard-1": 2.0 } },
          },
        },
      });
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      expect(screen.getByText("200%")).toBeInTheDocument();
      fireEvent.wheel(zoomContainer, { deltaY: -100, ctrlKey: true, deltaMode: 0 });
      expect(screen.getByText("200%")).toBeInTheDocument();
    });

    it("deltaMode=1 (line) wheel event is normalized correctly (deltaY=1 line to 24px effective)", () => {
      const { container } = renderWithStore(<PanelList />, gestureStore);
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      fireEvent.wheel(zoomContainer, { deltaY: 5, ctrlKey: true, deltaMode: 1 });
      expect(screen.getByText("90%")).toBeInTheDocument();
    });
  });

  it("passes updated zoomLevel to PanelGrid when zoom controls are used", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [
          {
            id: "panel-1",
            dashboardId: "dashboard-1",
            title: "Revenue Pulse",
            type: "metric" as const,
            meta: defaultMeta,
            appearance: defaultPanelAppearance,
          },
        ],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      auth: {
        status: "authenticated",
        currentUser: {
          id: "user-1",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: null,
          tier: "free",
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    });

    const initialCall = MockPanelGrid.mock.calls[MockPanelGrid.mock.calls.length - 1][0];
    expect(initialCall.zoomLevel).toBe(1.0);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    const afterZoomIn = MockPanelGrid.mock.calls[MockPanelGrid.mock.calls.length - 1][0];
    expect(afterZoomIn.zoomLevel).toBeCloseTo(1.1);

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));

    const afterZoomOut = MockPanelGrid.mock.calls[MockPanelGrid.mock.calls.length - 1][0];
    expect(afterZoomOut.zoomLevel).toBeCloseTo(0.9);
  });

  it("image option appears in the modal type picker", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: { items: [], loadedDashboardId: "dashboard-1", status: "succeeded" },
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);

    expect(screen.getByRole("button", { name: "Image" })).toBeInTheDocument();
  });
});
