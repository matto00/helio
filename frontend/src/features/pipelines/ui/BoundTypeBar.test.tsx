import { fireEvent, render, screen } from "@testing-library/react";
import { BoundTypeBar } from "./BoundTypeBar";

describe("BoundTypeBar", () => {
  it("renders the output type name", () => {
    render(<BoundTypeBar outputTypeName="Test Type" canEditType={false} onEditType={jest.fn()} />);
    expect(screen.getByText("Test Type")).toBeInTheDocument();
  });

  it("renders the Edit Type button when canEditType is true", () => {
    render(<BoundTypeBar outputTypeName="Test Type" canEditType={true} onEditType={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Edit Type" })).toBeInTheDocument();
  });

  it("calls onEditType when the Edit Type button is clicked", () => {
    const onEditType = jest.fn();
    render(<BoundTypeBar outputTypeName="Test Type" canEditType={true} onEditType={onEditType} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Type" }));
    expect(onEditType).toHaveBeenCalledTimes(1);
  });

  it("does not render the Edit Type button when canEditType is false", () => {
    render(<BoundTypeBar outputTypeName="Test Type" canEditType={false} onEditType={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Edit Type" })).not.toBeInTheDocument();
  });
});
