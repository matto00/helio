import {
  INSTANT_AT_OR_BELOW,
  isInstant,
  readMotionDuration,
  readMotionEasing,
} from "./motionTokens";

const root = document.documentElement;

afterEach(() => {
  root.style.removeProperty("--t");
});

describe("readMotionDuration", () => {
  it("parses milliseconds", () => {
    root.style.setProperty("--t", "280ms");
    expect(readMotionDuration("--t")).toBe(280);
  });

  it("parses seconds into milliseconds", () => {
    root.style.setProperty("--t", "0.42s");
    expect(readMotionDuration("--t")).toBeCloseTo(420);
  });

  it("reads the near-zero Off value as the tiny number it is, never 0", () => {
    root.style.setProperty("--t", "0.01ms");
    expect(readMotionDuration("--t")).toBe(0.01);
    expect(isInstant(readMotionDuration("--t"))).toBe(true);
  });

  it("returns 0 for an unresolved token (jsdom has no cascade) and for a non-time value", () => {
    expect(readMotionDuration("--t")).toBe(0);
    root.style.setProperty("--t", "ease");
    expect(readMotionDuration("--t")).toBe(0);
  });

  it("reads from the given element, not only the root", () => {
    const el = document.createElement("div");
    el.style.setProperty("--t", "100ms");
    document.body.appendChild(el);
    expect(readMotionDuration("--t", el)).toBe(100);
    el.remove();
  });
});

describe("readMotionEasing / isInstant", () => {
  it("returns the token's curve, or linear when unresolved", () => {
    expect(readMotionEasing("--t")).toBe("linear");
    root.style.setProperty("--t", "cubic-bezier(0.3, 0.9, 0.4, 1)");
    expect(readMotionEasing("--t")).toBe("cubic-bezier(0.3, 0.9, 0.4, 1)");
  });

  it("treats anything at or below the instant threshold as instant", () => {
    expect(isInstant(0)).toBe(true);
    expect(isInstant(INSTANT_AT_OR_BELOW)).toBe(true);
    expect(isInstant(INSTANT_AT_OR_BELOW + 1)).toBe(false);
    expect(isInstant(Number.NaN)).toBe(true);
  });
});
