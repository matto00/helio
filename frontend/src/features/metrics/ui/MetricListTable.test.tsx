// HEL-560 — the delete-confirm affordance calls GET /api/metrics/:id/usage
// when a delete is first initiated and displays the real bound-panel count,
// replacing the previous generic "Delete?" copy. `<Link>` requires a Router
// context; this component doesn't touch redux, so a bare `MemoryRouter` wrap
// suffices (no `renderWithStore`/`Provider` needed).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import * as metricService from "../services/metricService";
import type { MetricSummary } from "../types/metric";
import { MetricListTable } from "./MetricListTable";

jest.mock("../services/metricService");

const mockedFetchUsage = metricService.fetchMetricUsage as jest.MockedFunction<
  typeof metricService.fetchMetricUsage
>;

const metric: MetricSummary = {
  id: "m-1",
  ownerId: "u-1",
  dataTypeId: "dt-1",
  name: "Total Revenue",
  description: null,
  measureField: "amount",
  aggregation: "sum",
  allowedDimensions: [],
  format: {},
  deprecated: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderTable(onDelete = jest.fn()) {
  return {
    onDelete,
    ...render(
      <MemoryRouter>
        <MetricListTable metrics={[metric]} dataTypeNameById={new Map()} onDelete={onDelete} />
      </MemoryRouter>,
    ),
  };
}

beforeEach(() => {
  mockedFetchUsage.mockReset();
});

describe("MetricListTable — delete-confirm shows the real usage count (HEL-560)", () => {
  it("fetches and displays the real bound-panel count when delete is initiated", async () => {
    mockedFetchUsage.mockResolvedValueOnce({ metricId: "m-1", count: 3, panels: [] });
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Delete Total Revenue" }));

    expect(mockedFetchUsage).toHaveBeenCalledWith("m-1");
    await waitFor(() => {
      expect(screen.getByText("Delete? 3 panels will lose this binding.")).toBeInTheDocument();
    });
  });

  it("shows a zero-usage message for an unbound metric", async () => {
    mockedFetchUsage.mockResolvedValueOnce({ metricId: "m-1", count: 0, panels: [] });
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Delete Total Revenue" }));

    await waitFor(() => {
      expect(screen.getByText("Delete? Not bound to any panels.")).toBeInTheDocument();
    });
  });

  it("calls onDelete on confirm, after the usage count has loaded", async () => {
    mockedFetchUsage.mockResolvedValueOnce({ metricId: "m-1", count: 1, panels: [] });
    const { onDelete } = renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Delete Total Revenue" }));
    await waitFor(() => screen.getByText("Delete? 1 panel will lose this binding."));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Total Revenue" }));

    expect(onDelete).toHaveBeenCalledWith(metric);
    expect(
      screen.queryByRole("button", { name: "Confirm delete Total Revenue" }),
    ).not.toBeInTheDocument();
  });
});

describe("MetricListTable — actions column header (HEL a11y sweep F-204)", () => {
  it("gives the actions <th> a visually-hidden accessible name instead of an empty header", () => {
    renderTable();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
  });
});

describe("MetricListTable — whole-row navigation (HEL UI-sweep F-069)", () => {
  it("clicking anywhere in the row (not just the Name link) navigates to the metric", () => {
    render(
      <MemoryRouter initialEntries={["/metrics"]}>
        <Routes>
          <Route
            path="/metrics"
            element={
              <MetricListTable
                metrics={[metric]}
                dataTypeNameById={new Map()}
                onDelete={jest.fn()}
              />
            }
          />
          <Route path="/metrics/:id" element={<div>Metric detail page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("sum"));
    expect(screen.getByText("Metric detail page")).toBeInTheDocument();
  });

  it("clicking Delete navigates nowhere and does not also trigger row navigation", () => {
    mockedFetchUsage.mockResolvedValueOnce({ metricId: "m-1", count: 0, panels: [] });
    render(
      <MemoryRouter initialEntries={["/metrics"]}>
        <Routes>
          <Route
            path="/metrics"
            element={
              <MetricListTable
                metrics={[metric]}
                dataTypeNameById={new Map()}
                onDelete={jest.fn()}
              />
            }
          />
          <Route path="/metrics/:id" element={<div>Metric detail page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Total Revenue" }));
    expect(screen.queryByText("Metric detail page")).not.toBeInTheDocument();
  });
});
