import { pickReadableColor, resolvePanelReadableTones } from "./panelReadableTones";
import { resolvePanelTextColor } from "./appearance";
import {
  hexToRgb,
  mix,
  ratio,
  surfaceOf,
  toneBackdrops,
  tokenOf,
  TONES,
  type ThemeName,
} from "./panelReadableTones.testUtils";

const white = hexToRgb("#ffffff");
const black = hexToRgb("#000000");

describe("pickReadableColor", () => {
  it("returns the preferred colour unchanged when it clears the target on every backdrop", () => {
    expect(pickReadableColor("#000000", [white])).toBe("#000000");
    expect(pickReadableColor("#166d43", [hexToRgb("#fdfcfa")])).toBe("#166d43");
  });

  it("steps darker on a light backdrop, keeping the hue family", () => {
    const out = pickReadableColor("#ff0000", [white]);
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    const c = hexToRgb(out);
    expect(ratio(c, white)).toBeGreaterThanOrEqual(4.5);
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.r).toBeGreaterThan(c.b);
    expect(c.r).toBeLessThan(255);
  });

  it("steps lighter on a dark backdrop", () => {
    const out = pickReadableColor("#0000ff", [black]);
    const c = hexToRgb(out);
    expect(ratio(c, black)).toBeGreaterThanOrEqual(4.5);
    expect(c.b).toBeGreaterThan(c.r);
    expect(c.r + c.g + c.b).toBeGreaterThan(255);
  });

  it("scores the worst backdrop when several are given", () => {
    const light = white;
    const mid = hexToRgb("#cc6666");
    const out = hexToRgb(pickReadableColor("#aa0000", [light, mid]));
    expect(ratio(out, light)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(out, mid)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses a minimal step: a barely failing colour barely moves", () => {
    const pre = hexToRgb("#d00000");
    const out = hexToRgb(pickReadableColor("#d00000", [white]));
    expect(out.r).toBeGreaterThan(pre.r * 0.7);
  });

  it("falls back to the better extreme when no step can pass", () => {
    const out = pickReadableColor("#808080", [hexToRgb("#000000"), hexToRgb("#ffffff")]);
    expect(["#000000", "#ffffff"]).toContain(out);
  });

  it("keeps a 0.05 margin over 4.5 against UNROUNDED backdrops (dark, #00ffff, success)", () => {
    // The 8-bit-rounded wash model certified the token here (4.502); the browser's unrounded
    // composite measures 4.487. The picker must not keep the token.
    const backdrops = toneBackdrops("dark", "#00ffff");
    const token = tokenOf("dark", "success");
    const tokenWorst = Math.min(...backdrops.map((b) => ratio(hexToRgb(token), b)));
    expect(tokenWorst).toBeLessThan(4.5);
    const out = hexToRgb(pickReadableColor(token, backdrops));
    expect(Math.min(...backdrops.map((b) => ratio(out, b)))).toBeGreaterThanOrEqual(4.55);
  });
});

describe("resolvePanelReadableTones", () => {
  const appearance = (background: string, color = "inherit") => ({
    background,
    color,
    transparency: 0,
  });

  it("emits nothing for a default (transparent) panel", () => {
    expect(resolvePanelReadableTones("light", appearance("transparent"))).toEqual({});
    expect(resolvePanelReadableTones("dark", appearance("transparent"))).toEqual({});
  });

  it("light #ff0000 emits passing tone variants for all tones and the muted delta", () => {
    const out = resolvePanelReadableTones("light", appearance("#ff0000"));
    const backdrops = toneBackdrops("light", "#ff0000");
    for (const tone of TONES) {
      const v = out[`--panel-tone-${tone}`];
      expect(v).toMatch(/^#[0-9a-f]{6}$/);
      for (const b of backdrops) expect(ratio(hexToRgb(v), b)).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      ratio(hexToRgb(out["--panel-tone-muted"]), surfaceOf("light", "#ff0000")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("light #3366ff raises the unit/label mix so it clears 4.5 on the surface", () => {
    const out = resolvePanelReadableTones("light", appearance("#3366ff"));
    const p = Number.parseInt(out["--panel-secondary-text-mix"], 10) / 100;
    expect(p).toBeGreaterThan(0.62);
    const surface = surfaceOf("light", "#3366ff");
    const text = hexToRgb(resolvePanelTextColor("light", "#3366ff", 0, "inherit"));
    expect(ratio(mix(surface, text, p), surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the token (no override) when it already passes", () => {
    const out = resolvePanelReadableTones("light", appearance("#ffffff"));
    expect(out["--panel-tone-success"]).toBeUndefined();
    expect(out["--panel-secondary-text-mix"]).toBeUndefined();
  });

  it("a row-rule mark tone passes on a different tone's wash (dark #3366ff, error on warning)", () => {
    const out = resolvePanelReadableTones("dark", appearance("#3366ff"));
    const error = out["--panel-tone-error"] ?? tokenOf("dark", "error");
    for (const b of toneBackdrops("dark", "#3366ff")) {
      expect(ratio(hexToRgb(error), b)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every tone/muted/mix passes across saturated and neutral backgrounds in both themes", () => {
    const bgs = [
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#ffff00",
      "#00ffff",
      "#ff00ff",
      "#000000",
      "#ffffff",
      "#3366ff",
      "#ffcc00",
      "#808080",
    ];
    for (const theme of ["light", "dark"] as ThemeName[]) {
      for (const bg of bgs) {
        const out = resolvePanelReadableTones(theme, appearance(bg));
        const backdrops = toneBackdrops(theme, bg);
        for (const tone of TONES) {
          const c = hexToRgb(out[`--panel-tone-${tone}`] ?? tokenOf(theme, tone));
          for (const b of backdrops) expect(ratio(c, b)).toBeGreaterThanOrEqual(4.5);
        }
        const muted = hexToRgb(out["--panel-tone-muted"] ?? tokenOf(theme, "muted"));
        expect(ratio(muted, surfaceOf(theme, bg))).toBeGreaterThanOrEqual(4.5);
        const surface = surfaceOf(theme, bg);
        const text = hexToRgb(resolvePanelTextColor(theme, bg, 0, "inherit"));
        const p = out["--panel-secondary-text-mix"]
          ? Number.parseInt(out["--panel-secondary-text-mix"], 10) / 100
          : theme === "light"
            ? 0.62
            : 0.6;
        expect(ratio(mix(surface, text, p), surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("caps the mix at 100% when the custom text colour is only marginally readable", () => {
    // A grey text colour whose ratio on the surface is within [4.5, 4.55): readable per the
    // contract, but no whole-percent mix below 100 reaches the internal target.
    const surface = surfaceOf("light", "#ffffff");
    let grey: string | null = null;
    for (let g = 0; g < 256 && grey === null; g++) {
      const hex = `#${g.toString(16).padStart(2, "0").repeat(3)}`;
      const r = ratio(hexToRgb(hex), surface);
      if (r >= 4.5 && r < 4.55) grey = hex;
    }
    expect(grey).not.toBeNull();
    const out = resolvePanelReadableTones("light", {
      background: "#ffffff",
      color: grey as string,
      transparency: 0,
    });
    expect(out["--panel-secondary-text-mix"]).toBe("100%");
  });
});
