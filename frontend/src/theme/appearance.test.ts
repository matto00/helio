import {
  buildAccentTokens,
  buildPanelSurface,
  defaultDashboardAppearance,
  deriveFocusRingColor,
  resolveDashboardBackground,
  resolveDashboardGridBackground,
  resolvePanelTextColor,
} from "./appearance";
import { ACCENT_PRESETS, DefaultAccentColorByTheme } from "./theme";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) {
    throw new Error(`not a hex color: ${hex}`);
  }
  const [, h] = match;
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

function relativeLuminance(c: { r: number; g: number; b: number }): number {
  const channels = [c.r, c.g, c.b].map((channel) => {
    const n = channel / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexToRgb(hexA));
  const lb = relativeLuminance(hexToRgb(hexB));
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Independently reconstructed from theme.css's two `:root[data-theme=...]`
// blocks (not imported from appearance.ts) so this test can't be fooled by
// a bug shared between the production surface list and the test's copy.
const ALL_SURFACES = [
  "#121110",
  "#1a1816",
  "#161514",
  "#232019",
  "#262320",
  "#f4f2ed",
  "#fdfcfa",
  "#efece6",
  "#ffffff",
];

describe("appearance resolution", () => {
  it("resolves dashboard overrides differently per theme", () => {
    const appearance = {
      ...defaultDashboardAppearance,
      background: "#101826",
      gridBackground: "#16233a",
    };

    expect(resolveDashboardBackground("dark", appearance)).not.toBe(
      resolveDashboardBackground("light", appearance),
    );
    expect(resolveDashboardGridBackground("dark", appearance)).not.toBe(
      resolveDashboardGridBackground("light", appearance),
    );
  });

  it("keeps panel surfaces theme-aware under the same override", () => {
    expect(buildPanelSurface("dark", "#1d2a44", 0.08)).not.toBe(
      buildPanelSurface("light", "#1d2a44", 0.08),
    );
  });

  it("falls back to a readable text color when a custom color has poor contrast", () => {
    expect(resolvePanelTextColor("light", "#f3f4f6", 0, "#f8fafc")).toBe("#181511");
  });

  // Lock the panel alpha floor (transparency=0 → fully opaque) and ceiling
  // (transparency=1 → ~0.15) so the formula doesn't drift silently. Opacity at
  // rest is a design invariant: panels must not tint through when the
  // dashboard background changes.
  it("panel surface is opaque at transparency=0 and ~0.15 at transparency=1.0", () => {
    // Dark panelSurface base: #1a1816 = rgb(26, 24, 22). No background override
    // so the blend returns the base unchanged.
    expect(buildPanelSurface("dark", "transparent", 0)).toBe("rgba(26, 24, 22, 1)");
    // 1 - 1.0 * 0.85 may carry JS float noise; match the leading prefix.
    expect(buildPanelSurface("dark", "transparent", 1)).toContain("rgba(26, 24, 22, 0.15");
  });

  // Lock resolveDashboardGridBackground to fully opaque output — the grid
  // override must read identically regardless of what sits behind it.
  //
  // Blend math for gridBackground "#16233a" (r=22, g=35, b=58) at tintStrength=0.62:
  //   dark base #191715  (r=25, g=23, b=21)    → blended r=23, g=30, b=44
  //   light base #fdfcfa (r=253, g=252, b=250) → blended r=110, g=117, b=131
  it("resolveDashboardGridBackground produces opaque rgba values for #16233a", () => {
    const appearance = { ...defaultDashboardAppearance, gridBackground: "#16233a" };
    expect(resolveDashboardGridBackground("dark", appearance)).toBe("rgba(23, 30, 44, 1)");
    expect(resolveDashboardGridBackground("light", appearance)).toBe("rgba(110, 117, 131, 1)");
  });
});

describe("buildAccentTokens", () => {
  it("returns the accent, its readable ink, and the derived focus-ring color", () => {
    const tokens = buildAccentTokens("#f97316");
    expect(Object.keys(tokens).sort()).toEqual(
      ["--app-accent", "--app-accent-ink", "--app-focus-ring-color"].sort(),
    );
    expect(tokens["--app-accent"]).toBe("#f97316");
    expect(tokens["--app-accent-ink"]).toBe("#181511");
    // HEL-1046 D2/D3 — Orange needs a 12% darkening to clear 3:1 against
    // every surface in both themes.
    expect(tokens["--app-focus-ring-color"]).toBe("#db6513");
  });

  it("leaves --app-accent at the raw preset hex (D2) — the ring token never repaints brand", () => {
    for (const { hex } of ACCENT_PRESETS) {
      expect(buildAccentTokens(hex)["--app-accent"]).toBe(hex);
    }
  });

  it("never rewrites neutral structure tokens (borders/backgrounds)", () => {
    const tokens = buildAccentTokens("#3b82f6");
    expect(tokens["--app-border-strong"]).toBeUndefined();
    expect(tokens["--app-border-subtle"]).toBeUndefined();
    expect(tokens["--app-bg-accent"]).toBeUndefined();
  });

  it("picks a light ink for dark accents and a dark ink for bright accents", () => {
    // Deep blue → light ink
    expect(buildAccentTokens("#1d4ed8")["--app-accent-ink"]).toBe("#fdfcfa");
    // Bright yellow → dark ink
    expect(buildAccentTokens("#eab308")["--app-accent-ink"]).toBe("#181511");
  });

  it("returns an empty object for an invalid hex", () => {
    expect(buildAccentTokens("not-a-color")).toEqual({});
  });
});

describe("deriveFocusRingColor (HEL-1046)", () => {
  it("returns null for an unparseable hex — callers fall back to the static :root default", () => {
    expect(deriveFocusRingColor("not-a-color")).toBeNull();
  });

  it("clears 3:1 against every declared surface, in both themes, for all 8 accent presets", () => {
    for (const { hex } of ACCENT_PRESETS) {
      const derived = deriveFocusRingColor(hex);
      expect(derived).not.toBeNull();
      if (derived === null) continue;
      for (const surface of ALL_SURFACES) {
        expect(contrastRatio(derived, surface)).toBeGreaterThanOrEqual(3.0);
      }
    }
  });

  // The concrete per-preset values (task 1.1's measured-need table) are
  // pinned separately below ("darkens the presets that need it") — this
  // test only asserts the >= 3:1 PROPERTY holds for all 8, so a silent
  // change in the required darkening for any one preset is caught there,
  // not here.

  it("leaves the three already-passing presets (Red/Purple/Blue) unchanged — 0% darkening", () => {
    expect(deriveFocusRingColor("#ef4444")).toBe("#ef4444");
    expect(deriveFocusRingColor("#a855f7")).toBe("#a855f7");
    expect(deriveFocusRingColor("#3b82f6")).toBe("#3b82f6");
  });

  it("darkens the presets that need it (measured-need table, task 1.1)", () => {
    expect(deriveFocusRingColor("#f97316")).toBe("#db6513"); // Orange, 12%
    expect(deriveFocusRingColor("#ec4899")).toBe("#ea4797"); // Pink, 1%
    expect(deriveFocusRingColor("#06b6d4")).toBe("#0595ae"); // Cyan, 18%
    expect(deriveFocusRingColor("#22c55e")).toBe("#1b9c4a"); // Green, 21%
    expect(deriveFocusRingColor("#eab308")).toBe("#a88106"); // Yellow, 28%
  });

  // Anti-drift for task 4b.1's static `theme.css` value: `#db6513` must
  // equal the derivation applied to `DefaultAccentColorByTheme.dark`
  // (`#f97316`), not an independently hand-typed hex — otherwise the static
  // pre-hydration fallback and the runtime-derived value could silently
  // diverge. Mutating either side (a well-defined right-hand side, unlike a
  // symbol that doesn't exist) turns this red.
  it("the static theme.css value equals deriveFocusRingColor(DefaultAccentColorByTheme.dark)", () => {
    expect(deriveFocusRingColor(DefaultAccentColorByTheme.dark)).toBe("#db6513");
  });
});
