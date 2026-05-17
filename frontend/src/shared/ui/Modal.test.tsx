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

  it("calls onClose when the close button is clicked", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the native close event fires (ESC key)", () => {
    const { onClose } = renderModal();
    const dialog = document.querySelector("dialog")!;
    fireEvent(dialog, new Event("close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop (dialog element) is clicked", () => {
    const { onClose } = renderModal();
    const dialog = document.querySelector("dialog")!;
    // Simulate a click whose target is the <dialog> itself (backdrop click).
    fireEvent.click(dialog, { target: dialog });
    expect(onClose).toHaveBeenCalled();
  });

  it("does NOT call onClose when inner content is clicked", () => {
    const { onClose } = renderModal({ children: <button>Inner</button> });
    fireEvent.click(screen.getByRole("button", { name: "Inner" }));
    expect(onClose).not.toHaveBeenCalled();
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

  it("defaults to md size", () => {
    render(
      <Modal open title="T" onClose={jest.fn()}>
        <span />
      </Modal>,
    );
    const dialog = document.querySelector("dialog")!;
    expect(dialog.classList.contains("ui-modal--md")).toBe(true);
  });
});
