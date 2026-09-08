import { fireEvent, render, screen, waitFor } from "@testing-library/react";

beforeEach(() => {
  // jsdom does not implement showModal/close natively; stub them (mirrors Modal.test.tsx /
  // App.test.tsx's own setup).
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

import { CommandPaletteProvider } from "../CommandPaletteProvider";
import { GlobalCommandShortcuts } from "../GlobalCommandShortcuts";
import { useCommandActions } from "../hooks";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import type { CommandAction } from "../model/types";
import { CommandPalette } from "./CommandPalette";

function Registrant({ actions }: { actions: CommandAction[] }) {
  useCommandActions(actions);
  return null;
}

function renderPalette(actions: CommandAction[] = []) {
  const onOpenQuickLauncher = jest.fn();
  render(
    <OverlayProvider>
      <CommandPaletteProvider>
        <GlobalCommandShortcuts onOpenQuickLauncher={onOpenQuickLauncher} />
        <Registrant actions={actions} />
        <button type="button">Prior focus target</button>
        <CommandPalette />
      </CommandPaletteProvider>
    </OverlayProvider>,
  );
  return { onOpenQuickLauncher };
}

function makeAction(id: string, title: string, run: () => void = jest.fn()): CommandAction {
  return { id, title, run };
}

// `role="dialog"` queries are unreliable for a `<dialog>` that has no `open` attribute (jsdom's
// UA stylesheet renders it `display: none`, which most accessible-name/role machinery treats as
// absent even with `hidden: true`) — use the DOM node directly for open/closed assertions.
function getDialog(): HTMLDialogElement {
  return document.querySelector(".command-palette") as HTMLDialogElement;
}

describe("CommandPalette", () => {
  it("Cmd/Ctrl+K opens the palette with its input focused", async () => {
    renderPalette();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await waitFor(() => expect(getDialog()).toHaveAttribute("open"));
    await waitFor(() => expect(screen.getByLabelText("Search commands")).toHaveFocus());
  });

  it("Ctrl+J does not open the palette", () => {
    renderPalette();

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });

    expect(getDialog()).not.toHaveAttribute("open");
  });

  // Focus restore on close is native <dialog> behavior (Modal.tsx), inherited rather than
  // reimplemented here — untestable under jsdom's stubbed showModal/close (see Modal.test.tsx,
  // which doesn't assert it either); this test covers the palette's own close-on-Escape wiring.
  it("Escape closes the palette", async () => {
    renderPalette();
    const trigger = screen.getByRole("button", { name: "Prior focus target" });
    trigger.focus();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(getDialog()).toHaveAttribute("open"));

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(getDialog()).not.toHaveAttribute("open"));
  });

  it("arrow keys move the active result and wrap at the ends", async () => {
    renderPalette([makeAction("a", "Alpha"), makeAction("b", "Beta")]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search commands");

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
  });

  it("Enter runs the active result exactly once and closes the palette", async () => {
    const run = jest.fn();
    renderPalette([makeAction("a", "Alpha", run)]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search commands");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getDialog()).not.toHaveAttribute("open"));
  });

  it("shows the empty state when the query matches nothing, and Enter is a no-op", async () => {
    const run = jest.fn();
    renderPalette([makeAction("a", "Alpha", run)]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search commands");

    fireEvent.change(input, { target: { value: "zzz-no-match" } });

    expect(await screen.findByText("No matching commands")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).not.toHaveBeenCalled();

    expect(getDialog()).toHaveAttribute("open");
  });

  it("reopening starts from a clean query showing the full default list", async () => {
    renderPalette([makeAction("a", "Alpha"), makeAction("b", "Beta")]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    let input = await screen.findByLabelText("Search commands");
    fireEvent.change(input, { target: { value: "Alpha" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(getDialog()).not.toHaveAttribute("open"));

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    input = await screen.findByLabelText("Search commands");
    expect(input).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  // HEL-510 tasks.md 3.1 — the palette renders AS a Modal, so `command-palette` must NOT set
  // `guardWhileOverlayOpen`, and its typing exemption must still apply while focus is inside its
  // own (typing-target) search input, once the palette is already open.
  it("Cmd/Ctrl+K still fires while the palette is open, with focus inside its own search input", async () => {
    renderPalette([makeAction("a", "Alpha")]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search commands");
    expect(getDialog()).toHaveAttribute("open");

    fireEvent.change(input, { target: { value: "Alpha" } });
    fireEvent.keyDown(input, { key: "k", ctrlKey: true });

    expect(getDialog()).toHaveAttribute("open");
    expect(input).toHaveValue("Alpha");
  });

  // HEL-516 tasks.md 4.2/4.4 — an action with a `shortcut` shows caps; one without shows none,
  // and rendering nothing reserves no space (asserted structurally here via absence; the visual
  // "no misalignment" claim itself is verified in a real browser per evidence rule 3, not here).
  it("renders a KeyCap per token for an action with a shortcut, and none for an action without", async () => {
    renderPalette([
      { id: "with-combo", title: "With combo", shortcut: { key: "j", mod: true }, run: jest.fn() },
      makeAction("without-combo", "Without combo"),
    ]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByLabelText("Search commands");

    const withComboItem = screen.getByText("With combo").closest("button")!;
    const withoutComboItem = screen.getByText("Without combo").closest("button")!;

    expect(withComboItem.querySelectorAll(".ui-keycap")).toHaveLength(2);
    expect(withoutComboItem.querySelectorAll(".ui-keycap")).toHaveLength(0);
  });

  // skeptic-final-1.md CR1 — the top-level section order is DECLARED data
  // (`SECTION_DISPLAY_ORDER`), not an emergent property of registration/encounter order.
  //
  // WHAT THIS PROVES: even when the underlying (already-ranked) action list encounters sections
  // in the WRONG order first (`Create` before `Navigation`/`General` here — the exact shape a
  // future render-churn bug like the fixed `HelpOverlay` one would reproduce), the rendered
  // group order still matches the declared `SECTION_DISPLAY_ORDER`. WHAT THIS CANNOT PROVE:
  // that every REAL registrant in the live app registers in a stable, non-churning way — that is
  // `CreateCommandActions.test.tsx`'s and `HelpOverlay`'s own concern; this test is about the
  // DISPLAY layer's independence from whatever order it's handed.
  //
  // FAILABLE BY MUTATION: reordering `SECTION_DISPLAY_ORDER`'s declaration (e.g. putting
  // `Create` first) turns this red — verified by making that exact edit during development,
  // observing the failure, and reverting it.
  it("renders sections in the DECLARED order, even when the action list encounters them out of order", async () => {
    renderPalette([
      { id: "create.dashboard", title: "New dashboard", section: "Create", run: jest.fn() },
      { id: "nav.dashboards", title: "Go to Dashboards", section: "Navigation", run: jest.fn() },
      { id: "general.theme", title: "Switch theme", section: "General", run: jest.fn() },
    ]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByLabelText("Search commands");

    const labels = Array.from(document.querySelectorAll(".command-palette__group-label")).map(
      (el) => el.textContent,
    );

    expect(labels).toEqual(["Navigation", "General", "Create"]);
  });
});
