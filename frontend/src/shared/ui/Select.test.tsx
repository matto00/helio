import { fireEvent, render, screen } from "@testing-library/react";

import { Select, type SelectOption } from "./Select";

const options: SelectOption[] = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle", disabled: true },
  { value: "bottom", label: "Bottom" },
];

function renderSelect(value = "top") {
  const onChange = jest.fn();
  const utils = render(
    <Select value={value} options={options} onChange={onChange} ariaLabel="Position" />,
  );
  return { ...utils, onChange };
}

// HEL a11y sweep F-048 — the combobox never exposed which option was
// keyboard-highlighted to assistive tech (no aria-activedescendant/ids), and
// left its listbox open after Tab-away.
describe("Select — combobox a11y (HEL a11y sweep F-048)", () => {
  it("wires aria-controls to the listbox's id", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Position" });
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox");
    expect(trigger).toHaveAttribute("aria-controls", listbox.id);
    expect(listbox.id).toBeTruthy();
  });

  it("ArrowDown moves the highlight and sets aria-activedescendant to that option's id, while real focus stays on the trigger", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Position" });
    // jsdom doesn't auto-focus on click the way a real browser does — focus
    // explicitly, since this test asserts real DOM focus never leaves the
    // trigger (the whole point of the virtual-focus combobox pattern).
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    // "Middle" is disabled — ArrowDown from "Top" should skip to "Bottom".
    const bottomOption = screen.getByRole("option", { name: "Bottom" });
    expect(trigger).toHaveAttribute("aria-activedescendant", bottomOption.id);
    expect(trigger).toHaveFocus();
  });

  it("omits aria-activedescendant while closed", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Position" });
    expect(trigger).not.toHaveAttribute("aria-activedescendant");
  });

  it("options are not sequential Tab stops (tabIndex -1) — virtual focus only", () => {
    renderSelect();
    fireEvent.click(screen.getByRole("combobox", { name: "Position" }));
    for (const option of screen.getAllByRole("option")) {
      expect(option).toHaveAttribute("tabindex", "-1");
    }
  });

  it("focus leaving the trigger and listbox (Tab away) closes the panel", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Position" });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);

    fireEvent.focusOut(trigger, { relatedTarget: outsideButton });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    document.body.removeChild(outsideButton);
  });

  it("selecting an option calls onChange, closes the panel, and returns focus to the trigger", () => {
    const { onChange } = renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Position" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Bottom" }));

    expect(onChange).toHaveBeenCalledWith("bottom");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
