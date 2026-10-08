import { prefersReducedMotion } from "./prefersReducedMotion";

describe("prefersReducedMotion", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("returns true when the media query matches", () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("returns false when the media query does not match", () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });

  it("returns false (and does not throw) when matchMedia is not implemented", () => {
    // jsdom has no matchMedia; simulate that explicitly regardless of setup files.
    Reflect.deleteProperty(window, "matchMedia");
    expect(() => prefersReducedMotion()).not.toThrow();
    expect(prefersReducedMotion()).toBe(false);
  });
});
