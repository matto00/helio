import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { PipelineListTable } from "./PipelineListTable";
import type { PipelineSummary } from "../types/pipelineStep";

const pipeline: PipelineSummary = {
  id: "p-1",
  name: "Sales Pipeline",
  ownerId: "owner-1",
  roots: [{ id: "root-1", dataSourceId: "ds-1", dataSourceName: "Sales API" }],
  lastRunStatus: "succeeded",
  lastRunAt: "2026-05-01T10:00:00Z",
  lastRunRowCount: 1234,
  updatedAt: "2026-05-02T10:00:00Z",
};

function renderTable(props: Partial<Parameters<typeof PipelineListTable>[0]> = {}) {
  const onShare = jest.fn();
  const utils = render(
    <MemoryRouter initialEntries={["/pipelines"]}>
      <Routes>
        <Route
          path="/pipelines"
          element={
            <PipelineListTable
              pipelines={[pipeline]}
              currentUserId="owner-1"
              onShare={onShare}
              {...props}
            />
          }
        />
        <Route path="/pipelines/:id" element={<div>Pipeline detail page</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...utils, onShare };
}

describe("PipelineListTable — actions column header (HEL a11y sweep F-204)", () => {
  it("gives the actions <th> a visually-hidden accessible name instead of an empty header", () => {
    renderTable();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
  });
});

describe("PipelineListTable — whole-row navigation (HEL UI-sweep F-069)", () => {
  it("clicking anywhere in the row (not just the Name link) navigates to the pipeline", () => {
    renderTable();
    fireEvent.click(screen.getByText("Sales API"));
    expect(screen.getByText("Pipeline detail page")).toBeInTheDocument();
  });

  it("clicking the Share button navigates nowhere and does not also trigger row navigation", () => {
    const { onShare } = renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Share Sales Pipeline" }));

    expect(onShare).toHaveBeenCalledWith(pipeline);
    expect(screen.queryByText("Pipeline detail page")).not.toBeInTheDocument();
  });
});

describe("PipelineListTable — HEL-1022 multi-root Sources column", () => {
  it("renders a single source exactly as before", () => {
    renderTable();
    expect(screen.getByText("Sales API")).toBeInTheDocument();
  });

  it("renders every root's name up to 2, with a +N affordance and a full-list tooltip beyond that", () => {
    const multi: PipelineSummary = {
      ...pipeline,
      roots: [
        { id: "root-1", dataSourceId: "ds-1", dataSourceName: "Sales API" },
        { id: "root-2", dataSourceId: "ds-2", dataSourceName: "Marketing CSV" },
        { id: "root-3", dataSourceId: "ds-3", dataSourceName: "Support Tickets" },
      ],
    };
    renderTable({ pipelines: [multi] });
    const cell = screen.getByText("Sales API, Marketing CSV +1");
    expect(cell).toHaveAttribute("title", "Sales API, Marketing CSV, Support Tickets");
  });

  it("renders the dash convention for an empty roots array without crashing", () => {
    const empty: PipelineSummary = { ...pipeline, roots: [] };
    renderTable({ pipelines: [empty] });
    // `pipeline` fixture omits `updatedAt`, so its own cell also dashes --
    // scope to the row's Sources cell (2nd column) rather than assert a
    // single dash exists anywhere in the row.
    const cells = screen.getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("—");
  });
});

describe("PipelineListTable — HEL-1022 column sorting", () => {
  const a: PipelineSummary = {
    ...pipeline,
    id: "p-a",
    name: "Alpha",
    lastRunAt: "2026-05-01T10:00:00Z",
  };
  const b: PipelineSummary = {
    ...pipeline,
    id: "p-b",
    name: "Bravo",
    lastRunAt: "2026-06-01T10:00:00Z",
  };
  const c: PipelineSummary = { ...pipeline, id: "p-c", name: "Charlie", lastRunAt: null };

  function rowOrder() {
    return screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent);
  }

  it("clicking the Name header sorts ascending, then descending on a second click", () => {
    renderTable({ pipelines: [b, a, c] });
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(rowOrder()[0]).toContain("Alpha");

    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(rowOrder()[0]).toContain("Charlie");
  });

  it("sorts a null Last run at to the last position in both directions", () => {
    renderTable({ pipelines: [a, b, c] });
    fireEvent.click(screen.getByRole("button", { name: /Last run at/ }));
    expect(rowOrder()[rowOrder().length - 1]).toContain("Charlie");

    fireEvent.click(screen.getByRole("button", { name: /Last run at/ }));
    expect(rowOrder()[rowOrder().length - 1]).toContain("Charlie");
  });

  it("marks the active sort header's aria-sort and leaves others as none", () => {
    renderTable({ pipelines: [a, b, c] });
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(screen.getByRole("columnheader", { name: /Sources/ })).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  it("HEL-1022 follow-up: the default sort (Updated desc) is visible on first paint, and every other header is none", () => {
    renderTable({ pipelines: [a, b, c] });
    expect(screen.getByRole("columnheader", { name: /Updated/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    for (const name of ["Name", "Sources", "Status", "Last run at", "Rows written"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(name) })).toHaveAttribute(
        "aria-sort",
        "none",
      );
    }
  });
});

describe("PipelineListTable — HEL-873 persisted truncation signal", () => {
  it("marks a truncated pipeline's lastRunRowCount partial and leaves a complete one unmarked", () => {
    const truncated: PipelineSummary = { ...pipeline, id: "p-truncated", lastRunTruncated: true };
    const complete: PipelineSummary = {
      ...pipeline,
      id: "p-complete",
      lastRunTruncated: false,
    };
    renderTable({ pipelines: [truncated, complete] });

    expect(screen.getAllByText(/Partial/)).toHaveLength(1);
  });

  it("renders no marker for a not-recorded pipeline (lastRunTruncated absent)", () => {
    const notRecorded: PipelineSummary = { ...pipeline, lastRunTruncated: undefined };
    renderTable({ pipelines: [notRecorded] });

    expect(screen.queryByText(/Partial/)).not.toBeInTheDocument();
  });
});
