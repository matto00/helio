import { expandFrom } from "./expandFrom";

const TOKENS: Record<string, string> = {
  "--motion-duration-standard": "280ms",
  "--motion-ease-out": "cubic-bezier(0.3, 0.9, 0.4, 1)",
};

function setTokens(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    document.documentElement.style.setProperty(name, value);
  }
}

function dialog(open: boolean, box = { left: 300, top: 200, width: 600, height: 400 }) {
  const el = document.createElement("dialog") as HTMLDialogElement;
  Object.defineProperty(el, "open", { value: open, configurable: true });
  el.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
    }) as DOMRect;
  el.animate = jest.fn(() => ({}) as Animation);
  return el;
}

const origin = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRectReadOnly;

describe("expandFrom", () => {
  beforeEach(() => setTokens(TOKENS));
  afterEach(() => {
    for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  });

  it("animates once, from the origin's centre and scale to no transform, with fill none", () => {
    const el = dialog(true);
    // dialog centre (600, 400); origin centre (250, 250); scale 300/600 = 0.5
    expandFrom(el, origin(100, 150, 300, 200));
    expect(el.animate).toHaveBeenCalledTimes(1);
    expect(el.animate).toHaveBeenCalledWith(
      [{ transform: "translate(-350px, -150px) scale(0.5)" }, { transform: "none" }],
      { id: "expand-from", duration: 280, easing: "cubic-bezier(0.3, 0.9, 0.4, 1)", fill: "none" },
    );
  });

  it("a repeat call cancels the previous expansion before it measures (StrictMode runs the opening effect twice)", () => {
    const el = dialog(true);
    const order: string[] = [];
    const previous = { id: "expand-from", cancel: jest.fn(() => order.push("cancel")) };
    const unrelated = { id: "other", cancel: jest.fn() };
    el.getAnimations = jest.fn(() => [previous, unrelated] as unknown as Animation[]);
    const measure = el.getBoundingClientRect;
    el.getBoundingClientRect = () => {
      order.push("measure");
      return measure.call(el);
    };
    expandFrom(el, origin(100, 150, 300, 200));
    expect(order).toEqual(["cancel", "measure"]);
    expect(unrelated.cancel).not.toHaveBeenCalled();
  });

  it("clamps the starting scale to [0.2, 1]", () => {
    const small = dialog(true);
    expandFrom(small, origin(0, 0, 30, 30));
    expect((small.animate as jest.Mock).mock.calls[0][0][0].transform).toContain("scale(0.2)");
    const big = dialog(true);
    expandFrom(big, origin(0, 0, 2000, 900));
    expect((big.animate as jest.Mock).mock.calls[0][0][0].transform).toContain("scale(1)");
  });

  it("never animates while the element is not open (a layout-effect implementation would measure a closed dialog)", () => {
    const el = dialog(false);
    expandFrom(el, origin(100, 150, 300, 200));
    expect(el.animate).not.toHaveBeenCalled();
  });

  it("never animates without an origin", () => {
    const el = dialog(true);
    expandFrom(el, null);
    expect(el.animate).not.toHaveBeenCalled();
  });

  it.each(["0.01ms", "0ms", ""])(
    "never animates when the standard duration is instant (%p)",
    (value) => {
      setTokens({ "--motion-duration-standard": value });
      const el = dialog(true);
      expandFrom(el, origin(100, 150, 300, 200));
      expect(el.animate).not.toHaveBeenCalled();
    },
  );

  it("does nothing for a null element", () => {
    expect(expandFrom(null, origin(0, 0, 10, 10))).toBeNull();
  });
});
