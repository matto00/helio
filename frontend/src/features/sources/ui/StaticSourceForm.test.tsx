import { fireEvent, render, screen } from "@testing-library/react";

import { StaticSourceForm } from "./StaticSourceForm";

const noop = () => undefined;

describe("StaticSourceForm — column definition step", () => {
  it("renders one default column row on mount", () => {
    render(
      <StaticSourceForm
        name="Test"
        onSubmit={noop}
        isLoading={false}
        error={null}
        onCancel={noop}
      />,
    );
    expect(screen.getByLabelText("Column 1 name")).toBeInTheDocument();
  });

  it("adds a column when Add column is clicked", () => {
    render(
      <StaticSourceForm
        name="Test"
        onSubmit={noop}
        isLoading={false}
        error={null}
        onCancel={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add column/i }));
    expect(screen.getByLabelText("Column 2 name")).toBeInTheDocument();
  });

  it("shows an error and prevents Next when column name is empty", () => {
    render(
      <StaticSourceForm
        name="Test"
        onSubmit={noop}
        isLoading={false}
        error={null}
        onCancel={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/column/i);
  });

  it("advances to rows step when columns are valid", () => {
    render(
      <StaticSourceForm
        name="Test"
        onSubmit={noop}
        isLoading={false}
        error={null}
        onCancel={noop}
      />,
    );
    fireEvent.change(screen.getByLabelText("Column 1 name"), {
      target: { value: "id" },
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("table", { name: "Data rows" })).toBeInTheDocument();
  });
});
