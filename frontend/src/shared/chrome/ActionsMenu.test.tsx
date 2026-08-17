import { fireEvent, render, screen } from "@testing-library/react";

import { ActionsMenu } from "./ActionsMenu";

function renderMenu(overrides: Partial<Parameters<typeof ActionsMenu>[0]> = {}) {
  const onRename = jest.fn();
  const onDuplicate = jest.fn();
  const onDelete = jest.fn();
  const utils = render(
    <ActionsMenu
      label="Panel actions"
      items={[
        { label: "Rename", onClick: onRename },
        { label: "Duplicate", onClick: onDuplicate, disabled: true },
        { label: "Delete", onClick: onDelete, danger: true },
      ]}
      {...overrides}
    />,
  );
  return { ...utils, onRename, onDuplicate, onDelete };
}

// HEL a11y sweep F-007 — the actions menu was entirely unusable via
// keyboard: Enter/Space opened it but never moved real focus into the menu,
// arrow keys did nothing, and Tab-away left it visually open with focus on
// an unrelated control.
describe("ActionsMenu — keyboard operability (HEL a11y sweep F-007)", () => {
  it("Enter on the trigger opens the menu and moves real focus to the first enabled item", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Panel actions" });
    trigger.focus();
    fireEvent.click(trigger);

    const renameItem = screen.getByRole("menuitem", { name: "Rename" });
    expect(renameItem).toHaveFocus();
  });

  it("ArrowDown moves focus to the next enabled item, skipping a disabled one", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });

    // "Duplicate" is disabled — ArrowDown from "Rename" should skip straight
    // to "Delete".
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });

  it("ArrowUp from the first item wraps around to the last enabled item", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowUp" });

    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });

  it("Home/End jump to the first/last enabled item", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();

    fireEvent.keyDown(menu, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
  });

  it("Escape closes the menu and returns real focus to the trigger", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Panel actions" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("focus leaving the menu (Tab away) closes it", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);

    const renameItem = screen.getByRole("menuitem", { name: "Rename" });
    fireEvent.focusOut(renameItem, { relatedTarget: outsideButton });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    document.body.removeChild(outsideButton);
  });

  it("activating an item via click calls its onClick and closes the menu", () => {
    const { onRename } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("menu items are not sequential Tab stops (tabIndex -1) — only reachable via Enter/arrow keys", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item).toHaveAttribute("tabindex", "-1");
    }
  });

  it("the menu has an accessible name matching the trigger's label", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    expect(screen.getByRole("menu", { name: "Panel actions" })).toBeInTheDocument();
  });
});
