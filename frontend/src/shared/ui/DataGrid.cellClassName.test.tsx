import { render } from "@testing-library/react";

import { DataGrid, type ColumnDef } from "./DataGrid";

// HEL-1307 task 3.4: the additive `ColumnDef.cellClassName` hook styles a column's body <td>s.

const rows = [
  { a: "1", b: "x" },
  { a: "2", b: "y" },
];

describe("ColumnDef.cellClassName", () => {
  it("adds the returned class to that column's td only, per row", () => {
    const columns: ColumnDef[] = [
      { key: "a", cellClassName: (row) => (row.a === "2" ? "hot" : undefined) },
      { key: "b" },
    ];
    const { container } = render(<DataGrid variant="full" rows={rows} columns={columns} />);
    const trs = container.querySelectorAll("tbody tr");
    expect(trs[0].querySelectorAll("td")[0].className).not.toContain("hot");
    expect(trs[1].querySelectorAll("td")[0]).toHaveClass("hot");
    expect(trs[1].querySelectorAll("td")[1].className).not.toContain("hot");
  });

  it("composes with the pinned-cell classes", () => {
    const columns: ColumnDef[] = [{ key: "a", cellClassName: () => "hot" }, { key: "b" }];
    const { container } = render(
      <DataGrid variant="full" rows={rows} columns={columns} pinnedColumns={["a"]} />,
    );
    expect(container.querySelector("tbody td")).toHaveClass("ui-data-grid__pinned-cell", "hot");
  });

  it("leaves the td without a class attribute when no hook is set (unchanged DOM)", () => {
    const { container } = render(
      <DataGrid variant="full" rows={rows} columns={[{ key: "a" }, { key: "b" }]} />,
    );
    expect(container.querySelector("tbody td")?.hasAttribute("class")).toBe(false);
  });
});
