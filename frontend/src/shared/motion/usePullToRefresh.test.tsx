import { act, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";

import {
  PULL_CONTAINMENT_ATTRIBUTE,
  PULL_FLICK_VELOCITY,
  PULL_HOLD_PX,
  PULL_MAX_PX,
  PULL_SLOP_PX,
  PULL_THRESHOLD_PX,
  usePullToRefresh,
  type PullState,
} from "./usePullToRefresh";

// HEL-1656. Synthetic touch events on a jsdom scroller. Every engagement rule has a recorded mutation that turns its
// test red (listed beside each `it`); the mutations were applied one at a time to usePullToRefresh.ts and reverted.

let phoneViewport = true;
beforeEach(() => {
  phoneViewport = true;
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: phoneViewport,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
});

const latest: { current: PullState } = {
  current: { phase: "idle", active: false, follows: false },
};

function Harness({ onRefresh, busy = false }: { onRefresh: () => boolean; busy?: boolean }) {
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const [stack, setStack] = useState<HTMLDivElement | null>(null);
  const state = usePullToRefresh({
    root: stack,
    target: stack,
    wrapper,
    onRefresh,
    enabled: phoneViewport,
    busy,
  });
  useEffect(() => {
    latest.current = state;
  });
  return (
    <div className="app-content" data-testid="scroller">
      <div ref={setWrapper} data-testid="wrapper">
        <div ref={setStack} data-testid="stack">
          <div data-testid="card">
            <input data-testid="field" />
            <div data-testid="nested">
              <span data-testid="deep" />
            </div>
          </div>
        </div>
      </div>
      <div data-testid="outside" />
    </div>
  );
}

function touchEvent(type: string, points: Array<[number, number]>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: points.map(([clientX, clientY]) => ({ clientX, clientY })),
  });
  return event;
}

/** Dispatch a touch event; returns false when the page called preventDefault on it. */
function send(el: Element, type: string, points: Array<[number, number]>): boolean {
  let result = true;
  act(() => {
    result = el.dispatchEvent(touchEvent(type, points));
  });
  return result;
}

/** Finish the running settle transition (jsdom runs none). */
function endSettle(stack: Element) {
  act(() => {
    stack.dispatchEvent(
      Object.assign(new Event("transitionend", { bubbles: true }), { propertyName: "transform" }),
    );
  });
}

function pullTo(el: Element, dy: number, startX = 100, startY = 200): boolean {
  send(el, "touchstart", [[startX, startY]]);
  return send(el, "touchmove", [[startX, startY + dy]]);
}

/** jsdom does not inherit custom properties, so the move token is set on the stack itself (the element the hook reads). */
function setup(onRefresh: () => boolean = () => true, busy = false, moveToken = "200ms") {
  const view = render(<Harness onRefresh={onRefresh} busy={busy} />);
  const stack = screen.getByTestId("stack");
  stack.style.setProperty("--motion-duration-move", moveToken);
  return { ...view, scroller: screen.getByTestId("scroller"), stack };
}

describe("usePullToRefresh engagement", () => {
  // mutation: drop the `scroller.scrollTop <= 0` start check -> red
  it("does not engage when the scroller is scrolled below the top", () => {
    const { scroller } = setup();
    scroller.scrollTop = 40;
    const card = screen.getByTestId("card");
    expect(pullTo(card, 80)).toBe(true);
    expect(latest.current.active).toBe(false);
    expect(screen.getByTestId("stack").style.transform).toBe("");
  });

  // mutation: drop the start-time scrollTop check -> red
  it("does not engage when the page only reached the top mid-gesture", () => {
    const { scroller } = setup();
    scroller.scrollTop = 40;
    const card = screen.getByTestId("card");
    send(card, "touchstart", [[100, 200]]);
    scroller.scrollTop = 0;
    expect(send(card, "touchmove", [[100, 290]])).toBe(true);
    expect(latest.current.active).toBe(false);
  });

  // mutation: drop the engagement-time scrollTop check -> red
  it("does not engage when the page scrolled away from the top before the slop was crossed", () => {
    const { scroller } = setup();
    const card = screen.getByTestId("card");
    send(card, "touchstart", [[100, 200]]);
    scroller.scrollTop = 30;
    expect(send(card, "touchmove", [[100, 290]])).toBe(true);
    expect(latest.current.active).toBe(false);
  });

  // mutation: remove the touchmove touches.length branch -> red
  it("a second finger arriving mid-pull cancels it", () => {
    const onRefresh = jest.fn(() => true);
    setup(onRefresh);
    const card = screen.getByTestId("card");
    pullTo(card, 200);
    send(card, "touchmove", [
      [100, 400],
      [150, 400],
    ]);
    send(card, "touchend", []);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  // mutation: engage on any dy regardless of sign -> red
  it("does not engage on an upward drag, and never prevents it", () => {
    setup();
    expect(pullTo(screen.getByTestId("card"), -80)).toBe(true);
    expect(latest.current.active).toBe(false);
  });

  // mutation: remove the `|dy| > |dx|` clause -> red
  it("does not engage on a horizontal-dominant drag", () => {
    setup();
    const card = screen.getByTestId("card");
    send(card, "touchstart", [[100, 200]]);
    expect(send(card, "touchmove", [[180, 230]])).toBe(true);
    expect(latest.current.active).toBe(false);
  });

  // mutation: lower the slop to 0 -> red (a 3px jitter engages)
  it("waits for the slop before deciding", () => {
    setup();
    expect(pullTo(screen.getByTestId("card"), PULL_SLOP_PX - 1)).toBe(true);
    expect(latest.current.active).toBe(false);
    expect(send(screen.getByTestId("card"), "touchmove", [[100, 200 + PULL_SLOP_PX + 4]])).toBe(
      false,
    );
    expect(latest.current.active).toBe(true);
  });

  // mutation: remove the `touches.length` checks -> red
  it("a second finger cancels the pull without refreshing", () => {
    const onRefresh = jest.fn(() => true);
    setup(onRefresh);
    const card = screen.getByTestId("card");
    pullTo(card, 200);
    send(card, "touchstart", [
      [100, 400],
      [150, 400],
    ]);
    send(card, "touchend", []);
    expect(onRefresh).not.toHaveBeenCalled();
    endSettle(screen.getByTestId("stack"));
    expect(screen.getByTestId("stack").style.transform).toBe("");
  });

  // mutation: remove the insideScrolledNested walk -> red
  it("does not engage inside a nested scroller that is scrolled away from its top", () => {
    setup();
    screen.getByTestId("nested").scrollTop = 25;
    expect(pullTo(screen.getByTestId("deep"), 90)).toBe(true);
    expect(latest.current.active).toBe(false);
  });

  it("engages inside a nested scroller that is at its own top", () => {
    setup();
    expect(pullTo(screen.getByTestId("deep"), 90)).toBe(false);
    expect(latest.current.active).toBe(true);
  });

  // mutation: remove the FORM_CONTROL exclusion -> red
  it("does not engage when the touch starts on a form control", () => {
    setup();
    expect(pullTo(screen.getByTestId("field"), 90)).toBe(true);
    expect(latest.current.active).toBe(false);
  });

  // mutation: drop the `root.contains(target)` check -> red
  it("does not engage when the touch starts outside the stack", () => {
    setup();
    expect(pullTo(screen.getByTestId("outside"), 90)).toBe(true);
    expect(latest.current.active).toBe(false);
  });

  // mutation: skip the `!busyRef.current` check -> red
  it("ignores a new pull while a refresh round is busy", () => {
    setup(() => true, true);
    expect(pullTo(screen.getByTestId("card"), 90)).toBe(true);
    expect(latest.current.active).toBe(false);
  });

  // mutation: call preventDefault before the engagement decision -> red
  it("prevents touchmove only once engaged", () => {
    setup();
    const card = screen.getByTestId("card");
    send(card, "touchstart", [[100, 200]]);
    expect(send(card, "touchmove", [[100, 203]])).toBe(true);
    expect(send(card, "touchmove", [[100, 230]])).toBe(false);
    expect(send(card, "touchmove", [[100, 260]])).toBe(false);
  });
});

describe("usePullToRefresh release", () => {
  // mutation: threshold compared against the raw finger distance instead of the damped pull -> red
  it("releases past the threshold: refreshes once and holds at the hold offset", () => {
    const onRefresh = jest.fn(() => true);
    const { stack } = setup(onRefresh);
    const card = screen.getByTestId("card");
    pullTo(card, PULL_THRESHOLD_PX * 2 + 20);
    expect(latest.current.phase).toBe("ready");
    expect(screen.getByTestId("wrapper").hasAttribute("data-pull-active")).toBe(true);
    send(card, "touchend", []);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(stack.style.transform).toBe(`translateY(${PULL_HOLD_PX}px)`);
  });

  // mutation: refresh on any release -> red
  it("releases short of the threshold: no refresh, back to rest with no transform", () => {
    const onRefresh = jest.fn(() => true);
    const { stack } = setup(onRefresh);
    const card = screen.getByTestId("card");
    pullTo(card, 60);
    expect(latest.current.phase).toBe("pulling");
    send(card, "touchend", []);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(stack.style.transform).toBe("translateY(0px)");
    endSettle(stack);
    expect(stack.style.transform).toBe("");
    expect(latest.current.active).toBe(false);
  });

  it("a cancelled touch never refreshes", () => {
    const onRefresh = jest.fn(() => true);
    setup(onRefresh);
    const card = screen.getByTestId("card");
    pullTo(card, 400);
    send(card, "touchcancel", []);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("caps the follow distance", () => {
    const { stack } = setup();
    pullTo(screen.getByTestId("card"), 2000);
    expect(stack.style.transform).toBe(`translateY(${PULL_MAX_PX}px)`);
  });

  // mutation: drop the flick rule -> red; PULL_FLICK_VELOCITY is the documented px/ms speed
  it("a fast flick counts from three quarters of the threshold", () => {
    const onRefresh = jest.fn(() => true);
    setup(onRefresh);
    const card = screen.getByTestId("card");
    const now = jest.spyOn(performance, "now");
    now.mockReturnValue(0);
    send(card, "touchstart", [[100, 200]]);
    now.mockReturnValue(10);
    // damped pull 50 (< 64, >= 48), finger speed far above PULL_FLICK_VELOCITY
    send(card, "touchmove", [[100, 200 + PULL_SLOP_PX + 100]]);
    now.mockReturnValue(20);
    send(card, "touchmove", [[100, 200 + PULL_SLOP_PX + 100 + PULL_FLICK_VELOCITY * 40]]);
    send(card, "touchend", []);
    now.mockRestore();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  // mutation: skip the `follows()` check and always translate -> red
  it("moves nothing when the move token is instant (Subtle, Off, reduced motion)", () => {
    const onRefresh = jest.fn(() => true);
    const { stack } = setup(onRefresh, false, "0.001ms");
    const card = screen.getByTestId("card");
    pullTo(card, 300);
    expect(stack.style.transform).toBe("");
    expect(latest.current).toMatchObject({ active: true, follows: false, phase: "ready" });
    // mutation: set the clip attribute regardless of `follows()` -> red (the snap pill would be clipped)
    expect(screen.getByTestId("wrapper").hasAttribute("data-pull-active")).toBe(false);
    send(card, "touchend", []);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(stack.style.transform).toBe("");
  });

  // mutation: ignore the onRefresh result and always hold -> red
  it("settles at once when there was nothing to refresh (no busy flash)", () => {
    const onRefresh = jest.fn(() => false);
    const { stack } = setup(onRefresh);
    const card = screen.getByTestId("card");
    pullTo(card, 300);
    send(card, "touchend", []);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    endSettle(stack);
    expect(stack.style.transform).toBe("");
    expect(latest.current.active).toBe(false);
  });

  it("settles from the hold to rest when busy turns false", () => {
    const onRefresh = jest.fn(() => true);
    const { stack, rerender } = setup(onRefresh);
    const card = screen.getByTestId("card");
    pullTo(card, 300);
    send(card, "touchend", []);
    rerender(<Harness onRefresh={onRefresh} busy />);
    expect(stack.style.transform).toBe(`translateY(${PULL_HOLD_PX}px)`);
    rerender(<Harness onRefresh={onRefresh} busy={false} />);
    endSettle(stack);
    expect(stack.style.transform).toBe("");
    expect(latest.current.active).toBe(false);
  });
});

describe("usePullToRefresh overscroll containment attribute", () => {
  // mutation: attach without the `enabled` gate -> the second test goes red
  it("marks the scroller while attached at a phone width and removes it on unmount", () => {
    const { scroller, unmount } = setup();
    expect(scroller.hasAttribute(PULL_CONTAINMENT_ATTRIBUTE)).toBe(true);
    unmount();
    expect(scroller.hasAttribute(PULL_CONTAINMENT_ATTRIBUTE)).toBe(false);
  });

  it("does not attach, mark or react while not enabled (above the phone shell)", () => {
    phoneViewport = false;
    const { scroller } = setup();
    expect(scroller.hasAttribute(PULL_CONTAINMENT_ATTRIBUTE)).toBe(false);
    expect(pullTo(screen.getByTestId("card"), 300)).toBe(true);
    expect(latest.current.active).toBe(false);
  });
});
