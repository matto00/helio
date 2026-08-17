import { fireEvent, render, screen } from "@testing-library/react";

import { MetricValueEditor } from "./MetricValueEditor";
import type { SelectOption } from "../../../../shared/ui/index";

const fieldOptions: SelectOption[] = [
  { value: "", label: "— None —" },
  { value: "price", label: "price" },
];

describe("MetricValueEditor", () => {
  it("renders a Field selector and a Reduce selector", () => {
    render(
      <MetricValueEditor
        fieldOptions={fieldOptions}
        fieldValue=""
        onFieldChange={jest.fn()}
        reduceValue=""
        onReduceChange={jest.fn()}
      />,
    );

    expect(screen.getByLabelText("Value field")).toBeInTheDocument();
    expect(screen.getByLabelText("Reduce function")).toBeInTheDocument();
  });

  it("lists all reduce functions plus 'None (first row)'", () => {
    render(
      <MetricValueEditor
        fieldOptions={fieldOptions}
        fieldValue=""
        onFieldChange={jest.fn()}
        reduceValue=""
        onReduceChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Reduce function"));
    for (const label of ["None (first row)", "Count", "Sum", "Average", "Min", "Max"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("calls onReduceChange when a reduce function is selected", () => {
    const onReduceChange = jest.fn();
    render(
      <MetricValueEditor
        fieldOptions={fieldOptions}
        fieldValue="price"
        onFieldChange={jest.fn()}
        reduceValue=""
        onReduceChange={onReduceChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Reduce function"));
    fireEvent.click(screen.getByRole("option", { name: "Average" }));
    expect(onReduceChange).toHaveBeenCalledWith("avg");
  });

  it("calls onFieldChange when a field is selected", () => {
    const onFieldChange = jest.fn();
    render(
      <MetricValueEditor
        fieldOptions={fieldOptions}
        fieldValue=""
        onFieldChange={onFieldChange}
        reduceValue=""
        onReduceChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Value field"));
    fireEvent.click(screen.getByRole("option", { name: "price" }));
    expect(onFieldChange).toHaveBeenCalledWith("price");
  });

  // F-120
  it("shows a first-row hint once a field is bound with Reduce left at None", () => {
    render(
      <MetricValueEditor
        fieldOptions={fieldOptions}
        fieldValue="price"
        onFieldChange={jest.fn()}
        reduceValue=""
        onReduceChange={jest.fn()}
      />,
    );

    expect(screen.getByText(/Shows only the first row's value/)).toBeInTheDocument();
  });

  it("does not show the first-row hint when no field is bound yet", () => {
    render(
      <MetricValueEditor
        fieldOptions={fieldOptions}
        fieldValue=""
        onFieldChange={jest.fn()}
        reduceValue=""
        onReduceChange={jest.fn()}
      />,
    );

    expect(screen.queryByText(/Shows only the first row's value/)).toBeNull();
  });

  it("does not show the first-row hint once a real Reduce function is chosen", () => {
    render(
      <MetricValueEditor
        fieldOptions={fieldOptions}
        fieldValue="price"
        onFieldChange={jest.fn()}
        reduceValue="sum"
        onReduceChange={jest.fn()}
      />,
    );

    expect(screen.queryByText(/Shows only the first row's value/)).toBeNull();
  });
});
