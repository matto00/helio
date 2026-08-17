import { fireEvent, render, screen } from "@testing-library/react";
import { LimitConfig } from "./LimitConfig";

describe("LimitConfig", () => {
  it("renders a numeric input with the current count value", () => {
    render(<LimitConfig count={50} onChange={jest.fn()} />);
    const input = screen.getByRole("spinbutton", { name: /row limit/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(50);
  });

  it("calls onChange with a typed config object when a valid count is entered", () => {
    const onChange = jest.fn();
    render(<LimitConfig count={50} onChange={onChange} />);
    const input = screen.getByRole("spinbutton", { name: /row limit/i });
    fireEvent.change(input, { target: { value: "25" } });
    expect(onChange).toHaveBeenCalledWith({ count: 25 });
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

  // HEL sweep F-033 regression: clearing the field then typing "50" used to
  // corrupt the value into "1050" because the controlled input snapped back
  // to the last-committed `count` on every keystroke that didn't validate
  // (including the empty string produced by clearing it).
  it("lets the field go through empty without reverting, and ends up exactly at the typed value", () => {
    const onChange = jest.fn();
    render(<LimitConfig count={10} onChange={onChange} />);
    const input = screen.getByRole("spinbutton", { name: /row limit/i });

    // Clear the field (e.g. select-all + Backspace).
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(null);
    expect(onChange).not.toHaveBeenCalled();

    // Type "5", then "0" — the browser delivers the field's full new value
    // on each event, exactly as it would for real keystrokes.
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.change(input, { target: { value: "50" } });

    expect(input).toHaveValue(50);
    expect(onChange).toHaveBeenLastCalledWith({ count: 50 });
  });

  it("echoes an in-progress invalid value (e.g. '0') instead of silently reverting it", () => {
    const onChange = jest.fn();
    render(<LimitConfig count={10} onChange={onChange} />);
    const input = screen.getByRole("spinbutton", { name: /row limit/i });

    fireEvent.change(input, { target: { value: "0" } });

    expect(input).toHaveValue(0);
    expect(screen.getByRole("alert")).toHaveTextContent(/must be greater than 0/i);
    expect(onChange).not.toHaveBeenCalled();
  });
});
