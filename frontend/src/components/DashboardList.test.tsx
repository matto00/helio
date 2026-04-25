import { fireEvent, screen } from "@testing-library/react";
import { waitFor } from "@testing-library/react";

import { createDashboard as createDashboardRequest } from "../services/dashboardService";
import { renderWithStore } from "../test/renderWithStore";
import { DashboardList } from "./DashboardList";

jest.mock("../services/dashboardService", () => ({
  createDashboard: jest.fn(),
  fetchDashboards: jest.fn(),
  updateDashboardAppearance: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const createDashboardMock = jest.mocked(createDashboardRequest);

describe("DashboardList", () => {
  beforeEach(() => {
    createDashboardMock.mockReset();
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

  it("renders a loading fallback while dashboards are loading", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [],
        status: "loading",
      },
      panels: {
        items: [],
      },
    });

    expect(screen.getByText("Loading dashboards...")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Add dashboard" }));
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

    // Initially all dashboards are visible
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

    // Active dashboard (Operations) remains visible
    expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();

    // Find the list item containing the Operations button
    const operationsButton = screen.getByRole("button", { name: "Operations" });
    const listItem = operationsButton.closest("li");

    // Verify it has the --outside-filter class
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

    // Marketing should be hidden
    expect(screen.queryByRole("button", { name: "Marketing" })).not.toBeInTheDocument();

    // Click the clear button
    const clearButton = screen.getByRole("button", { name: "Clear filter" });
    fireEvent.click(clearButton);

    // All dashboards should be visible again
    expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Executive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marketing" })).toBeInTheDocument();
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

    // Type something into the filter
    const filterInput = screen.getByLabelText("Filter dashboards by name");
    fireEvent.change(filterInput, { target: { value: "exec" } });

    // Clear button should appear
    expect(screen.getByRole("button", { name: "Clear filter" })).toBeInTheDocument();

    // Clear the filter
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));

    // Clear button should disappear
    expect(screen.queryByRole("button", { name: "Clear filter" })).not.toBeInTheDocument();
  });
});
