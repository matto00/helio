import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { TableDisplayFields } from "./TableDisplayFields";
import type { TableColumnRow } from "../../../pipelines/ui/outputEditor/useOutputTableColumns";

const columns: TableColumnRow[] = [
  { key: "a", visible: true },
  { key: "b", visible: false },
];

function renderFields(overrides: Partial<ComponentProps<typeof TableDisplayFields>> = {}) {
  return render(
    <TableDisplayFields
      density="normal"
      onDensityChange={jest.fn()}
      columns={columns}
      onToggleVisible={jest.fn()}
      onMoveUp={jest.fn()}
      onMoveDown={jest.fn()}
      onMoveToTop={jest.fn()}
      onMoveToBottom={jest.fn()}
      hasStoredWidths={false}
      resetWidthsPending={false}
      onResetWidths={jest.fn()}
      {...overrides}
    />,
  );
}

describe("TableDisplayFields (HEL-255)", () => {
  it("renders the density dropdown with the three options", () => {
    renderFields();
    fireEvent.click(screen.getByLabelText("Cell density"));
    for (const label of ["Condensed", "Normal", "Spacious"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("lists a row per column with a visibility checkbox reflecting each column's state", () => {
    renderFields();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked(); // a visible
    expect(checkboxes[1]).not.toBeChecked(); // b hidden
  });

  it("calls onToggleVisible with the column key when a checkbox is toggled", () => {
    const onToggleVisible = jest.fn();
    renderFields({ onToggleVisible });
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(onToggleVisible).toHaveBeenCalledWith("b");
  });

  it("disables Move up for the first row and Move down for the last row", () => {
    renderFields();
    expect(screen.getByLabelText("Move a up")).toBeDisabled();
    expect(screen.getByLabelText("Move b down")).toBeDisabled();
    expect(screen.getByLabelText("Move a down")).toBeEnabled();
    expect(screen.getByLabelText("Move b up")).toBeEnabled();
  });

  it("does not render the Columns list when there are no columns (unbound)", () => {
    renderFields({ columns: [] });
    expect(screen.queryByRole("checkbox")).toBeNull();
    // Density dropdown still renders.
    expect(screen.getByLabelText("Cell density")).toBeInTheDocument();
  });

  it("disables Reset column widths when there are no stored widths", () => {
    renderFields({ hasStoredWidths: false });
    expect(screen.getByRole("button", { name: "Reset column widths" })).toBeDisabled();
  });

  it("enables Reset column widths when widths are stored and fires the callback", () => {
    const onResetWidths = jest.fn();
    renderFields({ hasStoredWidths: true, onResetWidths });
    const button = screen.getByRole("button", { name: "Reset column widths" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onResetWidths).toHaveBeenCalled();
  });

  it("reflects a pending width reset in the button label and disables it", () => {
    renderFields({ hasStoredWidths: true, resetWidthsPending: true });
    expect(screen.getByRole("button", { name: "Column widths will reset on save" })).toBeDisabled();
  });

  // F-126
  it("does not render jump-to-top/bottom controls for a short column list", () => {
    renderFields();
    expect(screen.queryByLabelText("Move a to top")).toBeNull();
    expect(screen.queryByLabelText("Move b to bottom")).toBeNull();
  });

  it("renders jump-to-top/bottom controls once the column list is long, and fires the callbacks", () => {
    const longColumns: TableColumnRow[] = Array.from({ length: 9 }, (_, i) => ({
      key: `col${i}`,
      visible: true,
    }));
    const onMoveToTop = jest.fn();
    const onMoveToBottom = jest.fn();
    renderFields({ columns: longColumns, onMoveToTop, onMoveToBottom });

    fireEvent.click(screen.getByLabelText("Move col5 to top"));
    expect(onMoveToTop).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByLabelText("Move col5 to bottom"));
    expect(onMoveToBottom).toHaveBeenCalledWith(5);

    expect(screen.getByLabelText("Move col0 to top")).toBeDisabled();
    expect(screen.getByLabelText("Move col8 to bottom")).toBeDisabled();
  });
});
