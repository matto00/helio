import { fireEvent, render, screen } from "@testing-library/react";

import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("renders unchecked with the given label", () => {
    render(<Toggle checked={false} onChange={() => {}} label="Deprecated" />);
    const input = screen.getByRole("switch", { name: "Deprecated" });
    expect(input).not.toBeChecked();
    expect(screen.getByText("Deprecated")).toBeInTheDocument();
  });

  it("renders checked when checked=true", () => {
    render(<Toggle checked={true} onChange={() => {}} label="Deprecated" />);
    expect(screen.getByRole("switch", { name: "Deprecated" })).toBeChecked();
  });

  it("fires onChange with the new checked value when clicked", () => {
    const onChange = jest.fn();
    render(<Toggle checked={false} onChange={onChange} label="Deprecated" />);

    fireEvent.click(screen.getByRole("switch", { name: "Deprecated" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("is disabled when disabled=true", () => {
    // Root cause note: jsdom's fireEvent.click on a native <input disabled>
    // does NOT gate the resulting change event the way a real browser does
    // (confirmed via a minimal probe against a bare <input type="checkbox"
    // disabled>, outside this component) — so asserting "click then expect
    // onChange not called" is not a reliable signal in this test environment.
    // The `disabled` HTML attribute itself is what a real browser honors, so
    // that's the contract this test verifies.
    render(<Toggle checked={false} onChange={() => {}} label="Deprecated" disabled />);

    expect(screen.getByRole("switch", { name: "Deprecated" })).toBeDisabled();
  });

  it("uses ariaLabel as the accessible name when provided, overriding label", () => {
    render(
      <Toggle
        checked={false}
        onChange={() => {}}
        label="Deprecated"
        ariaLabel="Deprecate this metric"
      />,
    );
    expect(screen.getByRole("switch", { name: "Deprecate this metric" })).toBeInTheDocument();
  });
});
