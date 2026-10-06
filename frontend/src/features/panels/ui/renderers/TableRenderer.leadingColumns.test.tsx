import type { ComponentProps } from "react";
import { fireEvent, screen } from "@testing-library/react";

import type { ColumnDef } from "../../../../shared/ui";
import { renderWithStore } from "../../../../test/renderWithStore";
import { updateOutput } from "../../../pipelines/services/outputService";
import { TableRenderer } from "./TableRenderer";

jest.mock("../../../pipelines/services/outputService", () => ({
  updateOutput: jest.fn().mockResolvedValue({}),
}));

// HEL-1277 — `leadingColumns` (a render-only "Change" column) and `rowClassName` (keyed by row
// OBJECT) are what the Output History view builds its changed-rows highlight on. The leading column
// must stay out of sort/filter/pin and every persistence path, and rows must never be mutated.

const rows: Record<string, unknown>[] = [{ a: "2" }, { a: "1" }, { a: "3" }];
const flagged = rows[2];
const change: ColumnDef = {
  key: "__change__",
  header: "Change",
  render: (row) => (row === flagged ? "New or changed" : ""),
};

function renderTable(extra: Partial<ComponentProps<typeof TableRenderer>> = {}) {
  return renderWithStore(
    <TableRenderer
      outputId="out-1"
      paginationRows={rows}
      leadingColumns={[change]}
      rowClassName={(row) => (row === flagged ? "flagged-row" : undefined)}
      {...extra}
    />,
  );
}

describe("TableRenderer leadingColumns / rowClassName (HEL-1277)", () => {
  it("renders the leading column first and tints exactly the flagged row", () => {
    const { container } = renderTable();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers[0]).toBe("Change");
    expect(headers).toContain("a");
    expect(container.querySelectorAll("tr.flagged-row")).toHaveLength(1);
    expect(container.querySelector("tr.flagged-row")).toHaveTextContent("New or changed");
  });

  it("keeps the flagged row flagged through a sort (identity, not position)", () => {
    const { container } = renderTable();
    const sortBtn = screen.getByRole("button", { name: "a" });
    fireEvent.click(sortBtn);
    fireEvent.click(sortBtn); // descending: 3 first
    const body = container.querySelectorAll("tbody tr");
    expect(body[0]).toHaveClass("flagged-row");
    fireEvent.click(sortBtn);
    fireEvent.click(sortBtn);
    expect(container.querySelectorAll("tr.flagged-row")).toHaveLength(1);
  });

  it("gives the leading column no sort, filter or resize control and offers no pin control", () => {
    renderTable();
    expect(screen.queryByRole("button", { name: /Change/ })).toBeNull();
    expect(screen.queryByRole("separator", { name: /Resize column Change/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pin/ })).toBeNull();
  });

  it("never mutates the rows it was given", () => {
    const snapshot = JSON.stringify(rows);
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it("persists nothing (no ownerId) while sorting", () => {
    jest.useFakeTimers();
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    jest.advanceTimersByTime(1000);
    expect(updateOutput).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("without leadingColumns behaves as before (pin controls present, no Change column)", () => {
    renderTable({ leadingColumns: undefined, rowClassName: undefined });
    expect(screen.queryByText("Change")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Pin column/ }).length).toBeGreaterThan(0);
  });
});
