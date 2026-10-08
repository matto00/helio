import { fitSelectPanel } from "./selectPanelFit";

// Pure geometry only — jsdom does no layout, so the real "option is reachable at 1440x900" proof
// is the HEL-1350 e2e spec, not this file.
describe("fitSelectPanel", () => {
  it("opens below the trigger when the whole panel fits", () => {
    expect(fitSelectPanel({ top: 100, bottom: 132 }, 180, 900)).toEqual({
      top: 136,
      maxHeight: 180,
    });
  });

  it("caps the natural height at the CSS max-height", () => {
    expect(fitSelectPanel({ top: 100, bottom: 132 }, 600, 900)).toEqual({
      top: 136,
      maxHeight: 280,
    });
  });

  it("flips above a trigger near the bottom edge when above has more room", () => {
    // trigger at the bottom of a 900px viewport: 180px panel would end at 981.
    expect(fitSelectPanel({ top: 765, bottom: 797 }, 180, 900)).toEqual({
      top: 581,
      maxHeight: 180,
    });
  });

  it("caps to the roomier side and scrolls inside when neither side fits the panel", () => {
    const fit = fitSelectPanel({ top: 100, bottom: 132 }, 280, 300);
    // below = 300-136-8 = 156, above = 100-4-8 = 88 -> stay below, capped.
    expect(fit).toEqual({ top: 136, maxHeight: 156 });
  });

  it("flips and caps when above has more room but still not enough", () => {
    const fit = fitSelectPanel({ top: 200, bottom: 232 }, 280, 300);
    // below = 300-236-8 = 56, above = 200-12 = 188 -> above, height 188 (< 280).
    expect(fit).toEqual({ top: 8, maxHeight: 188 });
  });

  it("never reports a negative height when the trigger is off-screen above", () => {
    const fit = fitSelectPanel({ top: -100, bottom: -68 }, 180, 100);
    expect(fit.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
