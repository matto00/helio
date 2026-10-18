import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { ThemeProvider } from "../../theme/ThemeProvider";
import type { Motion } from "../../theme/appearancePrefs";
import { BottomSheet } from "./BottomSheet";

const SHEET_HEIGHT = 800;
let nowMs = 0;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return SHEET_HEIGHT;
    },
  });
});

afterAll(() => {
  delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
});

beforeEach(() => {
  nowMs = 0;
  jest.spyOn(performance, "now").mockImplementation(() => nowMs);
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function renderSheet(
  props: { onRequestClose?: () => boolean | void; motion?: Motion; open?: boolean } = {},
) {
  const onClosed = jest.fn();
  const sheet = (
    <BottomSheet
      open={props.open ?? true}
      title="Step 1"
      onRequestClose={props.onRequestClose}
      onClosed={onClosed}
    >
      <div data-testid="body">body</div>
    </BottomSheet>
  );
  const view = render(
    props.motion ? (
      <ThemeProvider
        preferredAppearance={{ typeStyle: "sans", density: "comfortable", motion: props.motion }}
      >
        {sheet}
      </ThemeProvider>
    ) : (
      sheet
    ),
  );
  const dialog = view.container.querySelector("dialog") as HTMLDialogElement;
  const header = dialog.querySelector(".ui-modal__header") as HTMLElement;
  return { onClosed, dialog, header, ...view };
}

function drag(
  surface: HTMLElement,
  moves: Array<{ y: number; at: number }>,
  end: "up" | "cancel" = "up",
) {
  nowMs = 0;
  fireEvent.pointerDown(surface, { clientY: 100, pointerId: 1 });
  for (const move of moves) {
    nowMs = move.at;
    fireEvent.pointerMove(surface, { clientY: 100 + move.y, pointerId: 1 });
  }
  if (end === "up") fireEvent.pointerUp(surface, { clientY: 100, pointerId: 1 });
  else fireEvent.pointerCancel(surface, { pointerId: 1 });
}

describe("BottomSheet swipe", () => {
  it("dismisses on a release past a quarter of the sheet height, through the same path as the close button", () => {
    const onRequestClose = jest.fn();
    const { header, onClosed, dialog } = renderSheet({ onRequestClose });
    drag(header, [{ y: SHEET_HEIGHT * 0.3, at: 1000 }]);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
    // Held at the exit offset until the consumer closes the dialog (no flash back at rest).
    expect(dialog.style.transform).toBe(`translateY(${SHEET_HEIGHT}px)`);
  });

  it("dismisses on a fast flick even when short", () => {
    const { header, onClosed } = renderSheet();
    drag(header, [
      { y: 20, at: 10 },
      { y: 80, at: 40 },
    ]);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("returns to rest and stays open on a short slow drag, leaving no transform", () => {
    const { header, onClosed, dialog } = renderSheet();
    nowMs = 0;
    fireEvent.pointerDown(header, { clientY: 100, pointerId: 1 });
    nowMs = 1000;
    fireEvent.pointerMove(header, { clientY: 150, pointerId: 1 });
    expect(dialog.style.transform).toBe("translateY(50px)");
    nowMs = 2000;
    fireEvent.pointerUp(header, { clientY: 150, pointerId: 1 });
    expect(onClosed).not.toHaveBeenCalled();
    expect(dialog.style.transform).toBe("");
    expect(dialog).toHaveAttribute("open");
  });

  it("never moves up past rest", () => {
    const { header, dialog } = renderSheet();
    fireEvent.pointerDown(header, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(header, { clientY: 40, pointerId: 1 });
    expect(dialog.style.transform).toBe("");
  });

  it("springs back on pointercancel even past the threshold", () => {
    const { header, onClosed, dialog } = renderSheet();
    drag(header, [{ y: SHEET_HEIGHT * 0.5, at: 1000 }], "cancel");
    expect(onClosed).not.toHaveBeenCalled();
    expect(dialog.style.transform).toBe("");
  });

  it("never starts a drag from the body", () => {
    const { onClosed, dialog } = renderSheet();
    const body = screen.getByTestId("body");
    fireEvent.pointerDown(body, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(body, { clientY: 600, pointerId: 1 });
    fireEvent.pointerUp(body, { clientY: 600, pointerId: 1 });
    expect(dialog.style.transform).toBe("");
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("does not start a drag on the close button, so its tap still works", () => {
    const { dialog } = renderSheet();
    const close = screen.getByRole("button", { name: "Close" });
    fireEvent.pointerDown(close, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(close, { clientY: 500, pointerId: 1 });
    expect(dialog.style.transform).toBe("");
  });

  it("springs back when the consumer vetoes the close", () => {
    const { header, onClosed, dialog } = renderSheet({ onRequestClose: () => false });
    drag(header, [{ y: SHEET_HEIGHT * 0.6, at: 1000 }]);
    expect(onClosed).not.toHaveBeenCalled();
    expect(dialog.style.transform).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("closes from the close button and from Escape through the same request", () => {
    const onRequestClose = jest.fn();
    const { dialog, onClosed } = renderSheet({ onRequestClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onRequestClose).toHaveBeenCalledTimes(2);
  });
});

describe("BottomSheet motion", () => {
  function transitionEnd(el: HTMLElement, propertyName: string) {
    const event = new Event("transitionend", { bubbles: true });
    Object.assign(event, { propertyName });
    act(() => {
      el.dispatchEvent(event);
    });
  }

  it("holds the dialog open through its exit slide and only then reports closed", () => {
    const { dialog, onClosed } = renderSheet();
    dialog.style.setProperty("--motion-duration-move", "300ms");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog).toHaveAttribute("open");
    expect(onClosed).not.toHaveBeenCalled();
    expect(dialog.style.transform).toBe(`translateY(${SHEET_HEIGHT}px)`);
    transitionEnd(dialog, "transform");
    expect(onClosed).toHaveBeenCalledTimes(1);
    // The slide stays on the dialog until the consumer has closed it: clearing it earlier paints the sheet back.
    expect(dialog).toHaveAttribute("open");
    expect(dialog.style.transform).toBe(`translateY(${SHEET_HEIGHT}px)`);
  });

  describe.each([
    ["full", "move", "transform", "transform"],
    ["subtle", "standard", "opacity", "exiting"],
  ] as const)("never paints the closing sheet at rest (%s)", (motion, token, property, trace) => {
    function Harness({ seen, onClosedSample }: { seen: string[]; onClosedSample?: () => void }) {
      const [open, setOpen] = useState(true);
      return (
        <ThemeProvider preferredAppearance={{ typeStyle: "sans", density: "comfortable", motion }}>
          <BottomSheet
            open={open}
            title="Step 1"
            onClosed={() => {
              seen.push("closed-callback");
              onClosedSample?.();
              setOpen(false);
            }}
          >
            body
          </BottomSheet>
        </ThemeProvider>
      );
    }

    it("keeps the exit trace on every state where the dialog is still open", () => {
      const seen: string[] = [];
      const { container } = render(
        <Harness seen={seen} onClosedSample={() => sample("closed-callback")} />,
      );
      const dialog = container.querySelector("dialog") as HTMLDialogElement;
      dialog.style.setProperty(`--motion-duration-${token}`, "300ms");
      // Sample the dialog at each moment it is still painted open: the consumer's close callback and the native
      // close() itself. An open dialog without the exit trace there is the one-frame flash back at rest.
      const flashes: string[] = [];
      const sample = (where: string) => {
        const traced =
          trace === "transform"
            ? dialog.style.transform !== ""
            : dialog.hasAttribute("data-sheet-exiting");
        if (dialog.hasAttribute("open") && !traced) flashes.push(where);
      };
      const nativeClose = HTMLDialogElement.prototype.close;
      HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
        sample("native-close");
        nativeClose.call(this);
      };
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      transitionEnd(dialog, property);
      return Promise.resolve().then(() => {
        expect(seen).toEqual(["closed-callback"]);
        expect(flashes).toEqual([]);
        expect(dialog).not.toHaveAttribute("open");
        expect(dialog.style.transform).toBe("");
        expect(dialog).not.toHaveAttribute("data-sheet-exiting");
      });
    });
  });

  it("ignores a second close request while exiting", () => {
    const onRequestClose = jest.fn();
    const { dialog } = renderSheet({ onRequestClose });
    dialog.style.setProperty("--motion-duration-move", "300ms");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("fades (opacity only, no transform) under Subtle", () => {
    const { dialog, onClosed } = renderSheet({ motion: "subtle" });
    dialog.style.setProperty("--motion-duration-standard", "300ms");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog).toHaveAttribute("data-sheet-exiting");
    expect(dialog.style.transform).toBe("");
    expect(onClosed).not.toHaveBeenCalled();
    transitionEnd(dialog, "opacity");
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("does not animate at all under Off", () => {
    const { dialog, onClosed } = renderSheet({ motion: "off" });
    dialog.style.setProperty("--motion-duration-move", "300ms");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(dialog).not.toHaveAttribute("data-sheet-settling");
    expect(dialog.style.transform).toBe("");
  });

  it("still follows the finger under Off (direct manipulation)", () => {
    const { header, dialog } = renderSheet({ motion: "off" });
    fireEvent.pointerDown(header, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(header, { clientY: 160, pointerId: 1 });
    expect(dialog.style.transform).toBe("translateY(60px)");
  });

  it("carries no transform once it has opened", () => {
    const { dialog } = renderSheet();
    expect(dialog.style.transform).toBe("");
  });
});
