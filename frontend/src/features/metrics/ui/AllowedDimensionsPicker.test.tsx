// HEL-553 cycle-2 regression (evaluation-1.md change request 1) —
// AllowedDimensionsPicker's trigger previously had no onKeyDown handler, so
// pressing Escape while its popover was open let the keydown's native
// default action reach Modal.tsx's underlying native <dialog> ("ESC closes"
// is native <dialog> behavior) and close the whole parent modal, discarding
// all in-progress form state.
//
// Root cause / probe note: jsdom does not implement <dialog>'s native
// Escape-to-close behavior at all — confirmed via a standalone probe
// (dispatching a real, cancelable Escape KeyboardEvent at an open <dialog>,
// or at a focused descendant, never fires a "close"/"cancel" event and never
// calls HTMLDialogElement.prototype.close). This matches Modal.test.tsx's
// own existing workaround for the same gap (its "ESC key" test fires a
// synthetic `close` Event directly rather than a real keypress). That means
// a test which merely presses Escape and then checks "is the parent modal
// still open" would pass unconditionally in this environment — fix or no
// fix — and would not actually guard against the regression.
//
// The mechanism that stops the keydown from reaching the <dialog> in a REAL
// browser is `event.preventDefault()` on the cancelable keydown.
// `fireEvent.keyDown` returns the DOM `dispatchEvent` result, which is
// `false` exactly when `preventDefault()` was called — that return value is
// what this test asserts on. Verified to fail without the fix (no handler
// calls `preventDefault`, so it returns `true`) and pass with it.

import { fireEvent, render, screen } from "@testing-library/react";

import type { SelectOption } from "../../../shared/ui/index";
import { AllowedDimensionsPicker } from "./AllowedDimensionsPicker";

const options: SelectOption[] = [
  { value: "region", label: "region" },
  { value: "channel", label: "channel" },
];

function renderPicker() {
  const onChange = jest.fn();
  const utils = render(
    <AllowedDimensionsPicker options={options} selected={[]} onChange={onChange} />,
  );
  return { onChange, ...utils };
}

function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: "Allowed dimensions" }));
}

describe("AllowedDimensionsPicker", () => {
  it("renders the trigger with the 'None selected' placeholder", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: "Allowed dimensions" })).toHaveTextContent(
      "None selected",
    );
  });

  it("opens the popover on click and lists the given options", () => {
    renderPicker();
    openPopover();
    expect(screen.getByRole("listbox", { name: "Allowed dimensions options" })).toBeInTheDocument();
    expect(screen.getByText("region")).toBeInTheDocument();
    expect(screen.getByText("channel")).toBeInTheDocument();
  });

  it("toggling a checkbox calls onChange with the updated selection", () => {
    const { onChange } = renderPicker();
    openPopover();
    fireEvent.click(screen.getByRole("checkbox", { name: "region" }));
    expect(onChange).toHaveBeenCalledWith(["region"]);
  });

  describe("Escape key containment (evaluation-1.md CR 1)", () => {
    it("Escape while the popover is open calls preventDefault, containing the key to this popover", () => {
      renderPicker();
      openPopover();

      const trigger = screen.getByRole("button", { name: "Allowed dimensions" });
      const notPrevented = fireEvent.keyDown(trigger, { key: "Escape" });

      expect(notPrevented).toBe(false);
    });

    it("Escape closes only the popover", () => {
      renderPicker();
      openPopover();

      const trigger = screen.getByRole("button", { name: "Allowed dimensions" });
      fireEvent.keyDown(trigger, { key: "Escape" });

      expect(
        screen.queryByRole("listbox", { name: "Allowed dimensions options" }),
      ).not.toBeInTheDocument();
      // The trigger itself (and by extension anything that composes this
      // component, e.g. a parent Modal) is unaffected.
      expect(trigger).toBeInTheDocument();
    });

    it("Escape while the popover is already closed is a no-op (does not prevent default)", () => {
      renderPicker();

      const trigger = screen.getByRole("button", { name: "Allowed dimensions" });
      const notPrevented = fireEvent.keyDown(trigger, { key: "Escape" });

      expect(notPrevented).toBe(true);
    });
  });
});
