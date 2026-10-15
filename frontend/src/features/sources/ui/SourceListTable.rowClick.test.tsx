import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { SourceListTable } from "./SourceListTable";
import type { DataSource } from "../types/dataSource";

const source = {
  id: "s-1",
  name: "Sales",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  inferredSchema: [],
  type: "dataset",
  config: { rows: [] },
} as DataSource;

function renderTable() {
  render(
    <MemoryRouter initialEntries={["/sources"]}>
      <Routes>
        <Route
          path="/sources"
          element={
            <SourceListTable
              sources={[source]}
              references={{}}
              referencesLoaded
              onRequestDelete={jest.fn()}
            />
          }
        />
        <Route path="/sources/:id" element={<div>Source detail page</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByRole("button", { name: "Delete Sales" }).closest("tr")!;
}

// HEL-1604: the row opens the item on click, except from the actions cell and on the second click of a double-click.
describe("SourceListTable row click", () => {
  it("opens the source on a plain click elsewhere on the row", () => {
    const row = renderTable();
    fireEvent.click(row.querySelectorAll("td")[1]!);
    expect(screen.getByText("Source detail page")).toBeInTheDocument();
  });

  it("does not open it on a click in the actions cell, even beside the button", () => {
    const row = renderTable();
    fireEvent.click(row.querySelector(".source-list-table__td--actions")!);
    expect(screen.queryByText("Source detail page")).not.toBeInTheDocument();
  });

  it("does not open it on the second click of a double-click", () => {
    const row = renderTable();
    fireEvent.click(row.querySelectorAll("td")[1]!, { detail: 2 });
    expect(screen.queryByText("Source detail page")).not.toBeInTheDocument();
  });
});
