import { fireEvent, render, screen } from "@testing-library/react";

import { StaticSourceForm } from "./StaticSourceForm";

const noop = () => undefined;

describe("StaticSourceForm — field definition step", () => {
  it("renders one default field row on mount", () => {
    render(
      <StaticSourceForm
        name="Test"
        onSubmit={noop}
        isLoading={false}
        error={null}
        onCancel={noop}
      />,
    );
    expect(screen.getByLabelText("Field 1 name")).toBeInTheDocument();
  });

  it("adds a field when Add field is clicked", () => {
    render(
      <StaticSourceForm
        name="Test"
        onSubmit={noop}
        isLoading={false}
        error={null}
        onCancel={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    expect(screen.getByLabelText("Field 2 name")).toBeInTheDocument();
  });

  it("shows an error and prevents Next when field name is empty", () => {
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
    expect(screen.getByText("All fields must have a name.")).toBeInTheDocument();
  });

  // F-180 regression: with an empty source name and a valid field, "Next"
  // used to advance straight to the rows step, producing the broken
  // "Enter data rows for ." hint (empty bold name + stray period).
  it("shows an error and prevents Next when the source name is empty, even with a valid field", () => {
    render(
      <StaticSourceForm name="" onSubmit={noop} isLoading={false} error={null} onCancel={noop} />,
    );
    fireEvent.change(screen.getByLabelText("Field 1 name"), {
      target: { value: "id" },
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText("Source name is required.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Data rows" })).not.toBeInTheDocument();
  });

  it("advances to rows step when fields are valid", () => {
    render(
      <StaticSourceForm
        name="Test"
        onSubmit={noop}
        isLoading={false}
        error={null}
        onCancel={noop}
      />,
    );
    fireEvent.change(screen.getByLabelText("Field 1 name"), {
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

    fireEvent.change(screen.getByLabelText("Field 1 name"), {
      target: { value: "age" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Field 1 type" }));
    fireEvent.click(screen.getByRole("option", { name: "integer" }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    fireEvent.click(screen.getByRole("button", { name: /add row/i }));
    fireEvent.change(screen.getByLabelText("Row 1 age"), {
      target: { value: "not-a-number" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [columns, rows] = onSubmit.mock.calls[0] as [unknown, unknown[][]];
    expect(columns).toEqual([{ name: "age", type: "integer", required: false }]);
    expect(rows).toEqual([["not-a-number"]]);
  });

  // HEL-1079 tasks.md 1.4/1.5: the create path can now declare required/default and the full
  // canonical type set (not just the legacy 4-type subset).
  it("creates a dataset with timestamp, string-body, and binary-ref fields, carrying required/default", () => {
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

    fireEvent.change(screen.getByLabelText("Field 1 name"), { target: { value: "seenAt" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Field 1 type" }));
    fireEvent.click(screen.getByRole("option", { name: "timestamp" }));

    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    fireEvent.change(screen.getByLabelText("Field 2 name"), { target: { value: "notes" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Field 2 type" }));
    fireEvent.click(screen.getByRole("option", { name: "string-body" }));
    fireEvent.click(screen.getByLabelText("Field 2 required"));
    fireEvent.change(screen.getByLabelText("Field 2 default value"), {
      target: { value: "n/a" },
    });

    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    fireEvent.change(screen.getByLabelText("Field 3 name"), { target: { value: "attachment" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Field 3 type" }));
    fireEvent.click(screen.getByRole("option", { name: "binary-ref" }));
    // binary-ref has no default input at all.
    expect(screen.queryByLabelText("Field 3 default value")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [columns] = onSubmit.mock.calls[0] as [unknown, unknown[][]];
    expect(columns).toEqual([
      { name: "seenAt", type: "timestamp", required: false },
      { name: "notes", type: "string-body", required: true, default: "n/a" },
      { name: "attachment", type: "binary-ref", required: false },
    ]);
  });

  // tasks.md 1.5: reordering fields after row data has been entered must permute each row's
  // cells to match the new field order (mirroring `removeColumn`'s existing re-slice).
  it("keeps row cells aligned to field order after a reorder", () => {
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

    fireEvent.change(screen.getByLabelText("Field 1 name"), { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    fireEvent.change(screen.getByLabelText("Field 2 name"), { target: { value: "second" } });

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /add row/i }));
    fireEvent.change(screen.getByLabelText("Row 1 first"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Row 1 second"), { target: { value: "B" } });

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    fireEvent.click(screen.getByLabelText("Move field 1 down"));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByLabelText("Row 1 second")).toHaveValue("B");
    expect(screen.getByLabelText("Row 1 first")).toHaveValue("A");

    fireEvent.click(screen.getByRole("button", { name: /create source/i }));
    const [columns, rows] = onSubmit.mock.calls[0] as [unknown, unknown[][]];
    expect(columns).toEqual([
      { name: "second", type: "string", required: false },
      { name: "first", type: "string", required: false },
    ]);
    expect(rows).toEqual([["B", "A"]]);
  });

  it("accepts zero rows on create (create-without-data path)", () => {
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
    fireEvent.change(screen.getByLabelText("Field 1 name"), { target: { value: "id" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));
    expect(onSubmit).toHaveBeenCalledWith([{ name: "id", type: "string", required: false }], []);
  });
});
