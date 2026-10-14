import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PipelineListTable } from "./PipelineListTable";
import type { PipelineSummary } from "../types/pipelineStep";

const pipeline = {
  id: "p-1",
  name: "Sales Pipeline",
  roots: [{ id: "r-1", dataSourceId: "ds-1", dataSourceName: "Sales API" }],
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
  ownerId: "u1",
} as unknown as PipelineSummary;

function renderTable() {
  render(
    <MemoryRouter initialEntries={["/pipelines"]}>
      <Routes>
        <Route
          path="/pipelines"
          element={
            <PipelineListTable
              pipelines={[pipeline]}
              currentUserId="u1"
              onShare={jest.fn()}
              onRequestDelete={jest.fn()}
            />
          }
        />
        <Route path="/pipelines/:id" element={<div>Pipeline detail page</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByRole("button", { name: "Delete Sales Pipeline" }).closest("tr")!;
}

// HEL-1604: the row opens the item on click, except from the actions cell and on the second click of a double-click.
describe("PipelineListTable row click", () => {
  it("opens the pipeline on a plain click elsewhere on the row", () => {
    const row = renderTable();
    fireEvent.click(row.querySelectorAll("td")[1]!);
    expect(screen.getByText("Pipeline detail page")).toBeInTheDocument();
  });

  it("does not open it on a click in the actions cell, even beside the buttons", () => {
    const row = renderTable();
    fireEvent.click(row.querySelector(".pipeline-list-table__td--actions")!);
    expect(screen.queryByText("Pipeline detail page")).not.toBeInTheDocument();
  });

  it("does not open it on the second click of a double-click", () => {
    const row = renderTable();
    fireEvent.click(row.querySelectorAll("td")[1]!, { detail: 2 });
    expect(screen.queryByText("Pipeline detail page")).not.toBeInTheDocument();
  });
});
