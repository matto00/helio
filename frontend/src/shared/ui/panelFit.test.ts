import { fitPanelVertically, readBottomInset } from "./panelFit";

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

describe("fitPanelVertically bottomInset (HEL-1762)", () => {
  it("defaults to 0: identical to omitting it", () => {
    const trigger = { top: 500, bottom: 530 };
    expect(fitPanelVertically(trigger, 300, 900, { ...below, bottomInset: 0 })).toEqual(
      fitPanelVertically(trigger, 300, 900, below),
    );
  });

  it("shrinks the room below: a panel that fit now flips above when above has more room", () => {
    // room below 900-530-8-8 = 354 fits 300; with a 76px inset it is 278 < 300, above has 484.
    const fit = fitPanelVertically({ top: 500, bottom: 530 }, 300, 900, {
      ...below,
      bottomInset: 76,
    });
    expect(fit.side).toBe("above");
  });

  it("caps to the reduced room when neither side holds the panel", () => {
    const fit = fitPanelVertically({ top: 100, bottom: 130 }, 800, 400, {
      ...below,
      bottomInset: 76,
    });
    expect(fit.side).toBe("below");
    expect(fit.maxHeight).toBe(400 - 76 - 138 - 8);
  });

  it("leaves the top and bottom anchors computed against the real viewport height", () => {
    const withInset = fitPanelVertically({ top: 500, bottom: 530 }, 300, 900, {
      ...above,
      bottomInset: 76,
    });
    const without = fitPanelVertically({ top: 500, bottom: 530 }, 300, 900, above);
    expect(withInset).toEqual(without);
    expect(withInset.bottom).toBe(900 - 492);
  });
});

describe("readBottomInset (HEL-1762)", () => {
  const nav = (top: number, height: number): void => {
    const el = document.createElement("nav");
    el.className = "bottom-nav";
    el.getBoundingClientRect = () => ({ top, height, bottom: top + height }) as DOMRect;
    document.body.appendChild(el);
  };
  // jsdom resolves no env(): report a 34px safe-area inset for the hidden probe element only.
  const stubSafeArea = (px: number): jest.SpyInstance => {
    const real = Element.prototype.getBoundingClientRect;
    return jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const isProbe =
        this.getAttribute("aria-hidden") === "true" &&
        (this as HTMLElement).style.position === "fixed";
      return isProbe ? ({ top: 0, bottom: px, height: px } as DOMRect) : real.call(this);
    });
  };
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("falls back to the measured safe-area inset when there is no nav", () => {
    stubSafeArea(34);
    expect(readBottomInset(document.body)).toBe(34);
  });

  it("uses the safe-area inset for a panel inside an open dialog even though the nav is rendered", () => {
    stubSafeArea(34);
    nav(window.innerHeight - 76, 56);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const panel = document.createElement("div");
    dialog.appendChild(panel);
    document.body.appendChild(dialog);
    expect(readBottomInset(panel)).toBe(34);
  });

  it("uses the nav band, not the safe area, when the nav is visible", () => {
    stubSafeArea(34);
    nav(window.innerHeight - 76, 56);
    expect(readBottomInset(document.body)).toBe(76);
  });

  it("is 0 with no nav and no safe area (desktop, jsdom)", () => {
    expect(readBottomInset(document.body)).toBe(0);
  });

  it("is the band from the visible nav's top to the viewport bottom", () => {
    nav(window.innerHeight - 76, 56);
    expect(readBottomInset(document.body)).toBe(76);
  });

  it("ignores a nav with no rendered height (hidden above 768px)", () => {
    nav(0, 0);
    expect(readBottomInset(document.body)).toBe(0);
  });

  it("ignores the nav for a panel inside an open dialog (its top layer covers the nav)", () => {
    nav(window.innerHeight - 76, 56);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const panel = document.createElement("div");
    dialog.appendChild(panel);
    document.body.appendChild(dialog);
    expect(readBottomInset(panel)).toBe(0);
  });
});
