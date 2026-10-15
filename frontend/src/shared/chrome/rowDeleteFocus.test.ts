import {
  REVEAL_DELAY_MS,
  focusOnMount,
  noteDeleteActivation,
  resetRowDeleteFocusForTests,
} from "./rowDeleteFocus";

function makeConfirm() {
  const element = document.createElement("div");
  element.tabIndex = -1;
  document.body.appendChild(element);
  element.scrollIntoView = jest.fn();
  return element;
}

/** An element whose scrollTop clamps to [0, max] like a real scroller (jsdom stores any value). */
function makeScroller(max: number, start = 0): HTMLElement {
  const el = document.createElement("div");
  el.style.overflowY = "auto";
  let top = Math.min(start, max);
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(max, value));
    },
  });
  return el;
}

/** A Delete button whose top the test controls, inside a vertical scroller that has room to scroll. */
function makeButton(initialTop = 500) {
  const scroller = makeScroller(1200, 100);
  const button = document.createElement("button");
  scroller.appendChild(button);
  document.body.appendChild(scroller);
  const state = { top: initialTop };
  button.getBoundingClientRect = () => ({ top: state.top }) as DOMRect;
  return { button, scroller, state };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  resetRowDeleteFocusForTests();
  jest.useRealTimers();
  document.body.innerHTML = "";
});

describe("deferred pointer reveal (HEL-1605 D3)", () => {
  it("focuses without scrolling and reveals once, after the double-click window", () => {
    const element = makeConfirm();
    const focus = jest.spyOn(element, "focus");
    const { button } = makeButton();
    noteDeleteActivation(1, button);
    focusOnMount(element);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(element.scrollIntoView).not.toHaveBeenCalled();
    jest.advanceTimersByTime(REVEAL_DELAY_MS - 1);
    expect(element.scrollIntoView).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(element.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(element.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    jest.advanceTimersByTime(5000);
    expect(element.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("re-arms on the second click of a double-click, which commits nothing", () => {
    const element = makeConfirm();
    const { button } = makeButton();
    noteDeleteActivation(1, button);
    focusOnMount(element);
    jest.advanceTimersByTime(400);
    noteDeleteActivation(2, button);
    jest.advanceTimersByTime(REVEAL_DELAY_MS - 1);
    expect(element.scrollIntoView).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(element.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("cancels when the confirm unmounts (ref null)", () => {
    const element = makeConfirm();
    const { button } = makeButton();
    noteDeleteActivation(1, button);
    focusOnMount(element);
    focusOnMount(null);
    jest.advanceTimersByTime(5000);
    expect(element.scrollIntoView).not.toHaveBeenCalled();
  });

  it("reveals immediately after a keyboard activation", () => {
    const element = makeConfirm();
    const { button } = makeButton();
    noteDeleteActivation(0, button);
    focusOnMount(element);
    expect(element.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    jest.advanceTimersByTime(5000);
    expect(element.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("a keyboard activation cancels a pending pointer reveal", () => {
    const element = makeConfirm();
    const { button } = makeButton();
    noteDeleteActivation(1, button);
    focusOnMount(element);
    noteDeleteActivation(0, button);
    jest.advanceTimersByTime(5000);
    expect(element.scrollIntoView).not.toHaveBeenCalled();
  });

  it("switching rows (I16): only the new confirm is revealed, A is never scrolled", () => {
    const a = makeConfirm();
    const b = makeConfirm();
    const { button: first } = makeButton();
    const { button: second } = makeButton();
    noteDeleteActivation(1, first);
    focusOnMount(a);
    jest.advanceTimersByTime(200);
    // React's commit order for A -> B: the click handler, then A's ref(null), then B's ref(el).
    noteDeleteActivation(1, second);
    focusOnMount(null);
    a.remove();
    focusOnMount(b);
    jest.advanceTimersByTime(REVEAL_DELAY_MS);
    expect(a.scrollIntoView).not.toHaveBeenCalled();
    expect(b.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("survives StrictMode's attach / detach / attach: one reveal", () => {
    const element = makeConfirm();
    const { button } = makeButton();
    noteDeleteActivation(1, button);
    focusOnMount(element);
    focusOnMount(null);
    focusOnMount(element);
    jest.advanceTimersByTime(REVEAL_DELAY_MS);
    expect(element.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("never scrolls a detached element", () => {
    const element = makeConfirm();
    const { button } = makeButton();
    noteDeleteActivation(1, button);
    focusOnMount(element);
    element.remove();
    jest.advanceTimersByTime(REVEAL_DELAY_MS);
    expect(element.scrollIntoView).not.toHaveBeenCalled();
  });

  it.each(["wheel", "touchstart"])(
    "a %s during the window cancels the pending reveal (I21)",
    (type) => {
      const element = makeConfirm();
      const { button } = makeButton();
      noteDeleteActivation(1, button);
      focusOnMount(element);
      window.dispatchEvent(new Event(type));
      jest.advanceTimersByTime(5000);
      expect(element.scrollIntoView).not.toHaveBeenCalled();
    },
  );

  it("removes its listeners once the timer has fired", () => {
    const remove = jest.spyOn(window, "removeEventListener");
    const element = makeConfirm();
    const { button } = makeButton();
    noteDeleteActivation(1, button);
    focusOnMount(element);
    jest.advanceTimersByTime(REVEAL_DELAY_MS);
    expect(remove).toHaveBeenCalledWith("wheel", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("touchstart", expect.any(Function), true);
  });
});

describe("pin (HEL-1605 D2)", () => {
  it("compensates a positive delta (button pushed down) on the scroller", () => {
    const element = makeConfirm();
    const { button, scroller, state } = makeButton(500);
    noteDeleteActivation(1, button);
    state.top = 626;
    focusOnMount(element);
    expect(scroller.scrollTop).toBe(226);
  });

  it("compensates a negative delta (a confirm above closed)", () => {
    const element = makeConfirm();
    const { button, scroller, state } = makeButton(500);
    noteDeleteActivation(1, button);
    state.top = 440;
    focusOnMount(element);
    expect(scroller.scrollTop).toBe(40);
  });

  it("skips a sub-half-pixel delta", () => {
    const element = makeConfirm();
    const { button, scroller, state } = makeButton(500);
    noteDeleteActivation(1, button);
    state.top = 500.4;
    focusOnMount(element);
    expect(scroller.scrollTop).toBe(100);
  });

  it("does not pin a keyboard activation", () => {
    const element = makeConfirm();
    const { button, scroller, state } = makeButton(500);
    noteDeleteActivation(0, button);
    state.top = 700;
    focusOnMount(element);
    expect(scroller.scrollTop).toBe(100);
  });

  it("passes what a 1px-overflowing inner scroller cannot absorb up to the outer scroller (768 Sources)", () => {
    const element = makeConfirm();
    const outer = makeScroller(1200, 48);
    const inner = makeScroller(1, 0);
    const button = document.createElement("button");
    inner.appendChild(button);
    outer.appendChild(inner);
    document.body.appendChild(outer);
    const state = { top: 800 };
    button.getBoundingClientRect = () => ({ top: state.top }) as DOMRect;
    noteDeleteActivation(1, button);
    state.top = 758;
    focusOnMount(element);
    // The inner scroller moved 0 (it clamps at 0 for a negative delta), the outer one took all of it.
    expect(inner.scrollTop).toBe(0);
    expect(outer.scrollTop).toBe(6);
  });

  it("splits a delta across scrollers when the nearest can absorb only part of it", () => {
    const element = makeConfirm();
    const outer = makeScroller(1200, 100);
    const inner = makeScroller(1, 0);
    const button = document.createElement("button");
    inner.appendChild(button);
    outer.appendChild(inner);
    document.body.appendChild(outer);
    const state = { top: 500 };
    button.getBoundingClientRect = () => ({ top: state.top }) as DOMRect;
    noteDeleteActivation(1, button);
    state.top = 540;
    focusOnMount(element);
    expect(inner.scrollTop).toBe(1);
    expect(outer.scrollTop).toBe(139);
  });

  it("a record is consumed once: a remount with no fresh activation applies none", () => {
    const element = makeConfirm();
    const { button, scroller, state } = makeButton(500);
    noteDeleteActivation(1, button);
    state.top = 520;
    focusOnMount(element);
    expect(scroller.scrollTop).toBe(120);
    focusOnMount(null);
    state.top = 900;
    focusOnMount(element);
    expect(scroller.scrollTop).toBe(120);
  });

  it("discards an unconsumed record on the next frame (I20)", () => {
    const element = makeConfirm();
    const { button, scroller, state } = makeButton(500);
    noteDeleteActivation(2, button);
    jest.advanceTimersByTime(50);
    state.top = 800;
    focusOnMount(element);
    expect(scroller.scrollTop).toBe(100);
  });
});
