import { screen, within } from "@testing-library/react";

import { TableRenderer } from "./TableRenderer";
import { renderWithStore } from "../../../../test/renderWithStore";

jest.mock("../../../pipelines/services/outputService", () => ({
  updateOutput: jest.fn(),
}));

// HEL-1780 D4(a)-(c), (b2) -- panel read scope (a dashboard the caller does not own): the part of the sort/filter the
// per-panel route may not be sent (`clientOps`) is applied in the browser over the loaded rows, and the table says so.
const ROWS = [
  { region: "East", amount: 30 },
  { region: "West", amount: 10 },
  { region: "North", amount: 20 },
];

function bodyAmounts(): string[] {
  const rows = screen.getAllByRole("row").slice(1);
  return rows.map((r) => within(r).getAllByRole("cell")[1].textContent ?? "");
}

describe("TableRenderer in panel read scope (HEL-1780 D4)", () => {
  it("orders the loaded rows by a non-control column even though onSortChange is wired, and discloses it", () => {
    renderWithStore(
      <TableRenderer
        outputId="o1"
        paginationRows={ROWS}
        columnOrder={["region", "amount"]}
        rowsTruncated
        totalRowCount={40}
        onSortChange={jest.fn()}
        onLoadMore={jest.fn()}
        columnSort={{ key: "amount", direction: "asc" }}
        clientOps={{ sort: { key: "amount", direction: "asc" } }}
      />,
    );
    expect(bodyAmounts()).toEqual(["10", "20", "30"]);
    expect(screen.getByText("Sorted within the 3 loaded rows of 40.")).toBeInTheDocument();
  });

  it("owner scope (no clientOps) keeps the server's order untouched and shows no disclosure", () => {
    renderWithStore(
      <TableRenderer
        outputId="o1"
        paginationRows={ROWS}
        columnOrder={["region", "amount"]}
        rowsTruncated
        totalRowCount={40}
        onSortChange={jest.fn()}
        onLoadMore={jest.fn()}
        columnSort={{ key: "amount", direction: "asc" }}
      />,
    );
    expect(bodyAmounts()).toEqual(["30", "10", "20"]);
    expect(screen.queryByText(/loaded rows of/)).not.toBeInTheDocument();
  });

  it("says nothing about a client sort when every row is loaded", () => {
    renderWithStore(
      <TableRenderer
        outputId="o1"
        paginationRows={ROWS}
        columnOrder={["region", "amount"]}
        totalRowCount={3}
        onSortChange={jest.fn()}
        columnSort={{ key: "amount", direction: "asc" }}
        clientOps={{ sort: { key: "amount", direction: "asc" } }}
      />,
    );
    expect(bodyAmounts()).toEqual(["10", "20", "30"]);
    expect(screen.queryByText(/loaded rows of/)).not.toBeInTheDocument();
  });

  it("a client filter with rows still unloaded says 'Filtered within', never the server total as a match count", () => {
    renderWithStore(
      <TableRenderer
        outputId="o1"
        paginationRows={ROWS}
        columnOrder={["region", "amount"]}
        rowsTruncated
        totalRowCount={40}
        onSortChange={jest.fn()}
        onFilterChange={jest.fn()}
        onLoadMore={jest.fn()}
        columnFilters={{ columns: { region: "est" } }}
        clientOps={{ columns: { region: "est" } }}
      />,
    );
    expect(screen.getByText("Filtered within the 3 loaded rows of 40.")).toBeInTheDocument();
    expect(screen.queryByText(/40 results/)).not.toBeInTheDocument();
    // exactly one disclosure line
    expect(screen.getAllByText(/loaded rows of|results\./)).toHaveLength(1);
  });

  it("a client filter with every row loaded says '1 result.' (the client-filtered count), never the 40-row server total", () => {
    renderWithStore(
      <TableRenderer
        outputId="o1"
        paginationRows={ROWS}
        columnOrder={["region", "amount"]}
        totalRowCount={3}
        onSortChange={jest.fn()}
        onFilterChange={jest.fn()}
        columnFilters={{ columns: { region: "est" } }}
        clientOps={{ columns: { region: "est" } }}
      />,
    );
    expect(screen.getByText("1 result.")).toBeInTheDocument();
    expect(screen.queryByText(/3 results/)).not.toBeInTheDocument();
  });

  it("sorted AND filtered with rows unloaded renders one 'Sorted and filtered' note", () => {
    renderWithStore(
      <TableRenderer
        outputId="o1"
        paginationRows={ROWS}
        columnOrder={["region", "amount"]}
        rowsTruncated
        totalRowCount={40}
        onSortChange={jest.fn()}
        onFilterChange={jest.fn()}
        onLoadMore={jest.fn()}
        columnSort={{ key: "amount", direction: "desc" }}
        columnFilters={{ columns: { region: "t" } }}
        clientOps={{ sort: { key: "amount", direction: "desc" }, columns: { region: "t" } }}
      />,
    );
    expect(
      screen.getByText("Sorted and filtered within the 3 loaded rows of 40."),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/loaded rows of/)).toHaveLength(1);
  });

  it("a client filter matching none of the loaded rows is not 'no rows match' while rows remain unloaded", () => {
    renderWithStore(
      <TableRenderer
        outputId="o1"
        paginationRows={ROWS}
        columnOrder={["region", "amount"]}
        rowsTruncated
        totalRowCount={40}
        onSortChange={jest.fn()}
        onFilterChange={jest.fn()}
        onLoadMore={jest.fn()}
        columnFilters={{ columns: { region: "zzz" } }}
        clientOps={{ columns: { region: "zzz" } }}
      />,
    );
    expect(
      screen.getByText("No loaded rows match your filter. Only 3 of 40 rows were searched."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No rows match your filter.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("with every row loaded, a zero-match client filter keeps the plain empty copy", () => {
    renderWithStore(
      <TableRenderer
        outputId="o1"
        paginationRows={ROWS}
        columnOrder={["region", "amount"]}
        totalRowCount={3}
        onSortChange={jest.fn()}
        onFilterChange={jest.fn()}
        columnFilters={{ columns: { region: "zzz" } }}
        clientOps={{ columns: { region: "zzz" } }}
      />,
    );
    expect(screen.getByText("No rows match your filter.")).toBeInTheDocument();
  });
});
