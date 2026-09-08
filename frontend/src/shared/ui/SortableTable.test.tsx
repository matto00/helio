import { render, screen } from "@testing-library/react";

import { SortableTable, type SortableTableColumn } from "./SortableTable";

type Key = "name" | "count";

const columns: readonly SortableTableColumn<Key>[] = [
  { key: "name", header: "Name", className: "test-th" },
  { key: "count", header: "Count", className: "test-th" },
];

function Tbody() {
  return (
    <tbody>
      <tr>
        <td>Alpha</td>
        <td>1</td>
      </tr>
    </tbody>
  );
}

describe("SortableTable — shared shell (HEL-1022)", () => {
  it("renders NO wrapper div when scrollClassNames is omitted (e.g. AuditEventTable)", () => {
    const { container } = render(
      <SortableTable
        tableClassName="test-table"
        columns={columns}
        sortState={{ key: "name", direction: "asc" }}
        onSort={() => {}}
      >
        <Tbody />
      </SortableTable>,
    );
    // The table is the ROOT node -- no enclosing <div> at all.
    expect(container.firstElementChild?.tagName).toBe("TABLE");
    expect(container.querySelector("div")).toBeNull();
  });

  it("renders the scroll wrapper with the caller's own class names when scrollClassNames is given", () => {
    const { container } = render(
      <SortableTable
        tableClassName="test-table"
        columns={columns}
        sortState={{ key: "name", direction: "asc" }}
        onSort={() => {}}
        scrollClassNames={{
          container: "test-scroll",
          left: "test-scroll--left",
          right: "test-scroll--right",
        }}
      >
        <Tbody />
      </SortableTable>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.tagName).toBe("DIV");
    expect(wrapper).toHaveClass("test-scroll");
    expect(wrapper?.querySelector("table.test-table")).not.toBeNull();
  });

  it("builds <thead> headers from `columns` in order, each carrying the right aria-sort", () => {
    render(
      <SortableTable
        tableClassName="test-table"
        columns={columns}
        sortState={{ key: "count", direction: "desc" }}
        onSort={() => {}}
      >
        <Tbody />
      </SortableTable>,
    );
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent?.replace(/[▲▼⇅]/g, ""))).toEqual(["Name", "Count"]);
    expect(headers[0]).toHaveAttribute("aria-sort", "none");
    expect(headers[1]).toHaveAttribute("aria-sort", "descending");
  });

  it("renders trailingHeaderCells after the sortable columns", () => {
    render(
      <SortableTable
        tableClassName="test-table"
        columns={columns}
        sortState={{ key: "name", direction: "asc" }}
        onSort={() => {}}
        trailingHeaderCells={<th className="actions-th">Actions</th>}
      >
        <Tbody />
      </SortableTable>,
    );
    const headerRow = screen.getAllByRole("row")[0];
    const cells = Array.from(headerRow.children).map((c) => c.textContent?.replace(/[▲▼⇅]/g, ""));
    expect(cells).toEqual(["Name", "Count", "Actions"]);
  });

  it("passes `children` (the <tbody>) through untouched", () => {
    render(
      <SortableTable
        tableClassName="test-table"
        columns={columns}
        sortState={{ key: "name", direction: "asc" }}
        onSort={() => {}}
      >
        <Tbody />
      </SortableTable>,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("does NOT mark the scroll wrapper as a focusable region when scrollAriaLabel is omitted", () => {
    const { container } = render(
      <SortableTable
        tableClassName="test-table"
        columns={columns}
        sortState={{ key: "name", direction: "asc" }}
        onSort={() => {}}
        scrollClassNames={{
          container: "test-scroll",
          left: "test-scroll--left",
          right: "test-scroll--right",
        }}
      >
        <Tbody />
      </SortableTable>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper).not.toHaveAttribute("role");
    expect(wrapper).not.toHaveAttribute("tabindex");
  });

  it("locks the rendered shell's exact markup (regression guard for the SortableTable extraction)", () => {
    const { container } = render(
      <SortableTable
        tableClassName="test-table"
        columns={columns}
        sortState={{ key: "name", direction: "asc" }}
        onSort={() => {}}
        trailingHeaderCells={<th className="actions-th">Actions</th>}
        scrollClassNames={{
          container: "test-scroll",
          left: "test-scroll--left",
          right: "test-scroll--right",
        }}
      >
        <Tbody />
      </SortableTable>,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });
});
