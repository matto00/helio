import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { validateExpression as validateExpressionRequest } from "../services/dataTypeService";
import type { ComputedField } from "../types/models";
import { ComputedFieldsEditor } from "./ComputedFieldsEditor";

jest.mock("../services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
  updateDataType: jest.fn(),
  validateExpression: jest.fn(),
}));

const validateMock = jest.mocked(validateExpressionRequest);

const EXISTING_FIELD: ComputedField = {
  name: "total",
  displayName: "Total",
  expression: "price * quantity",
  dataType: "float",
};

function renderEditor(
  computedFields: ComputedField[] = [],
  onChange: (fields: ComputedField[]) => void = jest.fn(),
) {
  return render(
    <ComputedFieldsEditor typeId="dt-1" computedFields={computedFields} onChange={onChange} />,
  );
}

describe("ComputedFieldsEditor", () => {
  beforeEach(() => {
    validateMock.mockReset();
    // Default: expressions are valid
    validateMock.mockResolvedValue({ valid: true });
  });

  it('renders "No computed fields defined." when list is empty', () => {
    renderEditor();
    expect(screen.getByText(/No computed fields defined/i)).toBeInTheDocument();
  });

  it("lists existing computed fields by display name", () => {
    renderEditor([EXISTING_FIELD]);
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("price * quantity")).toBeInTheDocument();
  });

  it("shows a computed badge next to each field", () => {
    renderEditor([EXISTING_FIELD]);
    expect(screen.getByText("computed")).toBeInTheDocument();
  });

  it("calls onChange with the new field after adding", async () => {
    const onChange = jest.fn();
    renderEditor([], onChange);

    fireEvent.click(screen.getByRole("button", { name: /add computed field/i }));

    // Fill in the form
    fireEvent.change(screen.getByLabelText(/Computed field name/i), {
      target: { value: "profit" },
    });
    fireEvent.change(screen.getByLabelText(/Computed field expression/i), {
      target: { value: "revenue - cost" },
    });

    // Wait for debounced validation to fire (mock resolves quickly)
    await waitFor(() => expect(validateMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /save computed field/i }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "profit", expression: "revenue - cost" }),
        ]),
      );
    });
  });

  it("shows an inline validation error when expression is invalid", async () => {
    validateMock.mockResolvedValue({ valid: false, message: "Unknown field: bad_field" });

    renderEditor([]);
    fireEvent.click(screen.getByRole("button", { name: /add computed field/i }));
    fireEvent.change(screen.getByLabelText(/Computed field expression/i), {
      target: { value: "bad_field * 2" },
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Unknown field: bad_field");
    });
  });

  it("clears the inline error when the expression is corrected", async () => {
    validateMock
      .mockResolvedValueOnce({ valid: false, message: "Unknown field: bad_field" })
      .mockResolvedValue({ valid: true });

    renderEditor([]);
    fireEvent.click(screen.getByRole("button", { name: /add computed field/i }));
    const exprInput = screen.getByLabelText(/Computed field expression/i);

    fireEvent.change(exprInput, { target: { value: "bad_field" } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    fireEvent.change(exprInput, { target: { value: "price * 2" } });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("calls onChange without the removed field after Remove is clicked", () => {
    const onChange = jest.fn();
    renderEditor([EXISTING_FIELD], onChange);

    fireEvent.click(screen.getByRole("button", { name: /remove computed field total/i }));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("opens the edit form pre-populated with the existing field values", () => {
    renderEditor([EXISTING_FIELD]);
    fireEvent.click(screen.getByRole("button", { name: /edit computed field total/i }));

    expect(screen.getByLabelText(/Computed field name/i)).toHaveValue("total");
    expect(screen.getByLabelText(/Computed field expression/i)).toHaveValue("price * quantity");
  });
});
