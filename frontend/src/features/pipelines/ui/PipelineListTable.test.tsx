import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { PipelineListTable } from "./PipelineListTable";
import type { PipelineSummary } from "../types/pipelineStep";

const pipeline: PipelineSummary = {
  id: "p-1",
  name: "Sales Pipeline",
  ownerId: "owner-1",
  sourceDataSourceId: "ds-1",
  sourceDataSourceName: "Sales API",
  outputDataTypeName: "SalesMetrics",
  outputDataTypeId: "dt-sales",
  lastRunStatus: "succeeded",
  lastRunAt: "2026-05-01T10:00:00Z",
  lastRunRowCount: 1234,
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
