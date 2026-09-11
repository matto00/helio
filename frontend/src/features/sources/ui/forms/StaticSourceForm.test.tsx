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

  // skeptic-final-1.md CR4: `handleSubmit`'s NaN-fallback (HEL-1076 tasks.md 3.1) sends the raw
  // string instead of `null` for an unparseable numeric cell, so the backend's DatasetRowValidator
  // rejects the actual bad value rather than it silently vanishing as a missing field. Reverting
  // that fix must turn this test red — assert on the actual `onSubmit` payload, not just that
  // submission occurred.
  it("submits the raw string (not null/NaN) for an unparseable value in an integer column", () => {
    const onSubmit = jest.fn();
    render(
      <StaticSourceForm
        name="Test"
        onSubmit={onSubmit}
        isLoading={false}
        error={null}
        onCancel={noop}
      />,
    );

    fireEvent.change(screen.getByLabelText("Column 1 name"), {
      target: { value: "age" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Column 1 type" }));
    fireEvent.click(screen.getByRole("option", { name: "integer" }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    fireEvent.click(screen.getByRole("button", { name: /add row/i }));
    fireEvent.change(screen.getByLabelText("Row 1 age"), {
      target: { value: "not-a-number" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [columns, rows] = onSubmit.mock.calls[0] as [unknown, unknown[][]];
    expect(columns).toEqual([{ name: "age", type: "integer" }]);
    expect(rows).toEqual([["not-a-number"]]);
  });
});
