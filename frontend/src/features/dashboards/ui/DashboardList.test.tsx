import { fireEvent, screen, within } from "@testing-library/react";
import { waitFor } from "@testing-library/react";

import {
  createDashboard as createDashboardRequest,
  deleteDashboard as deleteDashboardRequest,
  duplicateDashboard as duplicateDashboardRequest,
  renameDashboard as renameDashboardRequest,
} from "../services/dashboardService";
import { renderWithStore } from "../../../test/renderWithStore";
import { DashboardList } from "./DashboardList";

jest.mock("../services/dashboardService", () => ({
  createDashboard: jest.fn(),
  deleteDashboard: jest.fn(),
  duplicateDashboard: jest.fn(),
  fetchDashboards: jest.fn(),
  renameDashboard: jest.fn(),
  updateDashboardAppearance: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const createDashboardMock = jest.mocked(createDashboardRequest);
const deleteDashboardMock = jest.mocked(deleteDashboardRequest);
const duplicateDashboardMock = jest.mocked(duplicateDashboardRequest);
const renameDashboardMock = jest.mocked(renameDashboardRequest);

function openActionsMenu(dashboardName: string) {
  fireEvent.click(screen.getByRole("button", { name: `${dashboardName} actions` }));
}

describe("DashboardList", () => {
  beforeEach(() => {
    createDashboardMock.mockReset();
    deleteDashboardMock.mockReset();
    duplicateDashboardMock.mockReset();
    renameDashboardMock.mockReset();
  });

  it("renders the dashboards heading and backend-backed dashboard items from state", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [{ id: "dashboard-1", name: "Operations", meta: defaultMeta }],
        status: "succeeded",
      },
      panels: {
        items: [],
      },
    });

    expect(screen.getByRole("heading", { name: "Dashboards" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();
  });

  it("renders shape-matched skeleton rows while dashboards are loading (HEL-528)", () => {
    const { container } = renderWithStore(<DashboardList />, {
      dashboards: {
        items: [],
        status: "loading",
      },
      panels: {
        items: [],
      },
    });

    expect(screen.queryByText(/loading dashboards/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".ui-skeleton").length).toBeGreaterThan(0);
    expect(
      container.querySelector('.dashboard-list__items[aria-label="Loading dashboards…"]'),
    ).toBeInTheDocument();
    expect(screen.queryByText("No dashboards yet")).not.toBeInTheDocument();
  });

  it("renders the skeleton on the pre-dispatch idle frame too, not the empty state (D11)", () => {
    const { container } = renderWithStore(<DashboardList />, {
      dashboards: {
        items: [],
        status: "idle",
      },
      panels: {
        items: [],
      },
    });

    expect(container.querySelectorAll(".ui-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("No dashboards yet")).not.toBeInTheDocument();
  });

  it("keeps rendering existing dashboards during a refetch instead of flashing a skeleton (D4)", () => {
    const { container } = renderWithStore(<DashboardList />, {
      dashboards: {
        items: [{ id: "dashboard-1", name: "Operations", meta: defaultMeta }],
        status: "loading",
      },
      panels: {
        items: [],
      },
    });

    expect(container.querySelectorAll(".ui-skeleton").length).toBe(0);
    expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();
  });

  it("updates the selected dashboard when a dashboard is clicked", () => {
    const { store } = renderWithStore(<DashboardList />, {
      dashboards: {
        items: [
          { id: "dashboard-1", name: "Operations", meta: defaultMeta },
          { id: "dashboard-2", name: "Executive", meta: defaultMeta },
        ],
        selectedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      panels: {
        items: [],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Executive" }));

    expect(store.getState().dashboards.selectedDashboardId).toBe("dashboard-2");
    expect(screen.getByRole("button", { name: "Executive" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("creates a dashboard inline and selects it", async () => {
    createDashboardMock.mockResolvedValue({
      id: "dashboard-2",
      name: "Executive",
      meta: defaultMeta,
      appearance: {
        background: "transparent",
        gridBackground: "transparent",
      },
      layout: {
        lg: [],
        md: [],
        sm: [],
        xs: [],
      },
    });

    const { store } = renderWithStore(<DashboardList />, {
      dashboards: {
        items: [{ id: "dashboard-1", name: "Operations", meta: defaultMeta }],
        selectedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      panels: {
        items: [],
      },
    });

    // HEL-718: the add-dashboard toggle migrated onto the shared IconButton
    // primitive — verifies the visible tooltip survived alongside the
    // accessible name.
    const addButton = screen.getByRole("button", { name: "Add dashboard" });
    expect(addButton).toHaveAttribute("title", "Add dashboard");
    fireEvent.click(addButton);
    fireEvent.change(screen.getByLabelText("Dashboard name"), {
      target: { value: "Executive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create dashboard" }));

    await waitFor(() => expect(createDashboardMock).toHaveBeenCalledWith("Executive"));
    await waitFor(() =>
      expect(store.getState().dashboards.selectedDashboardId).toBe("dashboard-2"),
    );
    expect(screen.getByRole("button", { name: "Executive" })).toBeInTheDocument();
  });

  // HEL-548/HEL-770 D6/D6a/task 3.4/3.5 — raised to InlineError's "banner"
  // variant (role="alert" + lucide error icon) and now binds the thunk's
  // own (D6) specific rejection message instead of a hardcoded string —
  // the bar `toast-emission-integrity` requires before the
  // createDashboard.rejected toast could be removed (task 3.6).
  it("a failed inline create renders an announced (role=alert), error-intent banner carrying the specific rejection message", async () => {
    createDashboardMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: "Workspace dashboard limit reached." } },
    });

    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [{ id: "dashboard-1", name: "Operations", meta: defaultMeta }],
        selectedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      panels: { items: [] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add dashboard" }));
    fireEvent.change(screen.getByLabelText("Dashboard name"), {
      target: { value: "Executive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create dashboard" }));

    const errorBanner = await screen.findByRole("alert");
    expect(within(errorBanner).getByText("Workspace dashboard limit reached.")).toBeInTheDocument();
  });

  // HEL-548 D3/task 6.1/6.4/6.5 — DashboardList's filter branch had NO test
  // at all before this change (design.md's own note). Per task 6.5, the
  // active dashboard is pinned outside the filter (see
  // "active dashboard remains visible" above), so reaching a true zero-row
  // filtered state requires no dashboard selected.
  it("a filter matching no dashboards renders the filtered empty state, not the bare 'No matches' paragraph", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [
          { id: "dashboard-1", name: "Operations", meta: defaultMeta },
          { id: "dashboard-2", name: "Executive", meta: defaultMeta },
        ],
        selectedDashboardId: null,
        status: "succeeded",
      },
      panels: { items: [] },
    });

    fireEvent.change(screen.getByLabelText("Filter dashboards by name"), {
      target: { value: "zzz-no-match" },
    });

    // aria-label={title} on the neutral EmptyState root — scopes past the
    // filter input's OWN "Clear filter" icon button, which shares the exact
    // same accessible name as the EmptyState's CTA (same action, same name).
    const filteredState = screen.getByLabelText("No matches");
    expect(
      within(filteredState).getByText('No dashboards match "zzz-no-match".'),
    ).toBeInTheDocument();
    // No create-dashboard CTA on the filtered branch — it doesn't resolve a
    // query that matched nothing (D3).
    expect(
      within(filteredState).queryByRole("button", { name: "New dashboard" }),
    ).not.toBeInTheDocument();
    expect(within(filteredState).getByRole("button", { name: "Clear filter" })).toBeInTheDocument();
  });

  it("clearing the query from the filtered empty state's own CTA restores the list", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [
          { id: "dashboard-1", name: "Operations", meta: defaultMeta },
          { id: "dashboard-2", name: "Executive", meta: defaultMeta },
        ],
        selectedDashboardId: null,
        status: "succeeded",
      },
      panels: { items: [] },
    });

    fireEvent.change(screen.getByLabelText("Filter dashboards by name"), {
      target: { value: "zzz-no-match" },
    });
    const filteredState = screen.getByLabelText("No matches");

    fireEvent.click(within(filteredState).getByRole("button", { name: "Clear filter" }));

    expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Executive" })).toBeInTheDocument();
  });

  it("zero dashboards with no filter query keeps the first-run empty state, not the filtered wording", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [],
        selectedDashboardId: null,
        status: "succeeded",
      },
      panels: { items: [] },
    });

    expect(screen.getByText("No dashboards yet")).toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  it("typing in filter input narrows the dashboard list", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [
          { id: "dashboard-1", name: "Operations", meta: defaultMeta },
          { id: "dashboard-2", name: "Executive", meta: defaultMeta },
          { id: "dashboard-3", name: "Marketing", meta: defaultMeta },
        ],
        selectedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      panels: {
        items: [],
      },
    });

    const filterInput = screen.getByLabelText("Filter dashboards by name");

    expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Executive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marketing" })).toBeInTheDocument();

    // Filter to only show items containing "exec"
    fireEvent.change(filterInput, { target: { value: "exec" } });

    expect(screen.getByRole("button", { name: "Executive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marketing" })).not.toBeInTheDocument();
    // Operations is still visible because it's the active dashboard
    expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();
  });

  it("active dashboard remains visible even when filter does not match its name, with --outside-filter class applied", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [
          { id: "dashboard-1", name: "Operations", meta: defaultMeta },
          { id: "dashboard-2", name: "Executive", meta: defaultMeta },
          { id: "dashboard-3", name: "Marketing", meta: defaultMeta },
        ],
        selectedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      panels: {
        items: [],
      },
    });

    const filterInput = screen.getByLabelText("Filter dashboards by name");

    // Filter to only show items containing "exec"
    fireEvent.change(filterInput, { target: { value: "exec" } });

    expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();

    // Find the list item containing the Operations button
    const operationsButton = screen.getByRole("button", { name: "Operations" });
    const listItem = operationsButton.closest("li");

    expect(listItem).toHaveClass("dashboard-list__item--outside-filter");
  });

  it("clicking the clear button resets the filter and restores all items", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [
          { id: "dashboard-1", name: "Operations", meta: defaultMeta },
          { id: "dashboard-2", name: "Executive", meta: defaultMeta },
          { id: "dashboard-3", name: "Marketing", meta: defaultMeta },
        ],
        selectedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      panels: {
        items: [],
      },
    });

    const filterInput = screen.getByLabelText("Filter dashboards by name");

    // Filter to only show items containing "exec"
    fireEvent.change(filterInput, { target: { value: "exec" } });

    expect(screen.queryByRole("button", { name: "Marketing" })).not.toBeInTheDocument();

    const clearButton = screen.getByRole("button", { name: "Clear filter" });
    // HEL-718: this icon-only control already had aria-label; this locks in
    // the added visible title tooltip pairing it.
    expect(clearButton).toHaveAttribute("title", "Clear filter");
    fireEvent.click(clearButton);

    expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Executive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marketing" })).toBeInTheDocument();
  });

  it("active dashboard is pinned first and matches follow when filtering", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [
          { id: "dashboard-1", name: "Alpha", meta: defaultMeta },
          { id: "dashboard-2", name: "Beta Executive", meta: defaultMeta },
          { id: "dashboard-3", name: "Gamma Executive", meta: defaultMeta },
        ],
        selectedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      panels: { items: [] },
    });

    fireEvent.change(screen.getByLabelText("Filter dashboards by name"), {
      target: { value: "exec" },
    });

    const buttons = screen.getAllByRole("button", {
      name: /^(Alpha|Beta Executive|Gamma Executive)$/,
    });
    expect(buttons[0]).toHaveAccessibleName("Alpha");
    expect(buttons[1]).toHaveAccessibleName("Beta Executive");
    expect(buttons[2]).toHaveAccessibleName("Gamma Executive");
  });

  it("clear button is not rendered when filter is empty", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [
          { id: "dashboard-1", name: "Operations", meta: defaultMeta },
          { id: "dashboard-2", name: "Executive", meta: defaultMeta },
        ],
        selectedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      panels: {
        items: [],
      },
    });

    // Clear button should not be present initially
    expect(screen.queryByRole("button", { name: "Clear filter" })).not.toBeInTheDocument();

    const filterInput = screen.getByLabelText("Filter dashboards by name");
    fireEvent.change(filterInput, { target: { value: "exec" } });

    expect(screen.getByRole("button", { name: "Clear filter" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));

    expect(screen.queryByRole("button", { name: "Clear filter" })).not.toBeInTheDocument();
  });

  // F-029 — the active-filtered-out badge used to be an absolutely-positioned
  // `::after` pseudo-element pinned at a fixed offset, independent of the
  // name's own truncating flex box, so a long enough name rendered under it.
  // It's now a real DOM sibling inside `.dashboard-list__name-group`, so the
  // name (min-width: 0, ellipsis) truncates around it instead.
  it("renders the outside-filter badge as a real sibling of the dashboard name, not a pseudo-element", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [
          { id: "dashboard-1", name: "Operations", meta: defaultMeta },
          { id: "dashboard-2", name: "Executive", meta: defaultMeta },
        ],
        selectedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      panels: { items: [] },
    });

    fireEvent.change(screen.getByLabelText("Filter dashboards by name"), {
      target: { value: "exec" },
    });

    const operationsButton = screen.getByRole("button", { name: "Operations" });
    const nameGroup = operationsButton.querySelector(".dashboard-list__name-group");
    expect(nameGroup).not.toBeNull();
    const badge = nameGroup?.querySelector(".dashboard-list__pinned-badge");
    expect(badge).toHaveTextContent("active");
    // A real sibling, not a pseudo-element: it's an actual DOM node alongside
    // `.dashboard-list__name` rather than CSS-generated content.
    expect(badge?.previousElementSibling).toHaveClass("dashboard-list__name");
  });

  // F-031 — Rename/Duplicate/Delete used to dispatch and never check the
  // result, so a rejected request left the UI looking like nothing happened.
  describe("F-031: dashboard action failures are surfaced, not swallowed", () => {
    function renderTwoDashboards() {
      return renderWithStore(<DashboardList />, {
        dashboards: {
          items: [
            { id: "dashboard-1", name: "Operations", meta: defaultMeta },
            { id: "dashboard-2", name: "Executive", meta: defaultMeta },
          ],
          selectedDashboardId: "dashboard-1",
          status: "succeeded",
        },
        panels: { items: [] },
      });
    }

    it("keeps the row in edit mode and shows an error when rename is rejected", async () => {
      renameDashboardMock.mockRejectedValue(new Error("network down"));
      renderTwoDashboards();

      openActionsMenu("Operations");
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

      const input = screen.getByLabelText("Dashboard name");
      fireEvent.change(input, { target: { value: "Ops Renamed" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(renameDashboardMock).toHaveBeenCalled());
      // The rename input is still present (not silently closed) and the
      // failure is visible next to it.
      await waitFor(() =>
        expect(screen.getByText("Failed to rename dashboard.")).toBeInTheDocument(),
      );
      // Rename stays in edit mode on failure (matches SidebarItemList's
      // contract) rather than silently closing as if it had saved.
      expect(screen.getByLabelText("Dashboard name")).toHaveValue("Ops Renamed");
    });

    it("keeps the confirm row open and shows an error when delete is rejected", async () => {
      deleteDashboardMock.mockRejectedValue(new Error("network down"));
      renderTwoDashboards();

      openActionsMenu("Operations");
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => expect(deleteDashboardMock).toHaveBeenCalledWith("dashboard-1"));
      await waitFor(() =>
        expect(screen.getByText("Failed to delete dashboard.")).toBeInTheDocument(),
      );
      // The dashboard was not removed and the confirm row is still open.
      expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    });

    it("shows an inline error when duplicate is rejected", async () => {
      duplicateDashboardMock.mockRejectedValue(new Error("network down"));
      renderTwoDashboards();

      openActionsMenu("Operations");
      fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

      await waitFor(() => expect(duplicateDashboardMock).toHaveBeenCalledWith("dashboard-1"));
      await waitFor(() =>
        expect(screen.getByText("Failed to duplicate dashboard.")).toBeInTheDocument(),
      );
    });
  });
});
