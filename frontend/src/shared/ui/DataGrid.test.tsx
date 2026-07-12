import { render, screen } from "@testing-library/react";

import { DataGrid } from "./DataGrid";

describe("DataGrid — empty state", () => {
  it("renders the default empty-state message and no table when rows is empty", () => {
    const { container } = render(<DataGrid variant="preview" rows={[]} />);

    expect(screen.getByText("No data to preview.")).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeInTheDocument();
  });

  it("renders a custom emptyText message when rows is empty", () => {
    const { container } = render(
      <DataGrid variant="preview" rows={[]} emptyText="Source returned no rows." />,
    );

    expect(screen.getByText("Source returned no rows.")).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeInTheDocument();
  });
});

describe("DataGrid — column derivation", () => {
  it("derives columns from the union of row keys in first-seen order when columns is omitted", () => {
    const rows = [
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ];
    render(<DataGrid variant="preview" rows={rows} />);

    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["a", "b", "c"]);
  });

  it("uses explicit columns verbatim, ignoring row keys, when columns is provided", () => {
    const rows = [{ a: 1, b: 2, c: 3 }];
    render(<DataGrid variant="preview" rows={rows} columns={[{ key: "c" }, { key: "a" }]} />);

    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["c", "a"]);
  });
});

describe("DataGrid — variants and density", () => {
  it("full variant renders a table with row/column data", () => {
    const rows = [{ name: "alice" }, { name: "bob" }];
    const { container } = render(<DataGrid variant="full" rows={rows} />);

    expect(container.querySelector("table")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("ui-data-grid--normal");
  });

  it("preview variant defaults to condensed density", () => {
    const { container } = render(<DataGrid variant="preview" rows={[{ a: 1 }]} />);
    expect(container.firstChild).toHaveClass("ui-data-grid--condensed");
  });

  it("full variant defaults to normal density", () => {
    const { container } = render(<DataGrid variant="full" rows={[{ a: 1 }]} />);
    expect(container.firstChild).toHaveClass("ui-data-grid--normal");
  });

  it("an explicit density overrides the variant default", () => {
    const { container } = render(
      <DataGrid variant="preview" rows={[{ a: 1 }]} density="spacious" />,
    );
    expect(container.firstChild).toHaveClass("ui-data-grid--spacious");
  });
});

describe("DataGrid — default cell formatting", () => {
  it("renders null and undefined values as an em dash", () => {
    render(<DataGrid variant="preview" rows={[{ a: null, b: undefined }]} />);
    const cells = screen.getAllByRole("cell").map((el) => el.textContent);
    expect(cells).toEqual(["—", "—"]);
  });

  it("renders object values as their JSON string representation", () => {
    render(<DataGrid variant="preview" rows={[{ a: { x: 1 } }]} />);
    expect(screen.getByText(JSON.stringify({ x: 1 }))).toBeInTheDocument();
  });

  it("renders other values via their string representation", () => {
    render(<DataGrid variant="preview" rows={[{ a: 42, b: true }]} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
  });
});

describe("DataGrid — custom column render", () => {
  it("uses a column's render output instead of the default formatter", () => {
    const rows = [{ nullable: true }, { nullable: false }];
    render(
      <DataGrid
        variant="preview"
        rows={rows}
        columns={[{ key: "nullable", render: (_row, value) => (value ? "yes" : "no") }]}
      />,
    );

    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getByText("no")).toBeInTheDocument();
  });
});
