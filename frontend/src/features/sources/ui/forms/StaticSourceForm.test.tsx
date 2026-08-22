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
    // F-051: routed through the shared <InlineError>, whose default "text"
    // variant intentionally carries no alert role (matches every other
    // plain-text InlineError consumer app-wide) — assert on the rendered
    // text instead.
    expect(screen.getByText("All columns must have a name.")).toBeInTheDocument();
  });

  // F-180 regression: with an empty source name and a valid column, "Next"
  // used to advance straight to the rows step, producing the broken
  // "Enter data rows for ." hint (empty bold name + stray period).
  it("shows an error and prevents Next when the source name is empty, even with a valid column", () => {
    render(
      <StaticSourceForm name="" onSubmit={noop} isLoading={false} error={null} onCancel={noop} />,
    );
    fireEvent.change(screen.getByLabelText("Column 1 name"), {
      target: { value: "id" },
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText("Source name is required.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Data rows" })).not.toBeInTheDocument();
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
