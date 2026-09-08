import { render, screen } from "@testing-library/react";

import { HelpOverlay } from "./HelpOverlay";
import { shortcuts } from "./shortcuts";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

describe("HelpOverlay", () => {
  it("renders exactly one row per declaration in shortcuts.ts", () => {
    render(<HelpOverlay open onClose={jest.fn()} />);

    const rows = document.querySelectorAll(".help-overlay__row");
    expect(rows).toHaveLength(shortcuts.length);
  });

  it("renders each declaration's description text", () => {
    render(<HelpOverlay open onClose={jest.fn()} />);

    for (const declaration of shortcuts) {
      expect(screen.getByText(declaration.description)).toBeInTheDocument();
    }
  });

  it("groups rows under their declared group label", () => {
    render(<HelpOverlay open onClose={jest.fn()} />);

    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Layout")).toBeInTheDocument();
  });
});
