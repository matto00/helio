// HEL-322 regression: the PanelDetailModal appearance save must preserve an
// untouched appearance sentinel (`background: "transparent"`, `color: "inherit"`)
// rather than clobbering it into the color input's display-fallback hex.
//
// Root cause (fixed): the modal used to seed `background` / `color` state via
// `getColorInputValue(...)`, which substitutes a fallback hex for any non-hex
// sentinel; the full-replacement save payload then persisted that hex verbatim.
// The fix stores the RAW appearance value in state and resolves to a display hex
// only at the `<AppearanceEditor>` prop boundary, so an untouched field keeps its
// sentinel while an edited field is overwritten with the picked hex.

import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeMarkdownPanel } from "../../../test/panelFixtures";
import { panelAppearanceEditorFallback, panelTextEditorFallback } from "../../../theme/appearance";
import { PanelDetailModal } from "./PanelDetailModal";

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
}

function enterEditMode() {
  fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));
}

describe("PanelDetailModal — appearance sentinel round-trip (HEL-322)", () => {
  it("keeps an untouched transparent background as the sentinel through save", () => {
    setupDialog();
    const panel = makeMarkdownPanel({
      id: "p1",
      title: "Notes",
      appearance: { background: "transparent", color: "inherit", transparency: 0 },
      config: { content: "# Hi" },
    });
    const { store } = renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />);

    enterEditMode();

    // The color input still DISPLAYS the resolved fallback hex (it cannot hold a
    // sentinel), even though state keeps the raw "transparent".
    expect((screen.getByLabelText("Notes background color") as HTMLInputElement).value).toBe(
      panelAppearanceEditorFallback,
    );

    // Change an unrelated field only, then save.
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Notes v2" } });
    save();

    const pending = store.getState().panels.pendingPanelUpdates["p1"];
    expect(pending.appearance?.background).toBe("transparent");
    expect(pending.appearance?.background).not.toBe(panelAppearanceEditorFallback);
  });

  it("keeps an untouched inherit text color as the sentinel through save", () => {
    setupDialog();
    const panel = makeMarkdownPanel({
      id: "p1",
      title: "Notes",
      appearance: { background: "transparent", color: "inherit", transparency: 0 },
      config: { content: "# Hi" },
    });
    const { store } = renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />);

    enterEditMode();
    expect((screen.getByLabelText("Notes text color") as HTMLInputElement).value).toBe(
      panelTextEditorFallback,
    );

    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Notes v2" } });
    save();

    const pending = store.getState().panels.pendingPanelUpdates["p1"];
    expect(pending.appearance?.color).toBe("inherit");
    expect(pending.appearance?.color).not.toBe(panelTextEditorFallback);
  });

  it("persists an explicitly chosen background color as its hex (not the sentinel)", () => {
    setupDialog();
    const panel = makeMarkdownPanel({
      id: "p1",
      title: "Notes",
      appearance: { background: "transparent", color: "inherit", transparency: 0 },
      config: { content: "# Hi" },
    });
    const { store } = renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />);

    enterEditMode();
    fireEvent.change(screen.getByLabelText("Notes background color"), {
      target: { value: "#123456" },
    });
    save();

    const pending = store.getState().panels.pendingPanelUpdates["p1"];
    expect(pending.appearance?.background).toBe("#123456");
  });

  it("remounts via key on panel switch so a transparent panel opened after a hex panel still saves the sentinel", () => {
    setupDialog();
    const hexPanel = makeMarkdownPanel({
      id: "hex",
      title: "Hex Panel",
      appearance: { background: "#445566", color: "#010203", transparency: 0 },
      config: { content: "# hex" },
    });
    const transparentPanel = makeMarkdownPanel({
      id: "clear",
      title: "Clear Panel",
      appearance: { background: "transparent", color: "inherit", transparency: 0 },
      config: { content: "# clear" },
    });

    // Mirror the real parents (DesktopPanelGrid / MobilePanelStack): the modal is
    // keyed by panel.id, so switching panels remounts it and re-runs every state
    // initializer with fresh raw values.
    const { store, rerender } = renderWithStore(
      <PanelDetailModal key={hexPanel.id} panel={hexPanel} onClose={jest.fn()} />,
    );

    enterEditMode();
    expect((screen.getByLabelText("Hex Panel background color") as HTMLInputElement).value).toBe(
      "#445566",
    );

    // Switch to the transparent panel via a key change → full remount.
    rerender(
      <PanelDetailModal key={transparentPanel.id} panel={transparentPanel} onClose={jest.fn()} />,
    );

    enterEditMode();
    save();

    const pending = store.getState().panels.pendingPanelUpdates["clear"];
    expect(pending.appearance?.background).toBe("transparent");
    expect(pending.appearance?.color).toBe("inherit");
    // The prior hex panel was never saved.
    expect(store.getState().panels.pendingPanelUpdates["hex"]).toBeUndefined();
  });
});
