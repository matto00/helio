import { render } from "@testing-library/react";

import { DataGrid } from "./DataGrid";
import type { ColumnDef } from "./DataGrid";

/**
 * HEL-1080 tasks.md 2.3 (design.md Decision 0, standing constraint C1) — regression check for
 * `DataGrid`'s 5 real named consumers, verified by import (`git grep -ln "import { DataGrid"`):
 * `TableRenderer`, `SourceDetailPanel`'s existing Preview usage, `SqlTab`, and `StepCard`.
 *
 * **`ConnectorsPage` is NOT a real consumer** (a discrepancy against design.md's list, corrected
 * here rather than silently reproduced) -- its own file header comment states it deliberately
 * uses a plain `SortableTable`, not `DataGrid` ("the row shape ... doesn't fit a sortable/
 * filterable grid any better than a plain table would"), and `git grep -ln "import { DataGrid"
 * src --include=*.tsx` confirms exactly 4 real consumer files, not 5. This test covers the 4 real
 * ones; design.md's fifth name is stale, most plausibly from a since-refactored ConnectorsPage.
 *
 * Each block below renders `DataGrid` with the EXACT prop shape (variant/columns/rows) that
 * consumer passes today, with `gridMode` OMITTED -- exactly how every real consumer calls it --
 * and asserts none of `gridMode`'s new markup (`role="grid"`/`"row"`/`"gridcell"`, a `tabIndex`
 * on any body cell) leaked into the default path. `gridMode` defaults to `false`, so any of these
 * attributes appearing here would mean the default-off contract broke.
 */
describe("DataGrid consumer regression (HEL-1080 task 2.3)", () => {
  function assertUnaffected(container: HTMLElement) {
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table).not.toHaveAttribute("role", "grid");
    expect(container.querySelectorAll('tbody tr[role="row"]')).toHaveLength(0);
    expect(container.querySelectorAll('td[role="gridcell"]')).toHaveLength(0);
    container.querySelectorAll("tbody td").forEach((td) => {
      expect(td).not.toHaveAttribute("tabindex");
    });
  }

  it("TableRenderer's full-variant, sortable/filterable/pinnable/resizable call shape is unaffected", () => {
    const columns: ColumnDef[] = [
      { key: "name", header: "Name" },
      { key: "value", header: "Value" },
    ];
    const rows = [
      { name: "Alice", value: 1 },
      { name: "Bob", value: 2 },
    ];
    const { container } = render(
      <DataGrid
        variant="full"
        rows={rows}
        columns={columns}
        columnWidths={{}}
        onColumnResize={() => {}}
        sort={null}
        onSort={() => {}}
        filters={{}}
        onFilterChange={() => {}}
        pinnedColumns={[]}
        onPinToggle={() => {}}
        emptyText="No rows"
      />,
    );
    assertUnaffected(container);
  });

  it("SourceDetailPanel's preview-variant call shape (derived columns, no sort/filter) is unaffected", () => {
    const rows = [{ id: "1", label: "x" }];
    const { container } = render(
      <DataGrid
        variant="preview"
        rows={rows}
        columns={["id", "label"].map((h) => ({ key: h }))}
        emptyText="Source returned no rows."
      />,
    );
    assertUnaffected(container);
  });

  it("SqlTab's preview-variant call shape (fixed columns, no emptyText override) is unaffected", () => {
    const rows = [{ name: "col1", displayName: "col1", dataType: "string" }];
    const { container } = render(
      <DataGrid
        variant="preview"
        rows={rows}
        columns={[
          { key: "name", header: "Name" },
          { key: "dataType", header: "Type" },
        ]}
      />,
    );
    assertUnaffected(container);
  });

  it("StepCard's minimal preview-variant call shape (no columns prop) is unaffected", () => {
    const rows = [{ a: 1, b: 2 }];
    const { container } = render(
      <DataGrid variant="preview" rows={rows} emptyText="No rows to preview." />,
    );
    assertUnaffected(container);
  });
});
