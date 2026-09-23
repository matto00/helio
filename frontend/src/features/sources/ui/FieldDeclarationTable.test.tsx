import { createRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  emptyFieldDeclarationRow,
  FieldDeclarationTable,
  type FieldDeclarationRow,
} from "./FieldDeclarationTable";

function Harness({ initialRows }: { initialRows: FieldDeclarationRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const addFieldButtonRef = createRef<HTMLButtonElement>();
  return (
    <FieldDeclarationTable
      rows={rows}
      onChange={setRows}
      addFieldButtonRef={addFieldButtonRef}
      idPrefix="test"
    />
  );
}

function row(overrides: Partial<FieldDeclarationRow> = {}): FieldDeclarationRow {
  return { ...emptyFieldDeclarationRow(), ...overrides };
}

describe("FieldDeclarationTable", () => {
  it("adds a field when 'Add field' is clicked", () => {
    render(<Harness initialRows={[row({ name: "a" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    expect(screen.getByLabelText("Field 2 name")).toBeInTheDocument();
  });

  it("removes a field when its remove button is clicked", () => {
    render(<Harness initialRows={[row({ name: "a" }), row({ name: "b" })]} />);
    fireEvent.click(screen.getByLabelText("Remove field 1"));
    expect(screen.queryByDisplayValue("a")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("b")).toBeInTheDocument();
  });

  it("reorders a field when 'Move down' is clicked", () => {
    render(<Harness initialRows={[row({ name: "a" }), row({ name: "b" })]} />);
    fireEvent.click(screen.getByLabelText("Move field 1 down"));
    const names = screen
      .getAllByRole("textbox")
      .filter((el) => el.getAttribute("aria-label")?.includes("name"));
    expect(names[0]).toHaveValue("b");
    expect(names[1]).toHaveValue("a");
  });

  it("changes a field's type via the type Select", () => {
    render(<Harness initialRows={[row({ name: "a", type: "string" })]} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Field 1 type" }));
    fireEvent.click(screen.getByRole("option", { name: "integer" }));
    expect(screen.getByRole("combobox", { name: "Field 1 type" })).toHaveTextContent("integer");
  });

  it("does not offer a default input for a binary-ref field", () => {
    render(<Harness initialRows={[row({ name: "a", type: "binary-ref" })]} />);
    expect(screen.queryByLabelText("Field 1 default value")).not.toBeInTheDocument();
    expect(screen.getByText("not applicable")).toBeInTheDocument();
  });

  it("offers a default input for a non-binary-ref field", () => {
    render(<Harness initialRows={[row({ name: "a", type: "string" })]} />);
    expect(screen.getByLabelText("Field 1 default value")).toBeInTheDocument();
  });

  describe("Required checkbox (HEL-1125)", () => {
    it("exposes the checkbox by its computed accessible name and unchecked state", () => {
      render(<Harness initialRows={[row({ name: "a", required: false })]} />);
      const checkbox = screen.getByRole("checkbox", { name: "Field 1 required" });
      expect(checkbox).not.toBeChecked();
    });

    it("reflects a required field as checked via its computed accessible state", () => {
      render(<Harness initialRows={[row({ name: "a", required: true })]} />);
      expect(screen.getByRole("checkbox", { name: "Field 1 required" })).toBeChecked();
    });

    it("is a real, focusable tab stop, and toggles required on activation", () => {
      render(<Harness initialRows={[row({ name: "a", required: false })]} />);
      const checkbox = screen.getByRole("checkbox", { name: "Field 1 required" });

      // Proves the checkbox is a genuine, reachable tab stop -- not disabled or otherwise
      // removed from the tab order -- before exercising the activation it would receive from
      // a keyboard Space press (jsdom has no `@testing-library/user-event` dependency to
      // synthesize real key-to-click translation; see DatasetRowGridFocusAndConflict.test.tsx's
      // HEL-1080 note for the same repo-wide caveat and convention).
      checkbox.focus();
      expect(document.activeElement).toBe(checkbox);

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    });
  });

  describe("focus contract (design.md Decision 6)", () => {
    it("moves focus to the moved row's own name input after a reorder", () => {
      render(<Harness initialRows={[row({ name: "a" }), row({ name: "b" })]} />);
      fireEvent.click(screen.getByLabelText("Move field 1 down"));
      // "a" moved to position 2 -- its own name input (now "Field 2 name") should be focused.
      expect(screen.getByLabelText("Field 2 name")).toHaveFocus();
    });

    it("moves focus to the moved row's name input when reordering to the top boundary", () => {
      render(<Harness initialRows={[row({ name: "a" }), row({ name: "b" })]} />);
      fireEvent.click(screen.getByLabelText("Move field 2 up"));
      expect(screen.getByLabelText("Field 1 name")).toHaveFocus();
    });

    it("moves focus to the next remaining field's name input after a remove", () => {
      render(
        <Harness initialRows={[row({ name: "a" }), row({ name: "b" }), row({ name: "c" })]} />,
      );
      fireEvent.click(screen.getByLabelText("Remove field 1"));
      expect(screen.getByLabelText("Field 1 name")).toHaveFocus();
      expect(screen.getByLabelText("Field 1 name")).toHaveValue("b");
    });

    it("moves focus to the 'Add field' control when the last remaining field is removed", () => {
      render(<Harness initialRows={[row({ name: "a" })]} />);
      fireEvent.click(screen.getByLabelText("Remove field 1"));
      expect(screen.getByRole("button", { name: /add field/i })).toHaveFocus();
    });
  });
});
