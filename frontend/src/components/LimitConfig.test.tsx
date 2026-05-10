import { fireEvent, render, screen } from "@testing-library/react";
import { LimitConfig } from "./LimitConfig";

describe("LimitConfig", () => {
  it("renders a numeric input with the current count value", () => {
    render(<LimitConfig count={50} onChange={jest.fn()} />);
    const input = screen.getByRole("spinbutton", { name: /row limit/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(50);
  });

  it("calls onChange with correct JSON when a valid count is entered", () => {
    const onChange = jest.fn();
    render(<LimitConfig count={50} onChange={onChange} />);
    const input = screen.getByRole("spinbutton", { name: /row limit/i });
    fireEvent.change(input, { target: { value: "25" } });
    expect(onChange).toHaveBeenCalledWith('{"count":25}');
  });

  it("does not call onChange when the value is 0 (invalid)", () => {
    const onChange = jest.fn();
    render(<LimitConfig count={10} onChange={onChange} />);
    const input = screen.getByRole("spinbutton", { name: /row limit/i });
    fireEvent.change(input, { target: { value: "0" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not call onChange when the value is negative (invalid)", () => {
    const onChange = jest.fn();
    render(<LimitConfig count={10} onChange={onChange} />);
    const input = screen.getByRole("spinbutton", { name: /row limit/i });
    fireEvent.change(input, { target: { value: "-5" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows validation error when count <= 0", () => {
    render(<LimitConfig count={0} onChange={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/must be greater than 0/i);
  });

  it("does not show validation error when count > 0", () => {
    render(<LimitConfig count={10} onChange={jest.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
