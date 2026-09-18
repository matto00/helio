// HEL-1084 task 4.9 — typed option rows per declared type; add/remove.
import { fireEvent, render, screen } from "@testing-library/react";

import { FormOptionsEditor } from "./FormOptionsEditor";

describe("FormOptionsEditor", () => {
  it("renders a numeric input per option for an integer field", () => {
    const onChange = jest.fn();
    render(
      <FormOptionsEditor
        fieldName="quantity"
        fieldType="integer"
        options={[1, 2]}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText("quantity option 1")).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("quantity option 2")).toHaveValue(2);
  });

  it("renders a checkbox per option for a boolean field", () => {
    const onChange = jest.fn();
    render(
      <FormOptionsEditor
        fieldName="flag"
        fieldType="boolean"
        options={[true, false]}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText("flag option 1")).toBeChecked();
    expect(screen.getByLabelText("flag option 2")).not.toBeChecked();
  });

  it("renders a text input per option for a string field", () => {
    const onChange = jest.fn();
    render(
      <FormOptionsEditor
        fieldName="note"
        fieldType="string"
        options={["a", "b"]}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText("note option 1")).toHaveAttribute("type", "text");
  });

  it("adding an option appends a typed default", () => {
    const onChange = jest.fn();
    render(
      <FormOptionsEditor
        fieldName="quantity"
        fieldType="integer"
        options={[1]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add quantity option" }));
    expect(onChange).toHaveBeenCalledWith([1, ""]);
  });

  it("removing an option drops it by index", () => {
    const onChange = jest.fn();
    render(
      <FormOptionsEditor
        fieldName="quantity"
        fieldType="integer"
        options={[1, 2]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove quantity option 1" }));
    expect(onChange).toHaveBeenCalledWith([2]);
  });

  it("editing a numeric option parses to a number", () => {
    const onChange = jest.fn();
    render(
      <FormOptionsEditor
        fieldName="quantity"
        fieldType="integer"
        options={[1]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("quantity option 1"), { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith([5]);
  });
});
