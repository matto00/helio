import { act, renderHook } from "@testing-library/react";

import { useShortcut } from "./useShortcut";

function dispatchKey(init: globalThis.KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

describe("useShortcut", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("throws a descriptive dev-time error for an id absent from the declaration", () => {
    const handler = jest.fn();
    // Errors thrown from an effect surface as a console.error in jsdom too; suppress the noise
    // for this expected-throw test.
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      renderHook(() => useShortcut("not-a-real-id", handler));
    }).toThrow(/not-a-real-id/);
    spy.mockRestore();
  });

  it("fires the registered handler for its combo and not for a near-miss combo", () => {
    const handler = jest.fn();
    renderHook(() => useShortcut("quick-launcher", handler));

    dispatchKey({ key: "k", ctrlKey: true }); // near-miss: command-palette's combo
    expect(handler).not.toHaveBeenCalled();

    dispatchKey({ key: "j", ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("when: false suppresses the handler even on a matching combo", () => {
    const handler = jest.fn();
    renderHook(() => useShortcut("quick-launcher", handler, { when: false }));

    dispatchKey({ key: "j", ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("suppresses the handler while focus is in a typing target, unless allowWhileTyping permits it", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    const suppressed = jest.fn();
    renderHook(() => useShortcut("quick-launcher", suppressed));
    // jsdom's KeyboardEvent constructor doesn't honor a `target` init option; dispatch directly
    // on the input instead so `event.target` is genuinely the typing element.
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true }));
    });
    expect(suppressed).not.toHaveBeenCalled();
  });

  it("allowWhileTyping: true lets the handler fire while focus is in a typing target", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    const handler = jest.fn();
    renderHook(() => useShortcut("quick-launcher", handler, { allowWhileTyping: true }));
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true }));
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("the predicate form of allowWhileTyping is consulted with the event target", () => {
    const input = document.createElement("input");
    input.className = "command-palette-input";
    document.body.appendChild(input);

    const handler = jest.fn();
    const predicate = jest.fn(
      (target: EventTarget | null) =>
        target instanceof HTMLElement && target.className.includes("command-palette"),
    );
    renderHook(() => useShortcut("quick-launcher", handler, { allowWhileTyping: predicate }));
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true }));
    });
    expect(predicate).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("guardWhileOverlayOpen: true suppresses the handler while a modal is open", () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);

    const handler = jest.fn();
    renderHook(() => useShortcut("help-overlay", handler, { guardWhileOverlayOpen: true }));
    dispatchKey({ key: "?" });
    expect(handler).not.toHaveBeenCalled();

    document.body.removeChild(dialog);
    dispatchKey({ key: "?" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("unregisters its handler on unmount", () => {
    const handler = jest.fn();
    const { unmount } = renderHook(() => useShortcut("quick-launcher", handler));
    unmount();
    dispatchKey({ key: "j", ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });
});
