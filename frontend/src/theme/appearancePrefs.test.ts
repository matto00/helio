import fs from "fs";
import path from "path";

import {
  AppearanceStorageKey,
  DENSITIES,
  DEFAULT_APPEARANCE,
  MOTION_LEVELS,
  TYPE_STYLES,
  applyAppearanceAttributes,
  clearAppearanceCache,
  effectiveMotion,
  readAppearanceCache,
  resolveAppearance,
  writeAppearanceCache,
} from "./appearancePrefs";

const root = document.documentElement;

function resetRoot() {
  delete root.dataset.typeStyle;
  delete root.dataset.density;
  delete root.dataset.motion;
}

function mockOsReduce(matches: boolean) {
  window.matchMedia = jest.fn().mockReturnValue({ matches }) as typeof window.matchMedia;
}

describe("appearancePrefs", () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.localStorage.clear();
    resetRoot();
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("resolves absent or invalid values to defaults, with motion null = follow the OS", () => {
    expect(resolveAppearance({})).toEqual(DEFAULT_APPEARANCE);
    expect(resolveAppearance({ typeStyle: "comic", density: 3, motion: "slow" })).toEqual(
      DEFAULT_APPEARANCE,
    );
    expect(resolveAppearance({ typeStyle: "serif", density: "compact", motion: "off" })).toEqual({
      typeStyle: "serif",
      density: "compact",
      motion: "off",
    });
  });

  it("always writes data-type-style and data-density, and data-motion only for a saved choice", () => {
    applyAppearanceAttributes({ typeStyle: "mono", density: "compact", motion: null });
    expect(root.dataset.typeStyle).toBe("mono");
    expect(root.dataset.density).toBe("compact");
    expect(root.hasAttribute("data-motion")).toBe(false);

    applyAppearanceAttributes({ typeStyle: "sans", density: "comfortable", motion: "subtle" });
    expect(root.dataset.motion).toBe("subtle");
    applyAppearanceAttributes(DEFAULT_APPEARANCE);
    expect(root.hasAttribute("data-motion")).toBe(false);
  });

  it("round-trips the cache and tolerates corrupt JSON", () => {
    writeAppearanceCache({ typeStyle: "serif", density: "compact", motion: "full" });
    expect(readAppearanceCache()).toEqual({
      typeStyle: "serif",
      density: "compact",
      motion: "full",
    });
    window.localStorage.setItem(AppearanceStorageKey, "{not json");
    expect(readAppearanceCache()).toEqual(DEFAULT_APPEARANCE);
    window.localStorage.setItem(AppearanceStorageKey, "null");
    expect(readAppearanceCache()).toEqual(DEFAULT_APPEARANCE);
    writeAppearanceCache({ typeStyle: "mono", density: "comfortable", motion: null });
    clearAppearanceCache();
    expect(window.localStorage.getItem(AppearanceStorageKey)).toBeNull();
  });

  describe("effectiveMotion precedence (DESIGN.md §10)", () => {
    it("no saved choice: OS reduce = off, otherwise full", () => {
      mockOsReduce(true);
      expect(effectiveMotion()).toBe("off");
      mockOsReduce(false);
      expect(effectiveMotion()).toBe("full");
    });

    it.each(MOTION_LEVELS)("an explicit saved %s beats the OS reduce setting", (level) => {
      mockOsReduce(true);
      root.dataset.motion = level;
      expect(effectiveMotion()).toBe(level);
    });
  });

  // The inline script in app.html cannot import this module, so its key and value sets are pinned here: a drift
  // (renamed key, new enum value on one side only) fails this test instead of silently flashing the default.
  describe("app.html pre-paint script", () => {
    const html = fs.readFileSync(path.join(__dirname, "../../app.html"), "utf-8");
    // Parsed with a real HTML parser (jsdom's DOMParser), never a regex over tags. The inline pre-paint script is
    // the <script> with no `src` (never the type="module" entry tag).
    const inlineScripts = [
      ...new DOMParser().parseFromString(html, "text/html").querySelectorAll("script:not([src])"),
    ];
    const script = inlineScripts[0]?.textContent ?? "";

    it("has exactly one inline pre-paint script", () => {
      expect(inlineScripts).toHaveLength(1);
      expect(script).not.toBe("");
    });

    it("reads the same storage key and the same value sets as this module", () => {
      expect(script).toContain(`"${AppearanceStorageKey}"`);
      for (const [name, values] of [
        ["typeStyle", TYPE_STYLES],
        ["density", DENSITIES],
        ["motion", MOTION_LEVELS],
      ] as const) {
        const literal = `[${values.map((v) => `"${v}"`).join(", ")}].indexOf(c.${name})`;
        expect(script).toContain(literal);
      }
    });

    function runScript() {
      new Function(script)();
    }

    it("applies a valid cache before React runs", () => {
      window.localStorage.setItem(
        AppearanceStorageKey,
        JSON.stringify({ typeStyle: "serif", density: "compact", motion: "off" }),
      );
      runScript();
      expect(root.dataset).toMatchObject({ typeStyle: "serif", density: "compact", motion: "off" });
    });

    it("ignores invalid values and corrupt JSON (no throw, no attributes)", () => {
      window.localStorage.setItem(
        AppearanceStorageKey,
        JSON.stringify({ typeStyle: "comic", density: "tiny", motion: "slow" }),
      );
      expect(runScript).not.toThrow();
      expect(root.hasAttribute("data-type-style")).toBe(false);
      expect(root.hasAttribute("data-density")).toBe(false);
      expect(root.hasAttribute("data-motion")).toBe(false);
      window.localStorage.setItem(AppearanceStorageKey, "{{{");
      expect(runScript).not.toThrow();
    });

    it("loads JetBrains Mono weight 700 in BOTH font links (D3)", () => {
      const matches = html.match(/JetBrains\+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400/g);
      expect(matches).toHaveLength(2);
    });
  });
});
