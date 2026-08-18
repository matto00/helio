import { fireEvent, render, screen } from "@testing-library/react";

import { Modal } from "./Modal";

beforeEach(() => {
  // jsdom does not implement showModal/close natively; stub them.
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});

function renderModal(props: Partial<Parameters<typeof Modal>[0]> = {}) {
  const onClose = props.onClose ?? jest.fn();
  return {
    onClose,
    ...render(
      <Modal open={props.open ?? true} title={props.title ?? "Test Modal"} onClose={onClose}>
        {props.children ?? <p>Body content</p>}
      </Modal>,
    ),
  };
}

describe("Modal", () => {
  it("renders the title", () => {
    renderModal({ title: "My Modal" });
    expect(screen.getByText("My Modal")).toBeInTheDocument();
  });

  it("renders children", () => {
    renderModal({ children: <span>Hello world</span> });
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <Modal open title="T" description="A helpful hint" onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    expect(screen.getByText("A helpful hint")).toBeInTheDocument();
  });

  it("renders footer when provided", () => {
    render(
      <Modal open title="T" footer={<button>Submit</button>} onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("calls showModal on open=true", () => {
    renderModal({ open: true });
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  // HEL-716: onClose is a single vetoable "close requested" signal — Modal
  // no longer calls dialog.close() itself for any of the three dismiss
  // vectors, so the dialog stays open unless the consumer flips `open` to
  // false (or unmounts) in response.
  it("calls onClose exactly once when the close button is clicked, without pre-closing the dialog", () => {
    const { onClose } = renderModal();
    const dialog = document.querySelector("dialog")!;
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute("open");
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
  });

  it("calls onClose exactly once when Escape (the native cancel event) is pressed, without pre-closing the dialog", () => {
    const { onClose } = renderModal();
    const dialog = document.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute("open");
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
  });

  it("calls onClose exactly once when the backdrop (dialog element) is clicked, without pre-closing the dialog", () => {
    const { onClose } = renderModal();
    const dialog = document.querySelector("dialog")!;
    // Simulate a click whose target is the <dialog> itself (backdrop click).
    fireEvent.click(dialog, { target: dialog });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute("open");
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
  });

  it("does NOT call onClose when inner content is clicked", () => {
    const { onClose } = renderModal({ children: <button>Inner</button> });
    fireEvent.click(screen.getByRole("button", { name: "Inner" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the dialog when the open prop flips to false", () => {
    const { rerender } = render(
      <Modal open title="T" onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    rerender(
      <Modal open={false} title="T" onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });

  it("applies size class to the dialog", () => {
    render(
      <Modal open title="T" size="lg" onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    const dialog = document.querySelector("dialog")!;
    expect(dialog.classList.contains("ui-modal--lg")).toBe(true);
  });

  it("applies the xl size class, wider than lg", () => {
    render(
      <Modal open title="T" size="xl" onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    const dialog = document.querySelector("dialog")!;
    expect(dialog.classList.contains("ui-modal--xl")).toBe(true);
  });

  it("applies the full size class, the widest preset", () => {
    render(
      <Modal open title="T" size="full" onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    const dialog = document.querySelector("dialog")!;
    expect(dialog.classList.contains("ui-modal--full")).toBe(true);
  });

  it("updates the size class across re-renders without remounting or affecting open state", () => {
    const { rerender } = render(
      <Modal open title="T" size="md" onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    const dialog = document.querySelector("dialog")!;
    expect(dialog.classList.contains("ui-modal--md")).toBe(true);

    rerender(
      <Modal open title="T" size="full" onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    expect(document.querySelector("dialog")).toBe(dialog);
    expect(dialog.classList.contains("ui-modal--full")).toBe(true);
    expect(dialog.classList.contains("ui-modal--md")).toBe(false);
    expect(dialog).toHaveAttribute("open");
  });

  it("defaults to md size", () => {
    render(
      <Modal open title="T" onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    const dialog = document.querySelector("dialog")!;
    expect(dialog.classList.contains("ui-modal--md")).toBe(true);
  });

  it("renders headerActions before the close button when provided", () => {
    render(
      <Modal open title="T" headerActions={<button>Star</button>} onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    const buttons = screen.getAllByRole("button");
    const starIndex = buttons.findIndex((b) => b.textContent === "Star");
    const closeIndex = buttons.findIndex((b) => b.getAttribute("aria-label") === "Close");
    expect(starIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeGreaterThan(starIndex);
  });

  it("renders no extra header content when headerActions is omitted", () => {
    render(
      <Modal open title="T" onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    const header = document.querySelector(".ui-modal__header")!;
    // Only the header-text block and the close button — nothing else.
    expect(header.children).toHaveLength(2);
  });

  // HEL-716 (evaluator CR3): this is hand-rolled JS `keydown` handling, not
  // native <dialog> behavior, so it's fully testable in jsdom — mirrors the
  // now-deleted PanelCreationModal.test.tsx 2.7/2.8 pattern (which proved
  // this exact technique against the trap effect before it moved here).
  describe("Tab/Shift+Tab focus trap", () => {
    function renderWithFocusables() {
      render(
        <Modal open title="T" onClose={jest.fn()}>
          <button>First</button>
          <button>Middle</button>
          <button>Last</button>
        </Modal>,
      );
      // DOM/tab order inside the dialog: the header close button, then the
      // three body buttons (no headerActions/footer in this render).
      return {
        dialog: document.querySelector("dialog")!,
        closeButton: screen.getByRole("button", { name: "Close" }),
        lastButton: screen.getByRole("button", { name: "Last" }),
      };
    }

    it("Tab from the last focusable element wraps to the first", () => {
      const { dialog, closeButton, lastButton } = renderWithFocusables();

      lastButton.focus();
      expect(document.activeElement).toBe(lastButton);

      fireEvent.keyDown(dialog, { key: "Tab", shiftKey: false });

      expect(document.activeElement).toBe(closeButton);
    });

    it("Shift+Tab from the first focusable element wraps to the last", () => {
      const { dialog, closeButton, lastButton } = renderWithFocusables();

      closeButton.focus();
      expect(document.activeElement).toBe(closeButton);

      fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });

      expect(document.activeElement).toBe(lastButton);
    });

    it("does not intercept Tab when focus is not on a boundary element", () => {
      const { dialog } = renderWithFocusables();

      const middleButton = screen.getByRole("button", { name: "Middle" });
      middleButton.focus();

      fireEvent.keyDown(dialog, { key: "Tab", shiftKey: false });

      // Not wrapped — jsdom doesn't move focus on Tab itself, so the
      // (non-boundary) focus target is simply left where it was, confirming
      // the trap didn't fire `preventDefault` + force a jump here.
      expect(document.activeElement).toBe(middleButton);
    });
  });
});
