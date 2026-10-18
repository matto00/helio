// HEL-1668 D2: toasts render above an open modal <dialog> (the browser's top layer covers and makes inert anything
// outside it), keep their auto-dismiss clock and entrance across the move, and are announced only through live regions
// that were connected and empty for a full rendered frame first.
import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";

import { pushToast, toastsReducer } from "../../features/toasts/state/toastsSlice";
import { ToastViewport } from "./Toast";

function makeStore() {
  return configureStore({ reducer: { toasts: toastsReducer } });
}

function Harness({ store }: { store: ReturnType<typeof makeStore> }) {
  return (
    <Provider store={store}>
      <dialog data-testid="dlg-a" aria-label="A" />
      <dialog data-testid="dlg-b" aria-label="B" />
      <ToastViewport />
    </Provider>
  );
}

/** Opens a dialog the way showModal() does for jsdom: the `open` attribute (the observer's signal). */
async function openDialog(testId: string) {
  await act(async () => {
    screen.getByTestId(testId).setAttribute("open", "");
    await Promise.resolve();
  });
}
async function closeDialog(testId: string) {
  await act(async () => {
    screen.getByTestId(testId).removeAttribute("open");
    await Promise.resolve();
  });
}
/** One rendered frame. */
function frame() {
  act(() => {
    jest.advanceTimersByTime(16);
  });
}

const viewport = () => document.querySelector(".toast-viewport") as HTMLElement;
const assertive = () => document.querySelector('[role="alert"]') as HTMLElement;
const polite = () => document.querySelector('[role="status"]') as HTMLElement;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("toasts above an open modal dialog", () => {
  it("portals the visual stack and both live regions into the open dialog, and back to the body on close", async () => {
    const store = makeStore();
    render(<Harness store={store} />);
    expect(viewport().parentElement).toBe(document.body);
    await openDialog("dlg-a");
    const dlg = screen.getByTestId("dlg-a");
    expect(dlg).toContainElement(viewport());
    expect(dlg).toContainElement(assertive());
    expect(dlg).toContainElement(polite());
    await closeDialog("dlg-a");
    expect(viewport().parentElement).toBe(document.body);
  });

  it("uses the most recently OPENED dialog, not the last in document order", async () => {
    render(<Harness store={makeStore()} />);
    await openDialog("dlg-b");
    await openDialog("dlg-a");
    expect(screen.getByTestId("dlg-a")).toContainElement(viewport());
    await closeDialog("dlg-a");
    expect(screen.getByTestId("dlg-b")).toContainElement(viewport());
  });

  it("holds a race-window error message until the new regions have been connected and empty for two frames", async () => {
    const store = makeStore();
    render(<Harness store={store} />);
    // The failed-delete flow: the toast is pushed, then the sheet's showModal() runs in a later effect.
    act(() => {
      store.dispatch(pushToast({ variant: "error", message: "Delete failed." }));
    });
    expect(assertive()).toHaveTextContent("Delete failed.");
    await openDialog("dlg-a");
    const region = assertive();
    expect(screen.getByTestId("dlg-a")).toContainElement(region);
    expect(region).toBeEmptyDOMElement();
    frame();
    expect(region).toBeEmptyDOMElement();
    frame();
    frame();
    expect(region).toHaveTextContent("Delete failed.");
    expect(region.querySelectorAll("span")).toHaveLength(1);
  });

  it("does not re-insert a message announced long before the move, and holds a toast pushed during the window", async () => {
    const store = makeStore();
    render(<Harness store={store} />);
    act(() => {
      store.dispatch(pushToast({ variant: "error", message: "Old one.", duration: 0 }));
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });
    await openDialog("dlg-a");
    act(() => {
      store.dispatch(pushToast({ variant: "error", message: "New one.", duration: 0 }));
    });
    expect(assertive()).toBeEmptyDOMElement();
    frame();
    frame();
    frame();
    expect(assertive()).toHaveTextContent("New one.");
    expect(assertive()).not.toHaveTextContent("Old one.");
    expect(assertive().querySelectorAll("span")).toHaveLength(1);
  });

  it("does not restart a visible toast's auto-dismiss clock when it moves into a dialog", async () => {
    const store = makeStore();
    render(<Harness store={store} />);
    act(() => {
      store.dispatch(pushToast({ variant: "info", message: "Clock.", duration: 4000 }));
    });
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    await openDialog("dlg-a");
    // 1.5 s later the original 4 s deadline (plus the 200 ms exit) has passed; a restarted timer would live to 7 s.
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(store.getState().toasts.items).toHaveLength(0);
  });

  it("does not replay the entrance animation for a toast that already entered", async () => {
    const store = makeStore();
    render(<Harness store={store} />);
    act(() => {
      store.dispatch(pushToast({ variant: "info", message: "Entered.", duration: 0 }));
    });
    expect(document.querySelector(".toast")).not.toHaveClass("toast--entered");
    await openDialog("dlg-a");
    expect(document.querySelector(".toast")).toHaveClass("toast--entered");
  });

  it("moves focus to the dialog's first focusable when a focused toast is removed inside it", async () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <dialog data-testid="dlg-a" aria-label="A">
          <button type="button">First</button>
        </dialog>
        <ToastViewport />
      </Provider>,
    );
    await openDialog("dlg-a");
    act(() => {
      store.dispatch(pushToast({ variant: "info", message: "Focus.", duration: 0 }));
    });
    frame();
    const close = screen.getByRole("button", { name: "Dismiss notification" });
    act(() => close.focus());
    expect(document.activeElement).toBe(close);
    act(() => close.click());
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
  });
});
