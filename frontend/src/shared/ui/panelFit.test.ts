import { fitPanelVertically } from "./panelFit";

// Pure geometry: jsdom does no layout, so the real reachability proof is the HEL-1750 e2e.
const below = { gap: 8, prefer: "below" } as const;
const above = { gap: 8, prefer: "above" } as const;

describe("fitPanelVertically", () => {
  it("opens on the preferred side when the panel fits there", () => {
    expect(fitPanelVertically({ top: 100, bottom: 130 }, 165, 900, below)).toMatchObject({
      side: "below",
      top: 138,
      maxHeight: 165,
    });
    expect(fitPanelVertically({ top: 500, bottom: 530 }, 165, 900, above)).toMatchObject({
      side: "above",
      top: 327,
      bottom: 900 - 492,
      maxHeight: 165,
    });
  });

  it("flips to the other side when the preferred side is too small and the other has more room", () => {
    const fit = fitPanelVertically({ top: 353 - 38, bottom: 353 - 8 }, 165, 400, below);
    expect(fit.side).toBe("above");
    expect(fit.maxHeight).toBe(165);
    expect(fit.top).toBe(315 - 8 - 165);
    expect(fitPanelVertically({ top: 20, bottom: 50 }, 165, 400, above)).toMatchObject({
      side: "below",
      top: 58,
      maxHeight: 165,
    });
  });

  it("caps to the roomier side when neither side fits, and never goes negative", () => {
    // below room 300-138-8 = 154, above room 100-8-8 = 84 -> stay below, capped.
    expect(fitPanelVertically({ top: 100, bottom: 130 }, 280, 300, below)).toMatchObject({
      side: "below",
      maxHeight: 154,
    });
    // above room 184 beats below room 54: flips and caps.
    expect(fitPanelVertically({ top: 200, bottom: 230 }, 280, 300, below)).toMatchObject({
      side: "above",
      maxHeight: 184,
      top: 8,
    });
    expect(
      fitPanelVertically({ top: -400, bottom: -370 }, 100, 300, above).maxHeight,
    ).toBeGreaterThanOrEqual(0);
  });

  it("applies the cap to the natural height", () => {
    expect(
      fitPanelVertically({ top: 100, bottom: 130 }, 600, 900, { ...below, cap: 280 }),
    ).toMatchObject({
      maxHeight: 280,
    });
  });

  it("with no layout (natural height 0) returns the preferred side, uncapped", () => {
    expect(fitPanelVertically({ top: 100, bottom: 130 }, 0, 900, below)).toMatchObject({
      side: "below",
      top: 138,
      maxHeight: Infinity,
    });
    expect(fitPanelVertically({ top: 100, bottom: 130 }, 0, 900, above).side).toBe("above");
  });
});
