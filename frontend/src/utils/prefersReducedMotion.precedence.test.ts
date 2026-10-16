import { prefersReducedMotion } from "./prefersReducedMotion";

// HEL-1572: a saved motion choice (data-motion on the root) beats the OS reduce-motion setting.
describe("prefersReducedMotion precedence", () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    delete document.documentElement.dataset.motion;
  });

  function os(matches: boolean) {
    window.matchMedia = jest.fn().mockReturnValue({ matches }) as typeof window.matchMedia;
  }

  it("no saved choice follows the OS", () => {
    os(true);
    expect(prefersReducedMotion()).toBe(true);
    os(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("saved Off is reduced even when the OS does not ask", () => {
    os(false);
    document.documentElement.dataset.motion = "off";
    expect(prefersReducedMotion()).toBe(true);
  });

  it.each(["full", "subtle"])("saved %s is not reduced even when the OS asks", (level) => {
    os(true);
    document.documentElement.dataset.motion = level;
    expect(prefersReducedMotion()).toBe(false);
  });
});
