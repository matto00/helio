// HEL-1736: the toast viewport follows the top modal through the modal registry, not a document-wide observer.
import { configureStore } from "@reduxjs/toolkit";
import { act, render } from "@testing-library/react";
import { Provider } from "react-redux";
import { useState } from "react";

import { toastsReducer } from "../../features/toasts/state/toastsSlice";
import { Modal } from "./Modal";
import { ToastViewport } from "./Toast";

beforeEach(() => {
  // jsdom does not implement showModal/close natively; stub them like Modal.test.tsx.
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

function makeStore() {
  return configureStore({ reducer: { toasts: toastsReducer } });
}

/** Runs a change and lets queued microtasks (an observer's callback) and React's updates settle. */
async function settle(change: () => void) {
  await act(async () => {
    change();
    await Promise.resolve();
  });
}

const viewport = () => document.querySelector(".toast-viewport") as HTMLElement;

describe("ToastViewport observation", () => {
  it("never observes document.body's subtree", () => {
    const spy = jest.spyOn(MutationObserver.prototype, "observe");
    try {
      render(
        <Provider store={makeStore()}>
          <ToastViewport />
        </Provider>,
      );
      const bodySubtree = spy.mock.calls.filter(
        ([target, opts]) => target === document.body && opts?.subtree === true,
      );
      expect(bodySubtree).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

function Two({ a, b }: { a: boolean; b: boolean }) {
  return (
    <Provider store={makeStore()}>
      <Modal title="A" open={a} onClose={() => {}} ariaLabel="A">
        <p>a</p>
      </Modal>
      <Modal title="B" open={b} onClose={() => {}} ariaLabel="B">
        <p>b</p>
      </Modal>
      <ToastViewport />
    </Provider>
  );
}

function Single({ open }: { open: boolean }) {
  const [store] = useState(makeStore);
  return (
    <Provider store={store}>
      <Modal title="A" open={open} onClose={() => {}} ariaLabel="A">
        <p>a</p>
      </Modal>
      <ToastViewport />
    </Provider>
  );
}

describe("real Modal moves the toast viewport", () => {
  it("portals into an open Modal and back to the body when it closes", async () => {
    const { rerender } = render(<Single open={false} />);
    expect(viewport().parentElement).toBe(document.body);
    await settle(() => rerender(<Single open />));
    expect(document.querySelector("dialog")).toContainElement(viewport());
    await settle(() => rerender(<Single open={false} />));
    expect(viewport().parentElement).toBe(document.body);
  });

  it("uses the most recently opened of two sequentially opened Modals", async () => {
    const { rerender } = render(<Two a={false} b={false} />);
    await settle(() => rerender(<Two a={false} b />));
    await settle(() => rerender(<Two a b />));
    const [dlgA, dlgB] = Array.from(document.querySelectorAll("dialog"));
    expect(dlgA).toContainElement(viewport());
    await settle(() => rerender(<Two a={false} b />));
    expect(dlgB).toContainElement(viewport());
  });

  it("keeps the toast inside when a native close event fires while the dialog is open (StrictMode race)", async () => {
    const { rerender } = render(<Single open={false} />);
    await settle(() => rerender(<Single open />));
    const dlg = document.querySelector("dialog") as HTMLDialogElement;
    await settle(() => {
      dlg.dispatchEvent(new Event("close"));
    });
    expect(dlg).toContainElement(viewport());
  });

  it("returns to the body on a native close event once the dialog is no longer open", async () => {
    const { rerender } = render(<Single open={false} />);
    await settle(() => rerender(<Single open />));
    const dlg = document.querySelector("dialog") as HTMLDialogElement;
    await settle(() => {
      dlg.removeAttribute("open");
      dlg.dispatchEvent(new Event("close"));
    });
    expect(viewport().parentElement).toBe(document.body);
  });

  it("returns the viewport to the body when a conditionally mounted open Modal unmounts", async () => {
    function Conditional({ show }: { show: boolean }) {
      const [store] = useState(makeStore);
      return (
        <Provider store={store}>
          {show && (
            <Modal title="A" open onClose={() => {}} ariaLabel="A">
              <p>a</p>
            </Modal>
          )}
          <ToastViewport />
        </Provider>
      );
    }
    const { rerender } = render(<Conditional show={false} />);
    await settle(() => rerender(<Conditional show />));
    expect(document.querySelector("dialog")).toContainElement(viewport());
    await settle(() => rerender(<Conditional show={false} />));
    expect(viewport().isConnected).toBe(true);
    expect(viewport().parentElement).toBe(document.body);
  });
});
