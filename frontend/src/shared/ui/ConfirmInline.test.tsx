import { fireEvent, render, screen } from "@testing-library/react";

import { ConfirmInline } from "./ConfirmInline";

describe("ConfirmInline", () => {
  it("renders the label, and Confirm/Cancel call their respective callbacks", () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(
      <ConfirmInline
        label="Delete? 3 panels will lose this binding."
        {...{ onConfirm, onCancel }}
      />,
    );

    expect(screen.getByText("Delete? 3 panels will lose this binding.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("omits the label element entirely when none is given", () => {
    const { container } = render(<ConfirmInline onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(container.querySelector(".ui-confirm-inline__label")).not.toBeInTheDocument();
  });

  it("supports per-instance aria-label overrides for the Confirm/Cancel buttons", () => {
    render(
      <ConfirmInline
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        confirmAriaLabel="Confirm delete Total Revenue"
        cancelAriaLabel="Cancel delete Total Revenue"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Confirm delete Total Revenue" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel delete Total Revenue" })).toBeInTheDocument();
  });

  it("supports custom confirm/cancel button text", () => {
    render(
      <ConfirmInline
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        confirmLabel="Clear all"
        cancelLabel="Keep"
      />,
    );

    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
  });
});
