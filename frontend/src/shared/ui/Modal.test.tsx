import { fireEvent, render, screen } from "@testing-library/react";

import { Modal } from "./Modal";

// HEL-520 skeptic-final-1.md CR1 — the stub previously only set the `open`
// attribute and never moved focus, which is NOT what a real `showModal()`
// does (it moves focus into the dialog, per the HTML spec — the first
// autofocus-eligible element, or otherwise the dialog itself). That gap
// made every restore-on-close assertion true by precondition: with focus
// never leaving the trigger while "open", `expect(document.activeElement)
// .toBe(trigger)` after close passed whether or not Modal's own restore
// effect ran at all — proven by mutation (deleting Modal.tsx's
// `previouslyFocusedRef.current?.focus()` left all tests green). The stub
// now moves focus to the dialog's first focusable descendant, mirroring
// real `showModal()` behaviour closely enough for this file's purposes —
// the existing Tab/Shift+Tab trap cases below already assumed focus starts
// inside the dialog, so this makes the file's own fixture consistent with
// itself, not just with reality.
const DIALOG_FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

beforeEach(() => {
  // jsdom does not implement showModal/close natively; stub them.
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
    const first = this.querySelector<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR);
    first?.focus();
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

  // HEL-718: the close button migrated onto the shared IconButton primitive
  // — verifies it still carries both the accessible name and its visible
  // tooltip (title defaults to aria-label).
  it("the close button has a visible title tooltip matching its aria-label", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("title", "Close");
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

  // HEL-520 AC4: restore-on-close was implemented (HEL-590) but never had a
  // unit assertion in this file — the trap above is covered in three cases,
  // restore had zero. Covers Modal's own restore heuristic: capture
  // `document.activeElement` at open, refocus it at close.
  describe("focus restore on close", () => {
    it("restores focus to the element that was focused before the modal opened", () => {
      render(
        <div>
          <button>Trigger</button>
        </div>,
      );
      const trigger = screen.getByRole("button", { name: "Trigger" });
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const onClose = jest.fn();
      const { rerender } = render(
        <Modal open title="T" onClose={onClose}>
          <button>Inner</button>
        </Modal>,
      );

      // skeptic-final-1.md CR1 — this assertion is what makes the closing
      // assertion below meaningful: focus must actually have LEFT the
      // trigger while the modal is open (the stubbed `showModal()` now
      // moves it to the dialog's first focusable descendant, matching real
      // `<dialog>` behaviour). Without this, "focus is back on the trigger
      // after close" is true whether or not Modal's restore effect ran —
      // proven by mutation: deleting `previouslyFocusedRef.current?.
      // focus()` in Modal.tsx left every test in this file green before
      // this fix (see files-modified.md for the red/green transcript).
      expect(document.activeElement).not.toBe(trigger);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));

      rerender(
        <Modal open={false} title="T" onClose={onClose}>
          <button>Inner</button>
        </Modal>,
      );

      expect(document.activeElement).toBe(trigger);
    });

    it("leaves focus exactly where it was, without throwing, when the previously-focused element has been removed from the document", () => {
      render(
        <div>
          <button>Ephemeral trigger</button>
        </div>,
      );
      const trigger = screen.getByRole("button", { name: "Ephemeral trigger" });
      trigger.focus();
      trigger.remove();

      const onClose = jest.fn();
      const { rerender } = render(
        <Modal open title="T" onClose={onClose}>
          <button>Inner</button>
        </Modal>,
      );
      const closeButton = screen.getByRole("button", { name: "Close" });
      expect(document.activeElement).toBe(closeButton);

      expect(() => {
        rerender(
          <Modal open={false} title="T" onClose={onClose}>
            <button>Inner</button>
          </Modal>,
        );
      }).not.toThrow();

      // skeptic-final-1.md CR1 — `?.focus()` on a captured-but-now-
      // detached element can never throw (optional chaining alone made
      // the old `.not.toThrow()`-only assertion vacuous: it could not
      // fail regardless of what Modal.tsx does here, so it wasn't real
      // coverage). Calling `.focus()` on a disconnected element is a
      // documented no-op in both real browsers and jsdom — it does NOT
      // move focus anywhere, including to `<body>` — so the actually
      // testable, meaningful behaviour is that focus is left completely
      // undisturbed: still on the same element it was on right before
      // `previouslyFocusedRef.current?.focus()` ran. This DOES have a
      // real failure mode: it catches a regression where restore-on-close
      // was changed to unconditionally move focus (e.g. a `?? document.
      // body.focus()` fallback), which would move focus even when the
      // captured element can no longer receive it.
      expect(document.activeElement).toBe(closeButton);
    });
  });
});
