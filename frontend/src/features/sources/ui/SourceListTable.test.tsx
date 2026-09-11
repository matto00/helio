import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { SourceListTable } from "./SourceListTable";
import type { DataSource } from "../types/dataSource";

function staticSource(overrides: Partial<DataSource>): DataSource {
  return {
    id: "s-1",
    name: "Source",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    inferredSchema: [],
    type: "dataset",
    config: { rows: [] },
    ...overrides,
  } as DataSource;
}

function renderTable(sources: DataSource[]) {
  render(
    <MemoryRouter initialEntries={["/sources"]}>
      <Routes>
        <Route
          path="/sources"
          element={<SourceListTable sources={sources} pipelineNamesBySourceId={new Map()} />}
        />
        <Route path="/sources/:id" element={<div>Source detail page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function rowOrder() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent);
}

describe("SourceListTable — HEL-1022 default ordering and column sorting", () => {
  const older = staticSource({ id: "s-old", name: "Alpha", updatedAt: "2026-01-01T00:00:00Z" });
  const newer = staticSource({ id: "s-new", name: "Bravo", updatedAt: "2026-06-01T00:00:00Z" });

  it("defaults to most-recently-updated first", () => {
    renderTable([older, newer]);
    expect(rowOrder()[0]).toContain("Bravo");
  });

  it("clicking the Name header sorts ascending, toggling to descending on a second click", () => {
    renderTable([newer, older]);
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(rowOrder()[0]).toContain("Alpha");

    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(rowOrder()[0]).toContain("Bravo");
  });

  it("marks the active sort header's aria-sort and leaves others none", () => {
    renderTable([newer, older]);
    fireEvent.click(screen.getByRole("button", { name: /Kind/ }));
    expect(screen.getByRole("columnheader", { name: /Kind/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "none");
  });

  it("HEL-1022 follow-up: the default sort (Updated desc) is visible on first paint, and every other header is none", () => {
    renderTable([older, newer]);
    expect(screen.getByRole("columnheader", { name: /Updated/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    for (const name of ["Name", "Kind", "Location", "Used by"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(name) })).toHaveAttribute(
        "aria-sort",
        "none",
      );
    }
  });
});
