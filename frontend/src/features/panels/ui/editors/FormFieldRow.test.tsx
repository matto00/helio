// HEL-1084 task 4.9 — fitting-only controls with default first; used field excluded; Required
// disabled+checked with hint for a dataset-required field and omitted from config; required:
// true when checked on a non-required field; step/options visibility and the cleared hint.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FormFieldRow } from "./FormFieldRow";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormFieldSpec } from "../../types/panel";

const quantity: DatasetFieldResponse = { name: "quantity", type: "integer", required: true };
const note: DatasetFieldResponse = { name: "note", type: "string", required: false };

function renderRow(overrides: Partial<Parameters<typeof FormFieldRow>[0]> = {}) {
  const field: FormFieldSpec = overrides.field ?? { sourceField: "quantity", control: "number" };
  const props = {
    field,
    index: 0,
    total: 1,
    availableFields: [note],
    declaredField: quantity,
    onSourceFieldChange: jest.fn(),
    onControlChange: jest.fn(),
    onAttrChange: jest.fn(),
    onMoveUp: jest.fn(),
    onMoveDown: jest.fn(),
    onRemove: jest.fn(),
    ...overrides,
  };
  render(<FormFieldRow {...props} />);
  return props;
}

describe("FormFieldRow", () => {
  it("offers only fitting controls, default first", () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("Control for quantity"));
    const listbox = screen.getByRole("listbox");
    const optionTexts = Array.from(listbox.querySelectorAll("[role='option']")).map(
      (el) => el.textContent,
    );
    expect(optionTexts).toEqual(["number", "select", "text", "counter"]);
  });

  it("does not offer an already-used field a second time (availableFields excludes it)", () => {
    renderRow({ availableFields: [] });
    fireEvent.click(screen.getByLabelText("Field for quantity"));
    const listbox = screen.getByRole("listbox");
    expect(listbox.querySelectorAll("[role='option']")).toHaveLength(0);
  });

  it("shows Required checked and disabled with a dataset hint for a dataset-required field", () => {
    renderRow();
    const toggle = screen.getByLabelText("Required for quantity");
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.getByText("Required by the dataset")).toBeInTheDocument();
  });

  it("checking Required on a non-required field calls onAttrChange with required: true", () => {
    const props = renderRow({
      field: { sourceField: "note", control: "text" },
      declaredField: note,
      availableFields: [quantity],
    });
    fireEvent.click(screen.getByLabelText("Required for note"));
    expect(props.onAttrChange).toHaveBeenCalledWith({ required: true });
  });

  it("shows step only for the number control", () => {
    renderRow({ field: { sourceField: "quantity", control: "number", step: 1 } });
    expect(screen.getByLabelText("Step for quantity")).toBeInTheDocument();
    cleanup();

    renderRow({ field: { sourceField: "quantity", control: "text" } });
    expect(screen.queryAllByLabelText("Step for quantity")).toHaveLength(0);
  });

  it("shows options only for the select control", () => {
    renderRow({ field: { sourceField: "quantity", control: "select", options: [1, 2] } });
    expect(screen.getByLabelText("quantity option 1")).toBeInTheDocument();
    cleanup();

    renderRow({ field: { sourceField: "quantity", control: "text" } });
    expect(screen.queryAllByLabelText(/quantity option/)).toHaveLength(0);
  });

  it("exposes move/remove controls with field-specific accessible names", () => {
    renderRow();
    expect(screen.getByRole("button", { name: "Move quantity up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move quantity down" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove quantity" })).toBeInTheDocument();
  });

  it("shows the passed error via FormField", () => {
    renderRow({ error: "field 'quantity' is not declared" });
    expect(screen.getByRole("alert")).toHaveTextContent("field 'quantity' is not declared");
  });

  // C8 (skeptic-final-1.md, promoted standing constraint) — error-to-control
  // association is asserted by computed ARIA state, never by the presence of
  // a role="alert" node alone. A role="alert" is a one-shot live-region
  // announcement; it creates no durable programmatic link a screen-reader
  // user tabbing directly to the control can discover later.
  it("marks the sourceField control aria-invalid and describes it by the error text (C8)", () => {
    renderRow({ error: "field 'quantity' is not declared" });
    const control = screen.getByLabelText("Field for quantity");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription("field 'quantity' is not declared");
  });

  it("does not mark the sourceField control aria-invalid when there is no error", () => {
    renderRow();
    const control = screen.getByLabelText("Field for quantity");
    expect(control).not.toHaveAttribute("aria-invalid", "true");
  });
});
